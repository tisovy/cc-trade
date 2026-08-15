import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useFuturesLocalWorkstationConnection, {
  FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS,
} from './useFuturesLocalWorkstationConnection.js'

const originalWebSocket = globalThis.WebSocket
const originalRuntime = globalThis.ccTradeRuntime

afterEach(() => {
  vi.useRealTimers()
  globalThis.WebSocket = originalWebSocket
  if (originalRuntime === undefined) delete globalThis.ccTradeRuntime
  else globalThis.ccTradeRuntime = originalRuntime
})

describe('isolated Futures local workstation connection', () => {
  it('opens only the exact runtime-owned loopback URL and sends bounded JSON', () => {
    const sockets = []
    class LocalSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.sent = []
        sockets.push(this)
      }

      open() {
        this.readyState = 1
        this.onopen?.()
      }

      send(value) {
        this.sent.push(value)
      }

      close() {
        this.readyState = 3
        this.onclose?.()
      }
    }
    globalThis.WebSocket = LocalSocket
    globalThis.ccTradeRuntime = {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 15555,
        token: 'local-token-1',
        tokenParam: 'token',
      },
    }

    const { result, unmount } = renderHook(() => (
      useFuturesLocalWorkstationConnection({ enabled: true })
    ))
    expect(sockets).toHaveLength(1)
    const url = new URL(sockets[0].url)
    expect(url.protocol).toBe('ws:')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.port).toBe('15555')
    expect(url.searchParams.get('token')).toBe('local-token-1')
    expect(sockets[0].url).not.toMatch(/binance|fapi|fstream/i)

    act(() => sockets[0].open())
    expect(result.current.wsConnection).toBe(sockets[0])
    expect(result.current.sendMessage({ action: 'read-only' })).toBe(true)
    expect(sockets[0].sent).toEqual(['{"action":"read-only"}'])
    unmount()
    expect(sockets[0].readyState).toBe(3)
  })

  it('bounds consecutive local reconnect attempts and owns one timer at a time', () => {
    vi.useFakeTimers()
    const sockets = []
    class FailingLocalSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        sockets.push(this)
        setTimeout(() => {
          this.readyState = 3
          this.onclose?.()
        }, 0)
      }

      close() {
        this.readyState = 3
      }
    }
    globalThis.WebSocket = FailingLocalSocket
    globalThis.ccTradeRuntime = {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 15555,
        token: 'local-token-1',
        tokenParam: 'token',
      },
    }

    const { unmount } = renderHook(() => (
      useFuturesLocalWorkstationConnection({ enabled: true })
    ))
    act(() => vi.runAllTimers())
    expect(sockets).toHaveLength(
      FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.RECONNECT_ATTEMPTS + 1,
    )
    expect(vi.getTimerCount()).toBe(0)
    unmount()
  })

  // This hook carried its own copy of the fallback endpoint: with no runtime it
  // dialled `127.0.0.1:14477` with an empty token, which the backend answers
  // with 401.
  it('opens nothing at all when this window was issued no runtime', () => {
    vi.useFakeTimers()
    const sockets = []
    globalThis.WebSocket = class { constructor(url) { sockets.push(url) } }
    delete globalThis.ccTradeRuntime

    const { unmount } = renderHook(() => (
      useFuturesLocalWorkstationConnection({ enabled: true })
    ))
    act(() => vi.advanceTimersByTime(60_000))

    expect(sockets).toEqual([])
    unmount()
  })

  it('stops reconnecting when the backend refuses the session token', () => {
    vi.useFakeTimers()
    const sockets = []
    class RefusedLocalSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        sockets.push(this)
        setTimeout(() => {
          this.readyState = 3
          this.onclose?.({ code: 4401 })
        }, 0)
      }

      close() {
        this.readyState = 3
      }
    }
    globalThis.WebSocket = RefusedLocalSocket
    globalThis.ccTradeRuntime = {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 15555,
        token: 'stale-token',
        tokenParam: 'token',
      },
    }

    const { unmount } = renderHook(() => (
      useFuturesLocalWorkstationConnection({ enabled: true })
    ))
    act(() => vi.runAllTimers())

    expect(sockets).toHaveLength(1)
    unmount()
  })

  it('closes a local socket that never completes its handshake', () => {
    vi.useFakeTimers()
    const sockets = []
    class HangingLocalSocket {
      constructor(url) {
        this.url = url
        this.readyState = 0
        this.close = vi.fn(() => {
          this.readyState = 3
          this.onclose?.()
        })
        sockets.push(this)
      }
    }
    globalThis.WebSocket = HangingLocalSocket
    globalThis.ccTradeRuntime = {
      localWebSocketAccess: {
        host: '127.0.0.1',
        port: 15555,
        token: 'local-token-1',
        tokenParam: 'token',
      },
    }

    const { unmount } = renderHook(() => (
      useFuturesLocalWorkstationConnection({ enabled: true })
    ))
    act(() => {
      vi.advanceTimersByTime(FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.CONNECT_TIMEOUT_MS)
    })
    expect(sockets[0].close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
