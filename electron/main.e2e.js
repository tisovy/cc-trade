import './env-setup.js';
import { app, BrowserWindow, Menu, ipcMain, protocol, session } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import {
    captureFuturesTestnetExecutionConfig,
} from './services/futures-testnet-execution-config.js'
import {
    createLocalWebSocketAccess,
} from './services/local-websocket-access.js'
import { captureE2eMockWebSocketAccess } from './e2e-websocket-route.js'
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

const futuresExecutionConfig = captureFuturesTestnetExecutionConfig({
    futuresReadMode: 'mock',
    forceDisabled: true,
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

setupBinanceConnection({
    localWebSocketAccess,
    futuresExecutionConfig,
});

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
        futuresReadEnvironment: process.env.FUTURES_READ_ENVIRONMENT,
        analyticsConfig: {
            baseUrl: 'http://localhost:3000',
            enabled: false,
            authMode: 'none',
        },
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
