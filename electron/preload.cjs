const { contextBridge, ipcRenderer } = require('electron')

const RUNTIME_IPC_CHANNEL = 'cc-trade:renderer-runtime'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{0,256}$/


const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const hasExactKeys = (value, keys) => {
  if (!isRecord(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

// A sender with no registered runtime gets nothing. It used to get
// `127.0.0.1:14477` with an empty token — a real endpoint that answers 401 —
// so a window that was never issued a runtime retried forever instead of
// saying it had none.
const noRuntime = () => null

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

  return Object.freeze(config)
}

const parseRuntime = (runtime) => {
  try {
    if (!hasExactKeys(runtime, ['version', 'localWebSocketAccess', 'analyticsConfig'])) {
      return noRuntime()
    }
    if (runtime.version !== 1 || !hasExactKeys(runtime.localWebSocketAccess, ['host', 'port', 'token', 'tokenParam'])) {
      return noRuntime()
    }

    const { host, port, token, tokenParam } = runtime.localWebSocketAccess
    if (!LOOPBACK_HOSTS.has(host)
      || !Number.isSafeInteger(port)
      || port < 1
      || port > 65535
      || typeof token !== 'string'
      || !TOKEN_PATTERN.test(token)
      || tokenParam !== 'token') {
      return noRuntime()
    }

    return Object.freeze({
      localWebSocketAccess: Object.freeze({ host, port, token, tokenParam }),
      analyticsConfig: runtime.analyticsConfig === null ? null : normalizeAnalyticsConfig(runtime.analyticsConfig),
    })
  } catch {
    return noRuntime()
  }
}

contextBridge.exposeInMainWorld('ccTradeRuntime', parseRuntime(ipcRenderer.sendSync(RUNTIME_IPC_CHANNEL)))
