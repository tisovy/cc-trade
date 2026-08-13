import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesProductionWorkstation from './useFuturesProductionWorkstation.js'
import {
  FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  createFuturesProductionWorkstationEvent,
} from '../utils/futuresProductionWorkstationProtocol.js'
import { FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS } from '../utils/futuresCandleHistoryCache.js'

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
  tradable: true,
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

const emitCatalog = (socket, request, symbols, overrides = {}) => {
  socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(request.requestId, {
    symbol: request.symbol,
    resource: 'catalog',
    payload: Object.freeze({
      offset: 0,
      total: symbols.length,
      complete: true,
      contracts: Object.freeze(symbols.map(contract)),
    }),
    ...overrides,
  })))
}

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

  it('does not duplicate the shared market subscription on an identical rerender', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { rerender, unmount } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    rerender(defaultProps(socket, sendMessage))
    expect(sendMessage.mock.calls.map(([message]) => message.action)).toEqual([
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
    ])

    unmount()
    expect(sendMessage.mock.calls.map(([message]) => message.action)).toEqual([
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
    ])
  })

  it('sends validated tape settings to the active owner and reapplies them after selection', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    act(() => {
      expect(result.current.configureTape({
        throttleEnabled: true,
        timeoutMs: 400,
        minNotionalUsdt: '1000',
      })).toBe(true)
    })
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_TAPE,
      requestId: result.current.requestId,
      throttleEnabled: true,
      timeoutMs: 400,
      minNotionalUsdt: '1000',
    })

    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT' }))
    const actions = sendMessage.mock.calls.slice(-2).map(([message]) => message.action)
    expect(actions).toEqual([
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_TAPE,
    ])
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      requestId: result.current.requestId,
      timeoutMs: 400,
      minNotionalUsdt: '1000',
    })
  })

  // The panel states how far past the best price its rows reach, and the backend
  // buys the page that covers it. It states it when the reading changes — and a
  // new subscription for the same contract is not a change the panel notices, so
  // the reading has to be carried to it here or the book opens too shallow and
  // stays there.
  //
  // It is carried on the request itself rather than behind it: the snapshot that
  // opens the contract is bought before a second message could arrive, so a
  // reading stated in a message of its own is a reading stated too late to buy
  // the page it asks for. Which is also why nothing follows the request — the
  // subscription was opened at that reading, so restating it would be a message
  // saying what the desk already did.
  it('opens the subscription at the reading already stated for the contract', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    act(() => {
      expect(result.current.configureDepth('1.4')).toBe(true)
    })
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH,
      requestId: result.current.requestId,
      range: '1.4',
    })

    act(() => result.current.retry())
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      requestId: result.current.requestId,
      range: '1.4',
    })
  })

  // Nothing has been drawn for the first contract of a session, so there is no
  // reading to carry. The request states none rather than inventing one, and the
  // desk opens the book at the cheapest page exactly as it always did.
  it('opens a contract nothing has been stated for without a reading', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    const opening = sendMessage.mock.calls.at(-1)[0]
    expect(opening.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE)
    expect('range' in opening).toBe(false)
  })

  // A range is a distance in the contract's own quote currency, so the one
  // stated for the contract being left says nothing about the one being opened.
  it('does not carry a reading across to another contract', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    act(() => {
      expect(result.current.configureDepth('1.4')).toBe(true)
    })
    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT' }))
    expect(sendMessage.mock.calls.at(-1)[0].action)
      .toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL)
  })

  it('replays StrictMode with a fresh subscription owner and no interval selection', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender, unmount } = renderHook(
      props => useFuturesProductionWorkstation(props),
      {
        initialProps: defaultProps(socket, sendMessage),
        reactStrictMode: true,
      },
    )
    const [firstRequest, firstUnsubscribe, replayRequest] = sendMessage.mock.calls
      .map(([message]) => message)

    expect([firstRequest.action, firstUnsubscribe.action, replayRequest.action]).toEqual([
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
    ])
    expect(firstUnsubscribe.requestId).toBe(firstRequest.requestId)
    expect(replayRequest.requestId).not.toBe(firstRequest.requestId)
    expect(result.current.requestId).toBe(replayRequest.requestId)

    rerender(defaultProps(socket, sendMessage))
    expect(sendMessage).toHaveBeenCalledTimes(3)

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(firstRequest.requestId, { generation: 99, revision: 99 }),
    )))
    expect(result.current).toMatchObject({
      requestId: replayRequest.requestId,
      status: 'loading',
    })
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(replayRequest.requestId),
    )))
    expect(result.current.status).toBe('live')

    unmount()
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      requestId: replayRequest.requestId,
    })
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

  it('starts a fresh subscription when the shared socket identity changes', () => {
    const firstSocket = new LocalSocket()
    const secondSocket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(firstSocket, sendMessage),
    })
    expect(sendMessage.mock.calls.at(-1)[0].action)
      .toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE)

    rerender(defaultProps(secondSocket, sendMessage))

    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      symbol: 'BTCUSDT',
      interval: '1m',
    })
  })

  it('retains the last valid Contracts catalog through A → B → C and rejects stale owners', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestA = sendMessage.mock.calls.at(-1)[0]
    act(() => emitCatalog(socket, requestA, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']))
    expect(result.current.resources.catalog.contracts).toHaveLength(3)

    rerender(defaultProps(socket, sendMessage, { symbol: 'ETHUSDT' }))
    const requestB = sendMessage.mock.calls.at(-1)[0]
    expect(result.current.resources.catalog.contracts).toHaveLength(3)
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(requestB.requestId, {
        generation: 2,
        state: 'loading',
        payload: Object.freeze({ connected: false, reasonCode: null }),
      }),
    )))
    expect(result.current.resources.catalog.contracts).toHaveLength(3)
    rerender(defaultProps(socket, sendMessage, { symbol: 'SOLUSDT' }))
    const requestC = sendMessage.mock.calls.at(-1)[0]
    expect(result.current.resources.catalog.contracts).toHaveLength(3)
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(requestC.requestId, {
        generation: 3,
        state: 'loading',
        payload: Object.freeze({ connected: false, reasonCode: null }),
      }),
    )))
    expect(result.current.resources.catalog.contracts).toHaveLength(3)

    act(() => emitCatalog(socket, requestA, ['BTCUSDT'], { generation: 7 }))
    act(() => emitCatalog(socket, requestB, ['ETHUSDT'], { generation: 8 }))
    expect(result.current.symbol).toBe('SOLUSDT')
    expect(result.current.resources.catalog.contracts.map(item => item.symbol))
      .toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])

    act(() => emitCatalog(socket, requestC, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], {
      generation: 9,
    }))
    expect(result.current.resources.catalog.contracts).toHaveLength(3)
  })

  it('retains Contracts through a transient error and recovers the current generation', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const request = sendMessage.mock.calls[0][0]
    act(() => emitCatalog(socket, request, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']))

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId, {
        revision: 2,
        resource: 'status',
        state: 'resynchronizing',
        payload: Object.freeze({
          connected: false,
          reasonCode: 'TRANSIENT_BOOTSTRAP_FAILURE',
        }),
      }),
    )))
    expect(result.current).toMatchObject({
      status: 'resynchronizing',
      reasonCode: 'TRANSIENT_BOOTSTRAP_FAILURE',
    })
    expect(result.current.resources.catalog.contracts).toHaveLength(3)

    act(() => emitCatalog(socket, request, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], {
      generation: 2,
      revision: 1,
    }))
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(request.requestId, {
        generation: 2,
        revision: 2,
        resource: 'status',
        state: 'live',
      }),
    )))
    expect(result.current.status).toBe('live')
    expect(result.current.reasonCode).toBeNull()
    expect(result.current.resources.catalog.contracts.map(item => item.symbol))
      .toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'])

    act(() => emitCatalog(socket, request, ['BTCUSDT'], {
      generation: 1,
      revision: 99,
    }))
    expect(result.current.resources.catalog.contracts).toHaveLength(3)
  })

  it('retains Contracts and creates a fresh subscription owner on terminal Retry', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, unmount } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const firstRequest = sendMessage.mock.calls[0][0]
    act(() => emitCatalog(socket, firstRequest, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']))
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(firstRequest.requestId, {
        revision: 2,
        resource: 'status',
        state: 'unavailable',
        payload: Object.freeze({
          connected: false,
          reasonCode: 'RECONNECT_EXHAUSTED',
        }),
      }),
    )))
    expect(result.current).toMatchObject({
      status: 'unavailable',
      reasonCode: 'RECONNECT_EXHAUSTED',
    })

    act(() => result.current.retry())

    const retryRequest = sendMessage.mock.calls.at(-1)[0]
    expect(sendMessage.mock.calls.map(([message]) => message.action)).toEqual([
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
    ])
    expect(sendMessage.mock.calls[1][0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE,
      requestId: firstRequest.requestId,
    })
    expect(retryRequest).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      symbol: 'BTCUSDT',
      interval: '1m',
    })
    expect(retryRequest.requestId).not.toBe(firstRequest.requestId)
    expect(result.current.status).toBe('loading')
    expect(result.current.resources.catalog.contracts).toHaveLength(3)

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(firstRequest.requestId, {
        generation: 99,
        revision: 99,
      }),
    )))
    expect(result.current).toMatchObject({
      requestId: retryRequest.requestId,
      status: 'loading',
    })
    unmount()
    expect(sendMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.UNSUBSCRIBE)
      .map(message => message.requestId))
      .toEqual([firstRequest.requestId, retryRequest.requestId])
  })

  it('keeps same-symbol invariant resources live while only the interval loads', () => {
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
      state: 'live',
    })
    expect(result.current.resources.candles).toBeNull()

    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(intervalRequest.requestId, {
        generation: 1,
        revision: 3,
        state: 'loading',
        payload: Object.freeze({ connected: true, reasonCode: null }),
      }),
    )))
    expect(result.current.status).toBe('loading')
    expect(result.current.resources.header).toMatchObject({
      lastPrice: '58420.1',
      state: 'live',
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

describe('useFuturesProductionWorkstation candle history', () => {
  const MINUTE = 60_000
  const START = 1_784_000_000_000
  const historyRows = (from, to) => Array.from({ length: to - from }, (_, index) => ({
    openTime: START + ((from + index) * MINUTE),
    closeTime: START + ((from + index + 1) * MINUTE) - 1,
    open: '58400',
    high: '58500',
    low: '58300',
    close: '58420',
    volume: '1',
    closed: true,
  }))

  const missingCache = () => ({
    readPage: vi.fn(async () => null),
    writePage: vi.fn(async () => true),
  })

  const emitHistoryPage = (socket, requestId, revision, payload) => {
    socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, {
      revision,
      resource: 'candleHistory',
      payload: Object.freeze({
        series: 'contract',
        interval: '1m',
        endTime: START,
        ...payload,
      }),
    })))
  }

  it('assembles a paged response into one history and remembers it for next time', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const candleHistoryCache = missingCache()
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId

    await act(async () => { await result.current.loadCandleHistory(START) })
    const request = sendMessage.mock.calls.at(-1)[0]
    expect(request.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)
    expect(request).toMatchObject({ symbol: 'BTCUSDT', interval: '1m', endTime: START })

    act(() => emitHistoryPage(socket, requestId, 2, {
      offset: 0,
      total: 100,
      complete: false,
      rows: historyRows(-100, -20),
    }))
    // Nothing is shown until the response is whole.
    expect(result.current.candleHistory.rows).toHaveLength(0)

    await act(async () => emitHistoryPage(socket, requestId, 3, {
      offset: 80,
      total: 100,
      complete: true,
      rows: historyRows(-20, 0),
    }))
    expect(result.current.candleHistory.rows).toHaveLength(100)
    expect(result.current.candleHistory.rows[0].openTime).toBe(START - (100 * MINUTE))
    // A short answer is the start of the contract's history.
    expect(result.current.candleHistory.exhausted).toBe(true)
    expect(candleHistoryCache.writePage).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      interval: '1m',
    }))
  })

  it('serves a cached page without asking the exchange for it again', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const candleHistoryCache = {
      readPage: vi.fn(async () => historyRows(-50, 0)),
      writePage: vi.fn(async () => true),
    }
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache }),
    })

    await act(async () => { await result.current.loadCandleHistory(START) })

    expect(result.current.candleHistory.rows).toHaveLength(50)
    expect(sendMessage.mock.calls.map(([message]) => message.action))
      .not.toContain(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)
  })

  it('keeps one read in flight however hard the operator scrolls', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })

    await act(async () => {
      await Promise.all([
        result.current.loadCandleHistory(START),
        result.current.loadCandleHistory(START),
        result.current.loadCandleHistory(START),
      ])
    })

    expect(sendMessage.mock.calls
      .filter(([message]) => (
        message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY
      ))).toHaveLength(1)
  })

  it('drops history that belonged to the previous contract', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId

    await act(async () => { await result.current.loadCandleHistory(START) })
    await act(async () => emitHistoryPage(socket, requestId, 2, {
      offset: 0,
      total: 20,
      complete: true,
      rows: historyRows(-20, 0),
    }))
    expect(result.current.candleHistory.rows).toHaveLength(20)

    rerender(defaultProps(socket, sendMessage, {
      symbol: 'ETHUSDT',
      candleHistoryCache: missingCache(),
    }))
    expect(result.current.candleHistory.rows).toHaveLength(0)
  })

  // The rows of the abandoned selection used to survive the switch and the next
  // page merged in front of them, so a 1h chart was drawn on top of 15m bars
  // and the join looked like a hole in the market.
  it('never joins a page to rows read at another interval', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId

    await act(async () => { await result.current.loadCandleHistory(START) })
    await act(async () => emitHistoryPage(socket, requestId, 2, {
      offset: 0,
      total: 20,
      complete: true,
      rows: historyRows(-20, 0),
    }))
    expect(result.current.candleHistory.rows).toHaveLength(20)
    // Short answers mark the 1m series exhausted; the 15m series must not
    // inherit that verdict and stop loading before it has read anything.
    expect(result.current.candleHistory.exhausted).toBe(true)

    rerender(defaultProps(socket, sendMessage, {
      interval: '15m',
      candleHistoryCache: missingCache(),
    }))
    const intervalRequestId = sendMessage.mock.calls.at(-1)[0].requestId

    await act(async () => { await result.current.loadCandleHistory(START) })
    // A whole page: the 15m series has more behind it, whatever the 1m read
    // concluded about where the 1m series began.
    const page = historyRows(-1_040, -40)
    for (let offset = 0; offset < page.length; offset += 80) {
      const rows = page.slice(offset, offset + 80)
      await act(async () => emitHistoryPage(socket, intervalRequestId, 3 + (offset / 80), {
        interval: '15m',
        offset,
        total: page.length,
        complete: offset + rows.length === page.length,
        rows,
      }))
    }

    expect(result.current.candleHistory.interval).toBe('15m')
    expect(result.current.candleHistory.rows).toHaveLength(1_000)
    expect(result.current.candleHistory.rows.at(-1).openTime).toBe(START - (41 * MINUTE))
    expect(result.current.candleHistory.exhausted).toBe(false)
  })

  // The disk cache has held five thousand rows per contract and interval from
  // the start; the renderer held whatever the operator had scrolled through.
  // Six pages is a minute of scrolling and puts the chart a fifth past the
  // ceiling, where every redraw re-maps and re-scales the whole series.
  it('holds the run to the ceiling the disk cache uses, keeping the live end', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId

    const PAGE = 1_000
    for (let page = 0; page < 6; page += 1) {
      const endTime = START - (page * PAGE * MINUTE)
      await act(async () => { await result.current.loadCandleHistory(endTime) })
      const rows = historyRows(-(page + 1) * PAGE, -page * PAGE)
      for (let offset = 0; offset < rows.length; offset += 80) {
        const frame = rows.slice(offset, offset + 80)
        await act(async () => emitHistoryPage(socket, requestId, 3 + (page * 20) + (offset / 80), {
          endTime,
          offset,
          total: rows.length,
          complete: offset + frame.length === rows.length,
          rows: frame,
        }))
      }
    }

    expect(result.current.candleHistory.rows).toHaveLength(
      FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS,
    )
    // The oldest thousand were dropped, not the newest: what the chart draws
    // beside the live window is the run nearest to it.
    expect(result.current.candleHistory.rows.at(-1).openTime).toBe(START - MINUTE)
    expect(result.current.candleHistory.rows[0].openTime).toBe(
      START - (FUTURES_CANDLE_HISTORY_CACHE_MAX_ROWS * MINUTE),
    )
    // The read is issued from the oldest row on the chart. Once the ceiling
    // holds that row still, the same page would be asked for, delivered and
    // dropped on every scroll into the edge — so the chart stops asking.
    expect(result.current.candleHistory.exhausted).toBe(true)
  })
})
