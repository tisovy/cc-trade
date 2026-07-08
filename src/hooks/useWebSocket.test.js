import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useWebSocket from './useWebSocket'

describe('useWebSocket', () => {
    let mockWebSocket
    let originalWebSocket

    beforeEach(() => {
        originalWebSocket = global.WebSocket
        mockWebSocket = {
            send: vi.fn(),
            close: vi.fn(),
            readyState: 1, // WebSocket.OPEN
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
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
            mockWebSocket.onmessage(jsonEvent)
        })

        // Handler receives (event, ws, normalizedMessage)
        expect(handleMessage).toHaveBeenCalled()
        const [receivedEvent, receivedWs, normalizedMsg] = handleMessage.mock.calls[0]
        expect(receivedEvent).toEqual(jsonEvent)
        expect(receivedWs).toBe(mockWebSocket)
        // normalizedMessage is the parsed result
        expect(normalizedMsg).toBeDefined()
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
