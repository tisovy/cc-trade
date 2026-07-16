const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{0,256}$/
const DEFAULT_LOCAL_WEBSOCKET_PORT = 14477

const fallbackRuntime = () => ({
  localWebSocketAccess: {
    host: '127.0.0.1',
    port: DEFAULT_LOCAL_WEBSOCKET_PORT,
    token: '',
    tokenParam: 'token',
  },
  analyticsConfig: null,
})

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const readLocalWebSocketAccess = (source) => {
  if (!isRecord(source)) return fallbackRuntime().localWebSocketAccess

  const { host, port, token, tokenParam } = source
  if (!LOOPBACK_HOSTS.has(host)
    || !Number.isSafeInteger(port)
    || port < 1
    || port > 65535
    || typeof token !== 'string'
    || !TOKEN_PATTERN.test(token)
    || tokenParam !== 'token') {
    return fallbackRuntime().localWebSocketAccess
  }

  return { host, port, token, tokenParam }
}

const readAnalyticsConfig = (source) => {
  if (!isRecord(source)) return null

  const config = {}
  if (typeof source.baseUrl === 'string' && source.baseUrl.length <= 2048) config.baseUrl = source.baseUrl
  if (typeof source.key === 'string' && source.key.length <= 1024) config.key = source.key
  if (typeof source.pollInterval === 'number' && Number.isFinite(source.pollInterval)) config.pollInterval = source.pollInterval
  if (typeof source.limit === 'number' && Number.isFinite(source.limit)) config.limit = source.limit
  if (typeof source.enabled === 'boolean') config.enabled = source.enabled
  if (source.authMode === 'none' || source.authMode === 'main-process-required') config.authMode = source.authMode

  return Object.keys(config).length > 0 ? config : null
}

export const getRendererRuntime = () => {
  const runtime = globalThis.ccTradeRuntime
  if (!isRecord(runtime)) return fallbackRuntime()

  return {
    localWebSocketAccess: readLocalWebSocketAccess(runtime.localWebSocketAccess),
    analyticsConfig: readAnalyticsConfig(runtime.analyticsConfig),
  }
}

export const getRendererAnalyticsConfig = () => getRendererRuntime().analyticsConfig
