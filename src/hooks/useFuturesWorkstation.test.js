import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesProductionWorkstation from './useFuturesProductionWorkstation.js'
import {
  FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  createFuturesProductionWorkstationEvent,
} from '../utils/futuresProductionWorkstationProtocol.js'

class LocalSocket extends EventTarget {
  constructor(readyState = 1) {
    super()
    this.readyState = readyState
  }

  emitMessage(value) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }))
  }

  closeLocally() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
}

const eventValues = (requestId, overrides = {}) => ({
  requestId,
  symbol: 'BTCUSDT',
  generation: 1,
  revision: 1,
  resource: 'status',
  state: 'live',
  observedAt: 1_784_000_000_000,
  payload: Object.freeze({ connected: true, reasonCode: null }),
  ...overrides,
})

const headerPayload = Object.freeze({
  lastPrice: '58420.1',
  markPrice: '58419.9',
  indexPrice: '58419.8',
  basis: '0.1',
  priceChange: '420.1',
  priceChangePercent: '0.72',
  highPrice: '59000',
  lowPrice: '57000',
  volume: '1000.5',
  quoteVolume: '58000000',
  lastQuantity: '0.25',
  fundingRate: '-0.0001',
  fundingRatePercent: '-0.01',
  nextFundingTime: 1_784_010_000_000,
  eventTime: 1_784_000_000_000,
  contractStatus: 'TRADING',
})

const contractFilters = Object.freeze({
  price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
  quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  marketQuantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
  percentPrice: Object.freeze({
    multiplierUp: '1.1500',
    multiplierDown: '0.8500',
    multiplierDecimal: 4,
  }),
  maximumOrders: 200,
  maximumAlgoOrders: 100,
  minimumNotional: '5',
})

const contract = symbol => Object.freeze({
  symbol,
  pair: symbol,
  contractType: 'PERPETUAL',
  status: 'TRADING',
  baseAsset: symbol.replace('USDT', ''),
  quoteAsset: 'USDT',
  marginAsset: 'USDT',
  allowlisted: symbol === 'BTCUSDT',
  filters: contractFilters,
})

const defaultProps = (socket, sendMessage, overrides = {}) => ({
  enabled: true,
  symbol: 'BTCUSDT',
  interval: '1m',
  wsConnection: socket,
  sendMessage,
  ...overrides,
})

describe('production workstation hook isolation', () => {
  it('uses only the production channel and ignores events for another request owner', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const request = sendMessage.mock.calls[0][0]
    expect(request.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE)
    expect(request.environment).toBe('PRODUCTION')
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues('another-request'),
    )))
    expect(result.current.status).toBe('loading')
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId),
    )))
    expect(result.current.status).toBe('live')
  })

  it('uses production symbol and interval actions and drops late events from the old owner', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const first = sendMessage.mock.calls[0][0]
    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT' }))
    const symbolRequest = sendMessage.mock.calls.at(-1)[0]
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(symbolRequest.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL)
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(first.requestId),
    )))
    expect(result.current.symbol).toBe('ETHUSDT')
    expect(result.current.status).toBe('loading')

    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT', interval: '5m' }))
    expect(sendMessage).toHaveBeenCalledTimes(3)
    expect(sendMessage.mock.calls.at(-1)[0].action)
      .toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL)
  })

  it('keeps same-symbol resources visible as stale while a new interval generation loads', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const first = sendMessage.mock.calls[0][0]
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(first.requestId),
    )))
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(first.requestId, {
        revision: 2,
        resource: 'header',
        payload: headerPayload,
      }),
    )))

    rerender(defaultProps(socket, sendMessage, { interval: '5m' }))
    const intervalRequest = sendMessage.mock.calls.at(-1)[0]
    expect(sendMessage).toHaveBeenCalledTimes(2)
    expect(intervalRequest.action)
      .toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL)
    expect(result.current.resources.header).toMatchObject({
      lastPrice: '58420.1',
      state: 'stale',
    })
    expect(result.current.resources.candles).toBeNull()

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(intervalRequest.requestId, {
        generation: 2,
        state: 'loading',
        payload: Object.freeze({ connected: false, reasonCode: null }),
      }),
    )))
    expect(result.current.status).toBe('loading')
    expect(result.current.resources.header).toMatchObject({
      lastPrice: '58420.1',
      state: 'stale',
    })
  })

  it('coalesces catalog chunks into one renderer state update at completion', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const request = sendMessage.mock.calls[0][0]

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId, {
        resource: 'catalog',
        payload: Object.freeze({
          offset: 0,
          total: 2,
          complete: false,
          contracts: Object.freeze([contract('BTCUSDT')]),
        }),
      }),
    )))
    expect(result.current.resources.catalog).toBeNull()

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId, {
        revision: 2,
        resource: 'catalog',
        payload: Object.freeze({
          offset: 1,
          total: 2,
          complete: true,
          contracts: Object.freeze([contract('ETHUSDT')]),
        }),
      }),
    )))
    expect(result.current.resources.catalog).toMatchObject({
      total: 2,
      complete: true,
      state: 'live',
    })
    expect(result.current.resources.catalog.contracts.map(item => item.symbol))
      .toEqual(['BTCUSDT', 'ETHUSDT'])
  })

  it('marks local disconnect and subscribe rejection explicitly', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    act(() => socket.closeLocally())
    expect(result.current).toMatchObject({
      status: 'disconnected',
      reasonCode: 'LOCAL_CONNECTION_CLOSED',
    })

    const rejected = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(new LocalSocket(), vi.fn(() => false)),
    })
    expect(rejected.result.current).toMatchObject({
      status: 'unavailable',
      reasonCode: 'LOCAL_SUBSCRIBE_REJECTED',
    })
  })

  it('does not subscribe on a closed local socket', () => {
    const sendMessage = vi.fn()
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(new LocalSocket(3), sendMessage),
    })
    expect(result.current.status).toBe('disconnected')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('unsubscribes its exact request on teardown', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { unmount } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    unmount()
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      requestId,
      environment: 'PRODUCTION',
    })
  })
})
