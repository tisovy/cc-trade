import { app, BrowserWindow, Menu, ipcMain, protocol, safeStorage, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import {
  captureFuturesProductionExecutionConfig,
} from './services/futures-production-execution-config.js'
import {
  createFuturesProductionExecutionVerificationRuntime,
} from './services/futures-production-execution-runtime-composition.js'
import {
  FUTURES_PRODUCTION_LIVE_AUTHORIZED,
} from './services/futures-production-execution-composition.js'
import {
  installFuturesProductionExecutionLogSanitizer,
} from './services/futures-production-execution-sanitizer.js'
import {
  createElectronSafeStorageProductionIntegrityKeyProtection,
} from './services/futures-production-execution-key-protection.js'
import {
  captureFuturesProductionOperatorStartupAction,
} from './services/futures-production-operator-startup.js'
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

if (configureLinuxSafeStorageBackend({ app })) {
  console.log('[Electron] Hyprland safeStorage backend pinned to gnome-libsecret')
}

registerRendererAppProtocolScheme(protocol)

// Futures Testnet is retired. Scrub every legacy Testnet/read variable before a
// BrowserWindow can exist; no Testnet value is captured or composed at runtime.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('FUTURES_TESTNET_') || key.startsWith('FUTURES_READ_')) {
    delete process.env[key]
  }
}
const futuresProductionSecretValues = [
  process.env.FUTURES_PRODUCTION_API_KEY,
  process.env.FUTURES_PRODUCTION_API_SECRET,
  process.env.FUTURES_PRODUCTION_RECOVERY_AUTHORIZATION,
]
const futuresProductionExecutionVerificationRuntime = (
  createFuturesProductionExecutionVerificationRuntime()
)
const futuresProductionExecutionConfig = captureFuturesProductionExecutionConfig({
  liveAuthorized: FUTURES_PRODUCTION_LIVE_AUTHORIZED,
  forceDisabled: futuresProductionExecutionVerificationRuntime !== null,
})
const futuresProductionOperatorStartup = captureFuturesProductionOperatorStartupAction()
installFuturesProductionExecutionLogSanitizer({
  secretValues: futuresProductionSecretValues,
})
futuresProductionSecretValues.fill(null)

// The durable execution ledger has exactly one process owner. A second app
// instance exits before opening the ledger or creating a renderer.
const hasExclusiveExecutionOwnership = app.requestSingleInstanceLock()
if (!hasExclusiveExecutionOwnership) app.quit()

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
  const rendererRuntime = createRendererRuntime({
    localWebSocketAccess,
    analyticsConfig,
  })
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: createSecureRendererWebPreferences({
      preload: path.join(__dirname, 'preload.cjs'),
    }),
  })

  rendererRuntimeRegistry.register(win.webContents, rendererRuntime)

  installRendererSecurityGuards(
    win.webContents,
    createRendererNavigationGuard({ devServerUrl, rendererUrl }),
  )

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
  if (futuresProductionOperatorStartup.requested
    && !futuresProductionOperatorStartup.valid) {
    throw new Error(futuresProductionOperatorStartup.code)
  }
  if (futuresProductionOperatorStartup.requested
    && futuresProductionExecutionVerificationRuntime !== null) {
    throw new Error('FUTURES_PRODUCTION_OPERATOR_ACTION_UNAVAILABLE_IN_VERIFICATION')
  }

  let futuresProductionExecutionKeyProtection = null
  try {
    futuresProductionExecutionKeyProtection = (
      createElectronSafeStorageProductionIntegrityKeyProtection({ safeStorage })
    )
  } catch (error) {
    console.warn('[Electron] Futures production secure storage unavailable:', error)
  }

  binanceController = setupBinanceConnection({
    localWebSocketAccess,
    futuresProductionExecutionConfig,
    futuresProductionExecutionKeyProtection,
    futuresProductionExecutionStorageDirectory: path.join(
      app.getPath('userData'),
      app.isPackaged
        ? 'futures-production-execution'
        : 'futures-production-execution-development',
      'v1',
    ),
    ...(futuresProductionExecutionVerificationRuntime === null ? {} : {
      futuresProductionExecutionRuntime: futuresProductionExecutionVerificationRuntime,
    }),
  })
  if (futuresProductionOperatorStartup.requested) {
    const futuresProductionRuntime = await binanceController.productionExecutionReady
    const recovered = await futuresProductionRuntime.recoverOperationally({
      authorization: futuresProductionExecutionConfig.recoveryAuthorization,
      action: futuresProductionOperatorStartup.action,
    })
    if (!recovered) {
      throw new Error('FUTURES_PRODUCTION_OPERATOR_ACTION_BLOCKED')
    }
  }

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
  void binanceController.close()
    .catch((error) => {
      console.error('[Electron] Execution shutdown failed:', error)
    })
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
