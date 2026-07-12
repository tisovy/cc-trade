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
  futuresReadEnvironment,
  analyticsConfig,
} = {}) => {
  return Object.freeze({
    version: 1,
    localWebSocketAccess: Object.freeze({
      host: normalizeLoopbackHost(localWebSocketAccess.host),
      token: normalizeToken(localWebSocketAccess.token),
      tokenParam: 'token',
    }),
    futuresReadEnvironment: futuresReadEnvironment === 'testnet' ? 'testnet' : 'mock',
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
    event.returnValue = runtimes.get(event.sender) || null
  })

  return Object.freeze({
    register: (webContents, runtime) => {
      runtimes.set(webContents, runtime)
    },
  })
}
