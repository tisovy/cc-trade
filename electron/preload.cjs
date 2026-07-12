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

const fallbackRuntime = () => Object.freeze({
  localWebSocketAccess: Object.freeze({
    host: '127.0.0.1',
    token: '',
    tokenParam: 'token',
  }),
  futuresReadEnvironment: 'mock',
  analyticsConfig: null,
})

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
    if (!hasExactKeys(runtime, ['version', 'localWebSocketAccess', 'futuresReadEnvironment', 'analyticsConfig'])) {
      return fallbackRuntime()
    }
    if (runtime.version !== 1 || !hasExactKeys(runtime.localWebSocketAccess, ['host', 'token', 'tokenParam'])) {
      return fallbackRuntime()
    }

    const { host, token, tokenParam } = runtime.localWebSocketAccess
    if (!LOOPBACK_HOSTS.has(host) || typeof token !== 'string' || !TOKEN_PATTERN.test(token) || tokenParam !== 'token') {
      return fallbackRuntime()
    }

    return Object.freeze({
      localWebSocketAccess: Object.freeze({ host, token, tokenParam }),
      futuresReadEnvironment: runtime.futuresReadEnvironment === 'testnet' ? 'testnet' : 'mock',
      analyticsConfig: runtime.analyticsConfig === null ? null : normalizeAnalyticsConfig(runtime.analyticsConfig),
    })
  } catch {
    return fallbackRuntime()
  }
}

contextBridge.exposeInMainWorld('ccTradeRuntime', parseRuntime(ipcRenderer.sendSync(RUNTIME_IPC_CHANNEL)))
