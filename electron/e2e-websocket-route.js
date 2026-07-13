const E2E_MOCK_WEBSOCKET_ENV = 'E2E_MOCK_WS_URL'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export const resolveE2eMockWebSocketAccess = (value) => {
  if (typeof value !== 'string' || !value) return null

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const port = Number(url.port)
    if (url.protocol !== 'ws:'
      || !LOOPBACK_HOSTS.has(host)
      || !Number.isSafeInteger(port)
      || port < 1
      || port > 65535
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash) {
      return null
    }

    return Object.freeze({
      host,
      port,
      token: '',
      tokenParam: 'token',
    })
  } catch {
    return null
  }
}

export const captureE2eMockWebSocketAccess = (environment = {}) => {
  const value = environment[E2E_MOCK_WEBSOCKET_ENV]
  delete environment[E2E_MOCK_WEBSOCKET_ENV]
  return resolveE2eMockWebSocketAccess(value)
}
