import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useWebSocket from './useWebSocket'

describe('useWebSocket', () => {
    let mockWebSocket
    let originalWebSocket

    beforeEach(() => {
        originalWebSocket = global.WebSocket
        // Frames reach the desk through `addEventListener` now, because the
        // boundary that reads them fans them out to several subscribers.
        const listeners = new Map()
        mockWebSocket = {
            send: vi.fn(),
            close: vi.fn(),
            readyState: 1, // WebSocket.OPEN
            onopen: null,
            onclose: null,
            onerror: null,
            addEventListener: vi.fn((type, listener) => {
                const held = listeners.get(type) ?? new Set()
                held.add(listener)
                listeners.set(type, held)
            }),
            removeEventListener: vi.fn((type, listener) => {
                listeners.get(type)?.delete(listener)
            }),
            deliver: (type, event) => {
                for (const listener of [...(listeners.get(type) ?? [])]) listener(event)
            },
        }

        global.WebSocket = vi.fn(function () {
            return mockWebSocket
        })
        global.WebSocket.OPEN = 1
        vi.useFakeTimers()
    })

    afterEach(() => {
        global.WebSocket = originalWebSocket
        vi.useRealTimers()
    })

    it('should connect to websocket on mount', () => {
        const url = 'ws://test.com'
        renderHook(() => useWebSocket(url, {}, vi.fn()))
        expect(global.WebSocket).toHaveBeenCalledWith(url)
    })

    it('should redact local websocket token in connection logs', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const url = 'ws://127.0.0.1:14477/?token=abc123'

        renderHook(() => useWebSocket(url, {}, vi.fn()))

        expect(global.WebSocket).toHaveBeenCalledWith(url)
        expect(logSpy).toHaveBeenCalledWith('Connecting to WebSocket:', 'ws://127.0.0.1:14477/?token=redacted')

        logSpy.mockRestore()
    })

    it('should send detail request on open', () => {
        const detail = {
            symbol: 'BTCUSDT',
            interval: '1m',
            requestId: '123',
            panelState: { foo: 'bar' }
        }

        renderHook(() => useWebSocket('ws://test.com', detail, vi.fn()))

        act(() => {
            mockWebSocket.onopen()
        })

        expect(mockWebSocket.send).toHaveBeenCalled()
        const sentData = JSON.parse(mockWebSocket.send.mock.calls[0][0])
        expect(sentData.request).toBe('chart')
        expect(sentData.data.selected).toBe('BTCUSDT')
    })

    it('should handle incoming messages', () => {
        const handleMessage = vi.fn()
        renderHook(() => useWebSocket('ws://test.com', {}, handleMessage))

        act(() => {
            mockWebSocket.onopen()
        })

        // Test with valid JSON message
        const jsonEvent = { data: JSON.stringify({ type: 'test', payload: 'data' }) }
        act(() => {
            mockWebSocket.deliver('message', jsonEvent)
        })

        // Handler receives (event, ws, frame) — the frame already read and named
        expect(handleMessage).toHaveBeenCalled()
        const [receivedEvent, receivedWs, frame] = handleMessage.mock.calls[0]
        expect(receivedEvent).toEqual(jsonEvent)
        expect(receivedWs).toBe(mockWebSocket)
        expect(frame).toEqual({
            kind: 'account',
            payload: { type: 'test', payload: 'data' },
        })
    })

    // Four subscribers used to parse the same frame four times, each to find out
    // whether it wanted it.
    it('reads a delivered frame once however many subscribers are listening', async () => {
        const parse = vi.spyOn(JSON, 'parse')
        const { ensureDeskFrameRouter, DESK_FRAME_KINDS } = await import('../utils/deskFrameRouter')
        renderHook(() => useWebSocket('ws://test.com', {}, vi.fn()))

        act(() => {
            mockWebSocket.onopen()
        })
        const router = ensureDeskFrameRouter(mockWebSocket)
        const account = vi.fn()
        const market = vi.fn()
        router.subscribe(DESK_FRAME_KINDS.ACCOUNT, account)
        router.subscribe(DESK_FRAME_KINDS.ACCOUNT, vi.fn())
        router.subscribe(DESK_FRAME_KINDS.MARKET, market)

        parse.mockClear()
        act(() => {
            mockWebSocket.deliver('message', { data: JSON.stringify({ type: 'futures_account_state' }) })
        })

        expect(parse).toHaveBeenCalledTimes(1)
        expect(account).toHaveBeenCalledOnce()
        // The subscriber that reads quotes is never handed an account frame.
        expect(market).not.toHaveBeenCalled()
        parse.mockRestore()
    })

    it('should attempt to reconnect on close', () => {
        renderHook(() => useWebSocket('ws://test.com', {}, vi.fn()))

        act(() => {
            mockWebSocket.onopen()
        })

        // Clear initial call
        global.WebSocket.mockClear()

        act(() => {
            mockWebSocket.onclose({ code: 1006 })
        })

        expect(global.WebSocket).not.toHaveBeenCalled() // Should wait for timeout

        act(() => {
            vi.advanceTimersByTime(500)
        })

        expect(global.WebSocket).toHaveBeenCalledTimes(1)
    })

    // The `invalid token` flood: the same token was re-offered 120 times a
    // minute for the whole session, and the log said nothing else.
    it('stops retrying when the backend refuses the session token', () => {
        const { result } = renderHook(() => useWebSocket('ws://127.0.0.1:14477/?token=stale', {}, vi.fn()))

        act(() => { mockWebSocket.onopen() })
        global.WebSocket.mockClear()

        act(() => { mockWebSocket.onclose({ code: 4401 }) })

        expect(result.current.failure).toMatchObject({ code: 'AUTHENTICATION_REJECTED' })
        act(() => { vi.advanceTimersByTime(60_000) })
        expect(global.WebSocket).not.toHaveBeenCalled()
    })

    it('resumes only on an explicit operator action', () => {
        const { result } = renderHook(() => useWebSocket('ws://127.0.0.1:14477/?token=stale', {}, vi.fn()))

        act(() => { mockWebSocket.onclose({ code: 4401 }) })
        global.WebSocket.mockClear()

        act(() => { result.current.reconnect() })

        expect(global.WebSocket).toHaveBeenCalledTimes(1)
        expect(result.current.failure).toBeNull()
    })

    it('keeps retrying an ordinary transport loss, so only authentication is terminal', () => {
        const { result } = renderHook(() => useWebSocket('ws://test.com', {}, vi.fn()))

        act(() => { mockWebSocket.onopen() })
        global.WebSocket.mockClear()

        act(() => { mockWebSocket.onclose({ code: 1006 }) })
        act(() => { vi.advanceTimersByTime(500) })

        expect(global.WebSocket).toHaveBeenCalledTimes(1)
        expect(result.current.failure).toBeNull()
    })

    it('attempts no connection at all when this window has no runtime address', () => {
        const { result } = renderHook(() => useWebSocket(null, {}, vi.fn()))

        expect(global.WebSocket).not.toHaveBeenCalled()
        expect(result.current.failure).toMatchObject({ code: 'RUNTIME_UNAVAILABLE' })

        act(() => { vi.advanceTimersByTime(60_000) })
        expect(global.WebSocket).not.toHaveBeenCalled()
    })

    it('should reuse existing subscriptions', () => {
        const { result } = renderHook(() => useWebSocket('ws://test.com', null, vi.fn()))

        act(() => {
            mockWebSocket.onopen()
        })

        const config = {
            channelId: 'test-channel',
            channelType: 'detail',
            symbol: 'BTCUSDT',
            interval: '1m'
        }

        // First subscription
        act(() => {
            result.current.subscribe(config)
        })
        expect(mockWebSocket.send).toHaveBeenCalledTimes(1)

        // Second subscription (should reuse)
        act(() => {
            result.current.subscribe(config)
        })
        expect(mockWebSocket.send).toHaveBeenCalledTimes(1) // No new request
    })

    it('should enforce max connections (LRU)', () => {
        const { result } = renderHook(() => useWebSocket('ws://test.com', null, vi.fn()))

        act(() => {
            mockWebSocket.onopen()
        })

        // Fill up to 50 connections
        for (let i = 0; i < 50; i++) {
            act(() => {
                result.current.subscribe({
                    channelId: `channel-${i}`,
                    channelType: 'mini',
                    symbol: `SYM${i}`,
                    interval: '1m'
                })
            })
        }

        expect(mockWebSocket.send).toHaveBeenCalledTimes(50)

        // Add 51st connection (should trigger eviction of oldest)
        // We need to advance time slightly to ensure lastUsed timestamps differ if needed,
        // but our loop runs fast. The first one added (channel-0) should be oldest.

        act(() => {
            result.current.subscribe({
                channelId: 'channel-50',
                channelType: 'mini',
                symbol: 'SYM50',
                interval: '1m'
            })
        })

        // Should see unsubscribe for channel-0 and subscribe for channel-50
        // Total calls: 50 initial + 1 unsubscribe + 1 subscribe = 52
        expect(mockWebSocket.send).toHaveBeenCalledTimes(52)

        const calls = mockWebSocket.send.mock.calls
        const unsubscribeCall = JSON.parse(calls[50][0])
        expect(unsubscribeCall.action).toBe('unsubscribe')
        // channel-0 was the first one added, so it should be the oldest
        // Note: The actual ID might depend on implementation details, but we expect an unsubscribe
    })
})
