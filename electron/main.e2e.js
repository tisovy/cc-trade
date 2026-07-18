import './env-setup.js';
import { app, BrowserWindow, Menu, ipcMain, protocol, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import {
    captureFuturesProductionExecutionConfig,
} from './services/futures-production-execution-config.js'
import {
    createLocalWebSocketAccess,
} from './services/local-websocket-access.js'
import { captureE2eMockWebSocketAccess } from './e2e-websocket-route.js'
import {
    createE2eFuturesProductionExecutionRuntime,
} from './e2e-futures-production-execution-runtime.js'
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

registerRendererAppProtocolScheme(protocol)

const futuresProductionExecutionConfig = captureFuturesProductionExecutionConfig({
    forceDisabled: true,
    liveAuthorized: false,
})

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
const rendererWebSocketAccess = captureE2eMockWebSocketAccess(process.env) || localWebSocketAccess
const rendererRuntimeRegistry = createRendererRuntimeRegistry(ipcMain)
const futuresProductionExecutionRuntime = createE2eFuturesProductionExecutionRuntime()

const processFetch = globalThis.fetch?.bind(globalThis)
globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL
        ? input.toString()
        : input?.url
    let target = null
    try {
        target = typeof rawUrl === 'string' ? new URL(rawUrl) : null
    } catch {
        target = null
    }
    if (target?.hostname === 'fapi.binance.com'
        || target?.hostname === 'fstream.binance.com') {
        console.error(`[e2e] forbidden main-process Futures network escape: ${target.hostname}`)
        setImmediate(() => app.exit(86))
        throw new Error('E2E Futures network escape blocked')
    }
    if (typeof processFetch !== 'function') throw new Error('Fetch is unavailable')
    return processFetch(input, init)
}

const binanceController = setupBinanceConnection({
    localWebSocketAccess,
    futuresProductionExecutionConfig,
    futuresProductionExecutionRuntime,
});
let hasCompletedBinanceShutdown = false
let binanceShutdownPromise = null

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
    const contentSecurityPolicy = createRendererContentSecurityPolicy({
        localWebSocketAccess: rendererWebSocketAccess,
    })
    if (devServerUrl && !hasInstalledDevServerCsp) {
        installRendererContentSecurityPolicyHeader(session.defaultSession, {
            rendererUrl: devServerUrl,
            contentSecurityPolicy,
        })
        hasInstalledDevServerCsp = true
    }
    const rendererRuntime = createRendererRuntime({
        localWebSocketAccess: rendererWebSocketAccess,
        analyticsConfig: {
            baseUrl: 'http://localhost:3000',
            enabled: false,
            authMode: 'none',
        },
    })
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        // Keep host-desktop keystrokes out while retaining compositor-backed screenshots.
        focusable: false,
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

    if (shouldOpenDevTools({ allowDevServerDefault: false })) {
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

app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({
        urls: [
            'https://fapi.binance.com/*',
            'wss://fstream.binance.com/*',
        ],
    }, (details, callback) => {
        callback({ cancel: true })
        console.error(`[e2e] forbidden production Futures network escape: ${details.method}`)
        setImmediate(() => app.exit(86))
    })

    installRendererAppProtocol({
        protocol,
        rootDirectory: rendererRootDirectory,
        contentSecurityPolicy: createRendererContentSecurityPolicy({
            localWebSocketAccess: rendererWebSocketAccess,
        }),
    })

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

app.on('before-quit', (event) => {
    if (hasCompletedBinanceShutdown) return
    event.preventDefault()
    if (binanceShutdownPromise === null) {
        binanceShutdownPromise = binanceController.close()
            .catch(error => console.error('[e2e] local Binance controller shutdown failed', error))
            .finally(() => {
                hasCompletedBinanceShutdown = true
                app.quit()
            })
    }
})
