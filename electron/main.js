import { app, BrowserWindow, Menu, ipcMain, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import {
  createLocalWebSocketAccess,
  createRendererWebSocketArguments,
} from './services/local-websocket-access.js'

const analyticsSecret = process.env.ANALYTICS_SECRET || '';
if (process.env.ANALYTICS_SECRET) {
  process.env.ANALYTICS_REQUIRES_MAIN_SIGNING = 'true';
  delete process.env.ANALYTICS_SECRET;
}

// ============================================================
// Global error handlers to prevent crashes from network errors
// ============================================================
process.on('uncaughtException', (error) => {
  const isNetworkError = error?.code === 'ECONNRESET' ||
                         error?.code === 'ETIMEDOUT' ||
                         error?.code === 'ENOTFOUND' ||
                         error?.code === 'ECONNREFUSED' ||
                         error?.code === 'EPIPE' ||
                         error?.code === 'EAI_AGAIN' ||
                         error?.message?.includes('socket disconnected') ||
                         error?.message?.includes('TLS') ||
                         error?.message?.includes('ECONNRESET');

  if (isNetworkError) {
    console.warn('[Electron] Network error caught (non-fatal):', error?.code || error?.message);
  } else {
    console.error('[Electron] Uncaught exception:', error);
  }
  // Don't exit - let the app continue running
});

process.on('unhandledRejection', (reason, _promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const isNetworkError = error?.code === 'ECONNRESET' ||
                         error?.code === 'ETIMEDOUT' ||
                         error?.code === 'ENOTFOUND' ||
                         error?.code === 'ECONNREFUSED' ||
                         error?.code === 'EPIPE' ||
                         error?.code === 'EAI_AGAIN' ||
                         error?.message?.includes('socket disconnected') ||
                         error?.message?.includes('TLS') ||
                         error?.message?.includes('ECONNRESET');

  if (isNetworkError) {
    console.warn('[Electron] Unhandled network error (non-fatal):', error?.code || error?.message);
  } else {
    console.error('[Electron] Unhandled rejection:', reason);
  }
  // Don't exit - let the app continue running
});

const localWebSocketAccess = createLocalWebSocketAccess();
const rendererWebSocketArguments = createRendererWebSocketArguments(localWebSocketAccess);

setupBinanceConnection({ localWebSocketAccess });

// Get proxy URL from environment (supports http_proxy, HTTP_PROXY, https_proxy, HTTPS_PROXY)
const getSystemProxy = () => {
  const proxyUrl = process.env.http_proxy || process.env.HTTP_PROXY || 
                   process.env.https_proxy || process.env.HTTPS_PROXY;
  if (!proxyUrl) return null;
  
  try {
    const url = new URL(proxyUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return proxyUrl;
  }
};

// Analytics config from environment - only non-secret values are injected into browser
const getAnalyticsConfig = () => {
  const requiresMainProcessSigning = Boolean(analyticsSecret);
  const config = {
    baseUrl: process.env.ANALYTICS_URL || process.env.ANALYTICS_BASE_URL || 'http://localhost:3000',
    pollInterval: Math.max(5000, Number(process.env.ANALYTICS_POLL_INTERVAL) || 45000),
    limit: Math.min(200, Math.max(5, Number(process.env.ANALYTICS_LIMIT) || 40)),
    enabled: !requiresMainProcessSigning,
    authMode: requiresMainProcessSigning ? 'main-process-required' : 'none',
  };
  // Public key is safe to expose; signing secret must stay in main.
  if (process.env.ANALYTICS_KEY) {
    config.key = process.env.ANALYTICS_KEY;
  }
  return config;
};

// IPC handler for analytics config
ipcMain.handle('get-analytics-config', () => getAnalyticsConfig());

const isWaylandSession = () => process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;

if (isWaylandSession()) {
  console.log('Wayland session detected: enabling ozone platform flags');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'wayland');
}
// const remoteDebugPort = process.env.ELECTRON_REMOTE_DEBUG_PORT || '9222';
// app.commandLine.appendSwitch('remote-debugging-port', remoteDebugPort);
// console.log(`Remote debugging available on port ${remoteDebugPort}`);

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      additionalArguments: rendererWebSocketArguments,
    },
  })

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })

  const devToolsOptions = { mode: 'bottom' }

  // Inject analytics config into browser window after page loads
  win.webContents.on('did-finish-load', () => {
    const config = getAnalyticsConfig();
    const configJson = JSON.stringify(config);
    // Always overwrite localStorage with current non-secret env config
    win.webContents.executeJavaScript(`
      const newConfig = ${configJson};
      localStorage.setItem('analyticsConfig', JSON.stringify(newConfig));
      console.log('[Electron] Analytics config updated:', {
        baseUrl: newConfig.baseUrl,
        hasKey: Boolean(newConfig.key),
        enabled: Boolean(newConfig.enabled),
        authMode: newConfig.authMode
      });
    `);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    console.log('Loading URL:', process.env.VITE_DEV_SERVER_URL)
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    console.log('Loading file:', path.join(__dirname, '../dist/index.html'))
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (shouldOpenDevTools({ allowDevServerDefault: !app.isPackaged })) {
    win.webContents.openDevTools(devToolsOptions)
  }

  win.webContents.on('context-menu', (event, params) => {
    event.preventDefault()
    const contextTemplate = [
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      {
        label: 'Inspect Element',
        click: () => {
          win.webContents.inspectElement(params.x, params.y)
          if (isWaylandSession()) {
            const devtools = win.webContents.devToolsWebContents
            devtools?.focus?.()
          }
        }
      }
    ]
    const menu = Menu.buildFromTemplate(contextTemplate)
    menu.popup({ window: win })
  })
}

app.whenReady().then(async () => {
  // Configure proxy from system environment
  const proxyUrl = getSystemProxy();
  if (proxyUrl) {
    console.log('[Electron] Using system proxy:', proxyUrl);
    await session.defaultSession.setProxy({
      proxyRules: proxyUrl,
      proxyBypassRules: 'localhost,127.0.0.1,::1'
    });
  } else {
    console.log('[Electron] No system proxy detected');
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
