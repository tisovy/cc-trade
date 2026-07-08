import './env-setup.js';
import { app, BrowserWindow, Menu } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { shouldOpenDevTools } from './devtools.js'
import { setupBinanceConnection } from './services/binance-connection.js'
import {
    createLocalWebSocketAccess,
    createRendererWebSocketArguments,
} from './services/local-websocket-access.js'

const localWebSocketAccess = createLocalWebSocketAccess();
const rendererWebSocketArguments = createRendererWebSocketArguments(localWebSocketAccess);

setupBinanceConnection({ localWebSocketAccess });

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

    if (process.env.VITE_DEV_SERVER_URL) {
        console.log('Loading URL:', process.env.VITE_DEV_SERVER_URL)
        win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        console.log('Loading file:', path.join(__dirname, '../dist/index.html'))
        win.loadFile(path.join(__dirname, '../dist/index.html'))
    }

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
