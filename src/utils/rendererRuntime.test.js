import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRendererAnalyticsConfig,
  getRendererFuturesReadEnvironment,
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
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      futuresReadEnvironment: 'testnet',
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
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      futuresReadEnvironment: 'testnet',
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
      token: 'sessionToken_123',
      tokenParam: 'token',
    })
    expect(getRendererFuturesReadEnvironment()).toBe('testnet')
    expect(getRendererAnalyticsConfig()).toMatchObject({ baseUrl: 'https://analytics.example.test' })
  })

  it('fails closed for a remote local-WebSocket host and malformed bridge data', () => {
    vi.stubGlobal('ccTradeRuntime', {
      localWebSocketAccess: {
        host: 'example.com',
        token: 'sessionToken_123',
        tokenParam: 'token',
      },
      futuresReadEnvironment: 'production',
      analyticsConfig: { secret: 'not-exposed' },
    })

    expect(getRendererRuntime()).toEqual({
      localWebSocketAccess: {
        host: '127.0.0.1',
        token: '',
        tokenParam: 'token',
      },
      futuresReadEnvironment: 'mock',
      analyticsConfig: null,
    })
  })
})
