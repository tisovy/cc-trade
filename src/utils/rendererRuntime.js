const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{0,256}$/

// There is no fallback runtime any more, and its absence is the point.
//
// A renderer whose runtime was never registered used to be handed
// `127.0.0.1:14477` with an empty token. That is a real endpoint the backend
// answers — with 401 — so a window that could never authenticate spent the
// session retrying a doomed handshake every 500 ms and filling the log with
// `invalid token`. A missing runtime is now missing: no endpoint, no token,
// and the caller has to say so instead of dialling a guess.

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const readLocalWebSocketAccess = (source) => {
  if (!isRecord(source)) return null

  const { host, port, token, tokenParam } = source
  if (!LOOPBACK_HOSTS.has(host)
    || !Number.isSafeInteger(port)
    || port < 1
    || port > 65535
    || typeof token !== 'string'
    || !TOKEN_PATTERN.test(token)
    || tokenParam !== 'token') {
    return null
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
  if (!isRecord(runtime)) return null

  const localWebSocketAccess = readLocalWebSocketAccess(runtime.localWebSocketAccess)
  if (localWebSocketAccess === null) return null

  return {
    localWebSocketAccess,
    analyticsConfig: readAnalyticsConfig(runtime.analyticsConfig),
  }
}

export const getRendererAnalyticsConfig = () => getRendererRuntime()?.analyticsConfig ?? null
