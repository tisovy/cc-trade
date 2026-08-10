import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRendererAnalyticsConfig,
  getRendererRuntime,
} from './rendererRuntime'
import { getRendererLocalWebSocketAccess } from './localWebSocketAccess'

describe('renderer runtime bridge reader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads only the reviewed bridge fields without a renderer process object', () => {
    vi.stubGlobal('ccTradeRuntime', {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14477,
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      analyticsConfig: {
        baseUrl: 'https://analytics.example.test',
        key: 'public-key',
        pollInterval: 6000,
        limit: 20,
        enabled: true,
        authMode: 'none',
      },
    })

    expect(getRendererRuntime()).toEqual({
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 14477,
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      analyticsConfig: {
        baseUrl: 'https://analytics.example.test',
        key: 'public-key',
        pollInterval: 6000,
        limit: 20,
        enabled: true,
        authMode: 'none',
      },
    })
    expect(getRendererLocalWebSocketAccess()).toEqual({
      host: '127.0.0.1',
      port: 14477,
      token: 'sessionToken_123',
      tokenParam: 'token',
    })
    expect(getRendererAnalyticsConfig()).toMatchObject({ baseUrl: 'https://analytics.example.test' })
  })

  it('fails closed for a remote local-WebSocket host and malformed bridge data', () => {
    vi.stubGlobal('ccTradeRuntime', {
      localWebSocketAccess: {
        host: 'example.com',
        port: 14477,
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      analyticsConfig: { secret: 'not-exposed' },
    })

    // No endpoint is invented for a bridge that failed validation, and none is
    // invented for a window that was never issued one.
    expect(getRendererRuntime()).toBeNull()
    expect(getRendererLocalWebSocketAccess()).toBeNull()
    expect(getRendererAnalyticsConfig()).toBeNull()

    vi.unstubAllGlobals()
    expect(getRendererRuntime()).toBeNull()
    expect(getRendererLocalWebSocketAccess()).toBeNull()
  })
})
