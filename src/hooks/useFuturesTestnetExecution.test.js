import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FUTURES_TESTNET_EXECUTION_SAFE_CODES,
} from '../utils/futuresTestnetExecutionProtocol.js'
import useFuturesTestnetExecution from './useFuturesTestnetExecution.js'

const REQUEST_ID = '0123456789abcdef0123456789abcdef'

const createSocket = (readyState = 1) => {
  const listeners = new Map()
  const socket = {
    readyState,
    sent: [],
    send(raw) {
      this.sent.push(raw)
    },
    addEventListener(type, listener) {
      const group = listeners.get(type) || new Set()
      group.add(listener)
      listeners.set(type, group)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event)
    },
    handlers(type) {
      return [...(listeners.get(type) || [])]
    },
  }
  return socket
}

const intent = {
  requestId: REQUEST_ID,
  clientOrderId: `cc6-${REQUEST_ID}`,
  symbol: 'BTCUSDT',
  side: 'SELL',
  leverage: 2,
  expiresAt: 1_783_857_630_000,
}

const createStatus = (overrides = {}) => ({
  channelId: 'futures-execution',
  action: 'futures.execution.status',
  version: 1,
  revision: '1',
  marketType: 'futures',
  environment: 'testnet',
  symbol: 'BTCUSDT',
  capability: {
    enabled: true,
    code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.ENABLED,
  },
  intent: null,
  attempt: null,
  ...overrides,
})

const sentMessages = (socket) => socket.sent.map((raw) => JSON.parse(raw))

describe('useFuturesTestnetExecution', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = { OPEN: 1 }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('subscribes and unsubscribes with the exact session-bound protocol', () => {
    const socket = createSocket()
    const { result, unmount } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    expect(result.current).toMatchObject({ connected: true, subscribed: true, revision: null })
    expect(sentMessages(socket)).toEqual([{
      action: 'futures.execution.subscribeStatus',
      version: 1,
      revision: '0',
      marketType: 'futures',
      environment: 'testnet',
      symbol: 'BTCUSDT',
    }])

    unmount()
    expect(sentMessages(socket)[1]).toEqual({
      action: 'futures.execution.unsubscribeStatus',
      version: 1,
      revision: '0',
      marketType: 'futures',
      environment: 'testnet',
      symbol: 'BTCUSDT',
    })
    expect(socket.handlers('message')).toHaveLength(0)
  })

  it('accepts only increasing lossless revisions for the owned symbol', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ revision: '9007199254740992' })),
    }))
    expect(result.current.revision).toBe('9007199254740992')

    act(() => {
      socket.emit('message', {
        data: JSON.stringify(createStatus({
          revision: '9007199254740991',
          capability: { enabled: false, code: FUTURES_TESTNET_EXECUTION_SAFE_CODES.DISABLED },
        })),
      })
      socket.emit('message', {
        data: JSON.stringify(createStatus({ revision: '9007199254740992' })),
      })
      socket.emit('message', {
        data: JSON.stringify(createStatus({ revision: '9007199254740993', symbol: 'ETHUSDT' })),
      })
    })

    expect(result.current.revision).toBe('9007199254740992')
    expect(result.current.capability.enabled).toBe(true)
  })

  it('ignores malformed, duplicate-key, and extra-field status frames', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    const duplicate = JSON.stringify(createStatus()).replace(
      '"revision":"1"',
      '"revision":"1","revision":"2"',
    )

    act(() => {
      socket.emit('message', { data: duplicate })
      socket.emit('message', { data: JSON.stringify({ ...createStatus(), extra: true }) })
      socket.emit('message', { data: '{' })
    })

    expect(result.current.revision).toBeNull()
    expect(result.current.capability).toBeNull()
  })

  it('prepares at most once until a greater backend revision arrives', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    act(() => socket.emit('message', { data: JSON.stringify(createStatus()) }))
    act(() => {
      expect(result.current.prepareIntent()).toBe(true)
      expect(result.current.prepareIntent()).toBe(false)
    })

    expect(sentMessages(socket).filter(({ action }) => action === 'futures.execution.prepareIntent')).toHaveLength(1)
    expect(sentMessages(socket).find(
      ({ action }) => action === 'futures.execution.prepareIntent',
    ).revision).toBe('1')
    expect(result.current.submissionLocked).toBe(true)

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ revision: '2', intent })),
    }))
    expect(result.current.submissionLocked).toBe(false)
    expect(result.current.intent).toEqual(intent)
    expect(result.current.prepareIntent()).toBe(false)
  })

  it('uses the active backend intent once and blocks synchronous double submission', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ intent })),
    }))

    act(() => {
      expect(result.current.placeOrder({
        quantity: '0.0100',
        price: '60000.1200',
      })).toBe(true)
      expect(result.current.placeOrder({
        quantity: '0.0100',
        price: '60000.1200',
      })).toBe(false)
    })

    const orders = sentMessages(socket).filter(({ action }) => action === 'futures.execution.placeOrder')
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      requestId: REQUEST_ID,
      clientOrderId: `cc6-${REQUEST_ID}`,
      side: 'SELL',
      leverage: 2,
      quantity: '0.0100',
      price: '60000.1200',
      orderType: 'LIMIT',
      timeInForce: 'GTC',
      positionSide: 'BOTH',
      marginType: 'ISOLATED',
      reduceOnly: true,
    })

    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ revision: '2', intent })),
    }))
    expect(result.current.revision).toBe('1')
    expect(result.current.submissionLocked).toBe(true)
  })

  it('releases the guard after a local serialization/send failure without inventing status', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))
    act(() => socket.emit('message', {
      data: JSON.stringify(createStatus({ intent })),
    }))

    act(() => {
      expect(result.current.placeOrder({
        quantity: '1e-2',
        price: '60000',
      })).toBe(false)
    })

    expect(result.current.submissionLocked).toBe(false)
    expect(result.current.revision).toBe('1')
    expect(result.current.attempt).toBeNull()
  })

  it('retires old-generation delivery and disables sends after close', () => {
    const first = createSocket()
    const second = createSocket()
    const { result, rerender } = renderHook(
      ({ socket }) => useFuturesTestnetExecution({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection: socket,
      }),
      { initialProps: { socket: first } },
    )
    const retiredMessageHandler = first.handlers('message')[0]

    rerender({ socket: second })
    act(() => retiredMessageHandler({ data: JSON.stringify(createStatus({ revision: '99' })) }))
    expect(result.current.revision).toBeNull()

    act(() => second.emit('close', { code: 1006 }))
    expect(result.current).toMatchObject({ connected: false, subscribed: false })
    expect(result.current.prepareIntent()).toBe(false)
  })

  it('does not subscribe or expose a synthetic capability when disabled', () => {
    const socket = createSocket()
    const { result } = renderHook(() => useFuturesTestnetExecution({
      enabled: false,
      symbol: 'BTCUSDT',
      wsConnection: socket,
    }))

    expect(socket.sent).toHaveLength(0)
    expect(result.current).toMatchObject({
      connected: false,
      subscribed: false,
      capability: null,
      intent: null,
      attempt: null,
    })
  })
})
