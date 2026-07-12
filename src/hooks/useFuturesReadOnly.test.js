import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FUTURES_MARKET_TYPE,
  FUTURES_READ_ACTIONS,
  FUTURES_READ_CHANNEL_ID,
  FUTURES_READ_PROTOCOL_VERSION,
} from '../utils/futuresReadOnlyProtocol.js'
import useFuturesReadOnly from './useFuturesReadOnly.js'

const createSocket = (readyState = 1) => {
  const listeners = new Map()
  const addEventListener = vi.fn((type, listener) => {
    const typeListeners = listeners.get(type) || new Set()
    typeListeners.add(listener)
    listeners.set(type, typeListeners)
  })
  const removeEventListener = vi.fn((type, listener) => {
    listeners.get(type)?.delete(listener)
  })

  return {
    readyState,
    addEventListener,
    removeEventListener,
    emit(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event)
    },
    handlers(type) {
      return [...(listeners.get(type) || [])]
    },
  }
}

const resource = (status = 'ready', data = null, errorCode = null) => ({
  status,
  data,
  lastUpdatedAt: status === 'loading' ? null : 1783857600000,
  errorCode,
})

const createExchangeInfo = (symbol = 'BTCUSDT') => ({
  marketType: 'futures',
  symbol,
  pair: symbol,
  contractType: 'PERPETUAL',
  status: 'TRADING',
  assets: { base: 'BTC', quote: 'USDT', margin: 'USDT' },
  filters: {
    price: { min: '0.01', max: '1000000.00', tickSize: '0.01' },
    quantity: { min: '0.001', max: '1000.000', stepSize: '0.001' },
    marketQuantity: null,
    minimumNotional: '5.00000000',
  },
  supportedOrderTypes: ['LIMIT'],
  supportedTimeInForce: ['GTC'],
})

const createMarket = (symbol = 'BTCUSDT') => ({
  markPrice: {
    marketType: 'futures',
    symbol,
    markPrice: '60000.00000000',
    indexPrice: '59998.00000000',
    estimatedSettlePrice: '0.00000000',
    time: 1783857600000,
  },
  fundingState: {
    marketType: 'futures',
    symbol,
    lastFundingRate: '0.00010000',
    interestRate: null,
    nextFundingTime: 1783886400000,
    time: 1783857600000,
  },
})

const createMarginBalance = () => ({
  marketType: 'futures',
  accountAlias: 'readonly',
  asset: 'USDT',
  balance: '1000.00000000',
  crossWalletBalance: '990.00000000',
  crossUnPnl: '10.00000000',
  availableBalance: '900.00000000',
  maxWithdrawAmount: '900.00000000',
  marginAvailable: true,
  updateTime: 1783857600000,
})

const createPosition = (symbol = 'BTCUSDT') => ({
  marketType: 'futures',
  symbol,
  positionSide: 'BOTH',
  positionAmt: '0.01000000',
  unRealizedProfit: '10.00000000',
  liquidationPrice: '40000.00000000',
  marginAsset: 'USDT',
})

const createOrder = (symbol = 'BTCUSDT') => ({
  marketType: 'futures',
  symbol,
})

const createPayload = (symbol = 'BTCUSDT', environment = 'mock', overrides = {}) => ({
  status: 'ready',
  connected: true,
  symbol,
  environment,
  resources: {
    exchangeInfo: resource('ready', createExchangeInfo(symbol)),
    market: resource('ready', createMarket(symbol)),
    positions: resource('empty', []),
    marginBalance: resource('ready', createMarginBalance()),
    openOrders: resource('empty', []),
    algoOpenOrders: resource('empty', []),
  },
  ...overrides,
})

const createEnvelope = ({
  requestId,
  symbol = 'BTCUSDT',
  environment = 'mock',
  type = 'snapshot',
  payload = createPayload(symbol, environment),
  ...overrides
}) => ({
  channelId: FUTURES_READ_CHANNEL_ID,
  version: FUTURES_READ_PROTOCOL_VERSION,
  marketType: FUTURES_MARKET_TYPE,
  requestId,
  type,
  symbol,
  environment,
  payload,
  ...overrides,
})

describe('useFuturesReadOnly', () => {
  let originalWebSocket

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket
    globalThis.WebSocket = { OPEN: 1 }
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('keeps disabled and initial disconnected states separate from loading', () => {
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      ({ enabled, wsConnection }) => useFuturesReadOnly({
        enabled,
        symbol: 'BTCUSDT',
        wsConnection,
        sendMessage,
      }),
      { initialProps: { enabled: false, wsConnection: null } },
    )

    expect(result.current.status).toBe('idle')
    expect(result.current.environment).toBe('mock')
    expect(sendMessage).not.toHaveBeenCalled()

    rerender({ enabled: true, wsConnection: null })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.environment).toBe('mock')
    expect(result.current.resources).toBeNull()
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('subscribes with an opaque request id and installs only lifecycle listeners', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))

    expect(result.current.status).toBe('loading')
    expect(result.current.requestId).toEqual(expect.any(String))
    expect(result.current.requestId).not.toContain('BTCUSDT')
    expect(sendMessage).toHaveBeenCalledWith({
      action: FUTURES_READ_ACTIONS.SUBSCRIBE,
      version: FUTURES_READ_PROTOCOL_VERSION,
      marketType: FUTURES_MARKET_TYPE,
      requestId: result.current.requestId,
      symbol: 'BTCUSDT',
    })
    expect(socket.addEventListener.mock.calls.map(([type]) => type)).toEqual(['message', 'close', 'error'])
  })

  it('accepts only the exact active channel, version, market, request id, and symbol', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    const wrongMessages = [
      createEnvelope({ requestId: `${requestId}-old` }),
      createEnvelope({ requestId, symbol: 'ETHUSDT' }),
      createEnvelope({ requestId, version: 2 }),
      createEnvelope({ requestId, marketType: 'spot' }),
      createEnvelope({ requestId, channelId: 'detail' }),
    ]

    for (const message of wrongMessages) {
      act(() => socket.emit('message', { data: JSON.stringify(message) }))
    }
    expect(result.current.status).toBe('loading')

    const payload = createPayload('BTCUSDT', 'mock')
    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId, payload })),
    }))

    expect(result.current).toMatchObject({
      status: 'ready',
      connected: true,
      symbol: 'BTCUSDT',
      environment: 'mock',
      requestId,
      errorCode: null,
    })
    expect(result.current.resources).toEqual(payload.resources)
  })

  it('ignores malformed service snapshots instead of merging ambiguous state', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId
    const malformedPayload = createPayload('BTCUSDT', 'mock', {
      resources: {
        exchangeInfo: resource('ready', {}),
      },
    })

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId, payload: malformedPayload })),
    }))

    expect(result.current.status).toBe('loading')
    expect(result.current.resources).toBeNull()
  })

  it('rejects cross-market, wrong-symbol, and malformed nested resource identities', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      environment: 'mock',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId
    const basePayload = createPayload()
    const nestedViolations = [
      { exchangeInfo: resource('ready', { ...createExchangeInfo(), marketType: 'spot' }) },
      { exchangeInfo: resource('ready', createExchangeInfo('ETHUSDT')) },
      {
        market: resource('ready', {
          ...createMarket(),
          markPrice: { ...createMarket().markPrice, marketType: 'spot' },
        }),
      },
      {
        market: resource('ready', {
          ...createMarket(),
          fundingState: { ...createMarket().fundingState, symbol: 'ETHUSDT' },
        }),
      },
      { positions: resource('ready', [{ ...createPosition(), marketType: 'spot' }]) },
      { positions: resource('ready', [createPosition('ETHUSDT')]) },
      { marginBalance: resource('ready', { ...createMarginBalance(), marketType: 'spot' }) },
      { marginBalance: resource('ready', { ...createMarginBalance(), asset: 'BUSD' }) },
      {
        marginBalance: resource('ready', {
          marketType: 'futures',
          asset: 'USDT',
          balance: '1000.00000000',
        }),
      },
      { openOrders: resource('ready', [{ ...createOrder(), marketType: 'spot' }]) },
      { openOrders: resource('ready', [createOrder('ETHUSDT')]) },
      { algoOpenOrders: resource('ready', [{ ...createOrder(), marketType: 'spot' }]) },
      { algoOpenOrders: resource('ready', [createOrder('ETHUSDT')]) },
    ]

    for (const violation of nestedViolations) {
      const payload = {
        ...basePayload,
        resources: { ...basePayload.resources, ...violation },
      }
      act(() => socket.emit('message', {
        data: JSON.stringify(createEnvelope({ requestId, payload })),
      }))
      expect(result.current.status).toBe('loading')
      expect(result.current.resources).toBeNull()
    }

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId, payload: basePayload })),
    }))
    expect(result.current.status).toBe('ready')
  })

  it('shows the configured environment immediately and accepts only matching responses', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      environment: 'testnet',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    expect(result.current).toMatchObject({ status: 'loading', environment: 'testnet' })

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({
        requestId,
        environment: 'mock',
        payload: createPayload('BTCUSDT', 'mock'),
      })),
    }))
    expect(result.current.status).toBe('loading')

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({
        requestId,
        environment: 'testnet',
        payload: createPayload('BTCUSDT', 'testnet'),
      })),
    }))
    expect(result.current).toMatchObject({ status: 'ready', environment: 'testnet' })
  })

  it('uses a fresh id on symbol change and suppresses late delivery from the old generation', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      ({ symbol }) => useFuturesReadOnly({
        enabled: true,
        symbol,
        wsConnection: socket,
        sendMessage,
      }),
      { initialProps: { symbol: 'BTCUSDT' } },
    )

    const firstRequestId = result.current.requestId
    const lateHandler = socket.handlers('message')[0]
    rerender({ symbol: 'ETHUSDT' })
    const secondRequestId = result.current.requestId

    expect(secondRequestId).not.toBe(firstRequestId)
    expect(sendMessage).toHaveBeenCalledWith({
      action: FUTURES_READ_ACTIONS.UNSUBSCRIBE,
      version: FUTURES_READ_PROTOCOL_VERSION,
      marketType: FUTURES_MARKET_TYPE,
      requestId: firstRequestId,
    })

    act(() => lateHandler({
      data: JSON.stringify(createEnvelope({ requestId: firstRequestId })),
    }))
    expect(result.current.status).toBe('loading')
    expect(result.current.symbol).toBe('ETHUSDT')

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({
        requestId: secondRequestId,
        symbol: 'ETHUSDT',
        payload: createPayload('ETHUSDT', 'mock'),
      })),
    }))
    expect(result.current.status).toBe('ready')
    expect(result.current.symbol).toBe('ETHUSDT')
  })

  it('uses a fresh id on reconnect and stale close handlers cannot overwrite it', () => {
    const firstSocket = createSocket()
    const secondSocket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      ({ wsConnection }) => useFuturesReadOnly({
        enabled: true,
        symbol: 'BTCUSDT',
        wsConnection,
        sendMessage,
      }),
      { initialProps: { wsConnection: firstSocket } },
    )

    const firstRequestId = result.current.requestId
    const lateClose = firstSocket.handlers('close')[0]
    rerender({ wsConnection: secondSocket })
    const secondRequestId = result.current.requestId

    expect(secondRequestId).not.toBe(firstRequestId)
    act(() => lateClose({ code: 1006 }))
    expect(result.current.status).toBe('loading')
    expect(result.current.requestId).toBe(secondRequestId)
  })

  it('maps safe rejections without exposing messages or accepting later snapshots', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({
        requestId,
        type: 'rejection',
        payload: { code: 'FUTURES_READ_UNAVAILABLE', message: 'internal detail is not retained' },
      })),
    }))
    expect(result.current.errorCode).toBe('FUTURES_READ_UNAVAILABLE')
    expect(result.current).not.toHaveProperty('message')

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId })),
    }))
    expect(result.current.errorCode).toBe('FUTURES_READ_UNAVAILABLE')
  })

  it('accepts a null-symbol protocol rejection for the active request only', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({
        requestId,
        symbol: null,
        type: 'rejection',
        payload: { code: 'FUTURES_READ_INVALID_FIELDS', message: 'safe fixed text' },
      })),
    }))

    expect(result.current).toMatchObject({
      status: 'error',
      symbol: 'BTCUSDT',
      requestId,
      errorCode: 'FUTURES_READ_INVALID_FIELDS',
    })
  })

  it('retires a failed connection so late delivery cannot replace its state', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    act(() => socket.emit('error'))
    expect(result.current).toMatchObject({
      status: 'error',
      connected: false,
      errorCode: 'FUTURES_READ_CONNECTION_ERROR',
    })

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId })),
    }))
    expect(result.current).toMatchObject({
      status: 'error',
      errorCode: 'FUTURES_READ_CONNECTION_ERROR',
    })
  })

  it('marks a closed connection disconnected and ignores its late delivery', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId

    act(() => socket.emit('close', { code: 1006 }))
    expect(result.current).toMatchObject({ status: 'disconnected', connected: false })

    act(() => socket.emit('message', {
      data: JSON.stringify(createEnvelope({ requestId })),
    }))
    expect(result.current).toMatchObject({ status: 'disconnected', connected: false })
  })

  it('removes every listener, sends the matching unsubscribe, and ignores late teardown delivery', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => true)
    const { result, unmount } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))
    const requestId = result.current.requestId
    const lateMessage = socket.handlers('message')[0]

    unmount()

    expect(socket.removeEventListener.mock.calls.map(([type]) => type)).toEqual(['message', 'close', 'error'])
    expect(sendMessage).toHaveBeenLastCalledWith({
      action: FUTURES_READ_ACTIONS.UNSUBSCRIBE,
      version: FUTURES_READ_PROTOCOL_VERSION,
      marketType: FUTURES_MARKET_TYPE,
      requestId,
    })
    expect(() => lateMessage({
      data: JSON.stringify(createEnvelope({ requestId })),
    })).not.toThrow()
  })

  it('reports a failed subscribe without retaining a phantom subscription', () => {
    const socket = createSocket()
    const sendMessage = vi.fn(() => false)
    const { result, unmount } = renderHook(() => useFuturesReadOnly({
      enabled: true,
      symbol: 'BTCUSDT',
      wsConnection: socket,
      sendMessage,
    }))

    expect(result.current).toMatchObject({
      status: 'error',
      errorCode: 'FUTURES_READ_SUBSCRIBE_FAILED',
    })
    unmount()
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
