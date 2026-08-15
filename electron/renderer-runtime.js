export const RENDERER_RUNTIME_IPC_CHANNEL = 'cc-trade:renderer-runtime'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{0,256}$/

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const normalizeText = (value) => typeof value === 'string' ? value : ''

const normalizeLoopbackHost = (value) => {
  const host = normalizeText(value).trim().toLowerCase()
  return LOOPBACK_HOSTS.has(host) ? host : '127.0.0.1'
}

const normalizeToken = (value) => {
  const token = normalizeText(value)
  return TOKEN_PATTERN.test(token) ? token : ''
}

// No default port. A runtime that cannot state where the backend is is not a
// runtime, and pointing the renderer at a guess is what produced a window that
// dialled an endpoint it could never authenticate against.
const normalizePort = (value) => (
  Number.isSafeInteger(value) && value >= 1 && value <= 65535 ? value : null
)

const normalizeAnalyticsConfig = (source) => {
  if (!isRecord(source)) return null

  const config = {}
  if (typeof source.baseUrl === 'string' && source.baseUrl.length <= 2048) {
    config.baseUrl = source.baseUrl
  }
  if (typeof source.key === 'string' && source.key.length <= 1024) {
    config.key = source.key
  }
  if (typeof source.pollInterval === 'number' && Number.isFinite(source.pollInterval)) {
    config.pollInterval = source.pollInterval
  }
  if (typeof source.limit === 'number' && Number.isFinite(source.limit)) {
    config.limit = source.limit
  }
  if (typeof source.enabled === 'boolean') {
    config.enabled = source.enabled
  }
  if (source.authMode === 'none' || source.authMode === 'main-process-required') {
    config.authMode = source.authMode
  }

  return Object.keys(config).length > 0 ? config : null
}

export const createRendererRuntime = ({
  localWebSocketAccess = {},
  analyticsConfig,
} = {}) => {
  const port = normalizePort(localWebSocketAccess.port)
  // A runtime without a usable endpoint is not issued at all. The renderer then
  // has none, and fails closed with a stated reason.
  if (port === null) return null
  return Object.freeze({
    version: 1,
    localWebSocketAccess: Object.freeze({
      host: normalizeLoopbackHost(localWebSocketAccess.host),
      port,
      token: normalizeToken(localWebSocketAccess.token),
      tokenParam: 'token',
    }),
    analyticsConfig: normalizeAnalyticsConfig(analyticsConfig),
  })
}

export const createRendererRuntimeRegistry = (ipcMain) => {
  const runtimes = new WeakMap()

  ipcMain.on(RENDERER_RUNTIME_IPC_CHANNEL, (event) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      event.returnValue = null
      return
    }
    // A sender nobody registered gets nothing. There is no default endpoint
    // and no empty token to hand out: the renderer must fail closed and say
    // so, not spend the session retrying a handshake that cannot succeed.
    event.returnValue = runtimes.get(event.sender) || null
  })

  const register = (webContents, runtime) => {
    runtimes.set(webContents, runtime)
  }

  return Object.freeze({
    register,
    // Construction and registration in one step, so no code can run between a
    // window existing and its runtime being registered — the window is never
    // observable in a state where its own preload would be told there is no
    // runtime for it.
    createRegisteredWindow: (runtime, createWindow) => {
      const window = createWindow()
      register(window.webContents, runtime)
      return window
    },
  })
}
