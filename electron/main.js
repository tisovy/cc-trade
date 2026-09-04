import { app, BrowserWindow, Menu, ipcMain, protocol, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { installFatalRuntimeHandlers } from './fatal-runtime.js'
import { installRendererZoomControls } from './renderer-zoom.js'
import { createFuturesSettledIncomeStore } from './services/futures-settled-income-store.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import { createDeskDiagnosticRecord } from './services/desk-diagnostic-record.js'
import {
  createLocalWebSocketAccess,
} from './services/local-websocket-access.js'
import { configureLinuxSafeStorageBackend } from './linux-safe-storage-backend.js'
import {
  createRendererRuntime,
  createRendererRuntimeRegistry,
} from './renderer-runtime.js'
import {
  createRendererNavigationGuard,
  createSecureRendererWebPreferences,
  installRendererContentSecurityPolicyHeader,
  installRendererSecurityGuards,
} from './renderer-security.js'
import {
  createRendererContentSecurityPolicy,
  installRendererAppProtocol,
  RENDERER_ENTRY_URL,
  RENDERER_ORIGIN,
  registerRendererAppProtocolScheme,
  resolveTrustedRendererDevServerUrl,
} from './renderer-protocol.js'

let deskDiagnosticRecord = null
// Installed before executable initialization. The stderr diagnostic is
// synchronous; the desk record is best effort and is never awaited on a fault.
installFatalRuntimeHandlers({
  exit: code => app.exit(code),
  recordFault: reading => deskDiagnosticRecord?.record('fault', reading),
})

if (configureLinuxSafeStorageBackend({ app })) {
  console.log('[Electron] Hyprland safeStorage backend pinned to gnome-libsecret')
}

registerRendererAppProtocolScheme(protocol)

// Legacy Futures Testnet and guarded-production variables are retired; the
// futures path uses its own BFK/BFS credentials, separate from Spot's BK/BS.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('FUTURES_TESTNET_')
    || key.startsWith('FUTURES_READ_')
    || key.startsWith('FUTURES_PRODUCTION_')) {
    delete process.env[key]
  }
}

// A second app instance exits before opening a renderer.
const hasExclusiveExecutionOwnership = app.requestSingleInstanceLock()
if (!hasExclusiveExecutionOwnership) app.quit()

const analyticsSecret = process.env.ANALYTICS_SECRET || '';
if (process.env.ANALYTICS_SECRET) {
  process.env.ANALYTICS_REQUIRES_MAIN_SIGNING = 'true';
  delete process.env.ANALYTICS_SECRET;
}

const rendererDevServerUrl = resolveTrustedRendererDevServerUrl({
  value: process.env.VITE_DEV_SERVER_URL,
  isPackaged: app.isPackaged,
})
const localWebSocketAccess = {
  ...createLocalWebSocketAccess(),
  allowedOrigins: [
    RENDERER_ORIGIN,
    ...(rendererDevServerUrl ? [new URL(rendererDevServerUrl).origin] : []),
  ],
};
const rendererRuntimeRegistry = createRendererRuntimeRegistry(ipcMain)
let binanceController = null
let isExecutionShutdownStarted = false

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
const rendererRootDirectory = path.join(__dirname, '../dist')
let hasInstalledDevServerCsp = false

function createWindow() {
  const devServerUrl = rendererDevServerUrl
  const rendererUrl = devServerUrl || RENDERER_ENTRY_URL
  const analyticsConfig = getAnalyticsConfig()
  const contentSecurityPolicy = createRendererContentSecurityPolicy({
    analyticsBaseUrl: analyticsConfig.baseUrl,
    localWebSocketAccess,
  })
  if (devServerUrl && !hasInstalledDevServerCsp) {
    installRendererContentSecurityPolicyHeader(session.defaultSession, {
      rendererUrl: devServerUrl,
      contentSecurityPolicy,
    })
    hasInstalledDevServerCsp = true
  }
  // The runtime exists before the window that will ask for it, and the two are
  // bound in one step that nothing can be inserted between. The preload asks
  // synchronously over IPC the moment its document is created; a sender the
  // registry does not know receives no runtime at all, and a renderer with no
  // runtime fails closed with a stated reason instead of dialling a default
  // endpoint it can never authenticate against.
  const rendererRuntime = createRendererRuntime({
    localWebSocketAccess,
    analyticsConfig,
  })
  const win = rendererRuntimeRegistry.createRegisteredWindow(rendererRuntime, () => new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: createSecureRendererWebPreferences({
      preload: path.join(__dirname, 'preload.cjs'),
    }),
  }))

  installRendererSecurityGuards(
    win.webContents,
    createRendererNavigationGuard({ devServerUrl, rendererUrl }),
  )

  installRendererZoomControls(win.webContents, {
    settingsDirectory: app.getPath('userData'),
  })

  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })

  const devToolsOptions = { mode: 'bottom' }

  console.log('Loading renderer URL:', rendererUrl)
  win.loadURL(rendererUrl)

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
  if (!hasExclusiveExecutionOwnership) return

  // The desk keeps its own record of what it did, under its own data directory.
  // The path is stated once, here, because a record the operator cannot find is
  // a record that does not exist.
  deskDiagnosticRecord = createDeskDiagnosticRecord({
    directory: path.join(app.getPath('userData'), 'diagnostics'),
  })
  console.log('[Electron] Desk record:', deskDiagnosticRecord.directory)
  deskDiagnosticRecord.record('session', { event: 'started', version: app.getVersion() })

  // What the desk already read of the income record, kept between runs. Stated
  // here beside the diagnostics path for the same reason: a store the operator
  // cannot find is a store they cannot delete when it is wrong.
  const settledIncomeStore = createFuturesSettledIncomeStore({
    directory: path.join(app.getPath('userData'), 'state'),
  })

  binanceController = setupBinanceConnection({
    localWebSocketAccess,
    diagnosticRecord: deskDiagnosticRecord,
    settledIncomeStore,
  })

  installRendererAppProtocol({
    protocol,
    rootDirectory: rendererRootDirectory,
    contentSecurityPolicy: createRendererContentSecurityPolicy({
      analyticsBaseUrl: getAnalyticsConfig().baseUrl,
      localWebSocketAccess,
    }),
  })

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
}).catch((error) => {
  console.error('[Electron] Main-process startup failed:', error)
  app.quit()
})

app.on('before-quit', (event) => {
  if (!binanceController || isExecutionShutdownStarted) return
  event.preventDefault()
  isExecutionShutdownStarted = true
  // A run that ended is a fact the next reading needs: without it, a desk that
  // was closed and one that died look the same in the record.
  deskDiagnosticRecord?.record('session', { event: 'stopped', version: app.getVersion() })
  void binanceController.close()
    .catch((error) => {
      console.error('[Electron] Execution shutdown failed:', error)
    })
    .finally(() => {
      deskDiagnosticRecord?.close()
      app.quit()
    })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
