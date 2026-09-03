import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useFuturesProductionWorkstation from './useFuturesProductionWorkstation.js'
import {
  FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  createFuturesProductionWorkstationEvent,
  createFuturesProductionWorkstationHistoryOutcome,
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
      expect(result.current.configureDepth({ step: '0.1', rows: 14 })).toBe(true)
    })
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH,
      requestId: result.current.requestId,
      step: '0.1',
      rows: 14,
    })

    act(() => result.current.retry())
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      requestId: result.current.requestId,
      step: '0.1',
      rows: 14,
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
    expect('step' in opening).toBe(false)
    expect('rows' in opening).toBe(false)
  })

  // A step is a multiple of the contract's own tick, so the reading stated for
  // the contract being left says nothing about the one being opened.
  it('does not carry a reading across to another contract', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    act(() => {
      expect(result.current.configureDepth({ step: '0.1', rows: 14 })).toBe(true)
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

  it.each([
    ['close', 'disconnected', 'LOCAL_CONNECTION_CLOSED'],
    ['error', 'unavailable', 'LOCAL_CONNECTION_ERROR'],
  ])('ends an interval-switch wait on a local %s event', (event, status, reasonCode) => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(
      props => useFuturesProductionWorkstation(props),
      { initialProps: defaultProps(socket, sendMessage) },
    )

    rerender(defaultProps(socket, sendMessage, { interval: '5m' }))
    expect(result.current.candlesSwitching).toBe(true)

    act(() => socket.dispatchEvent(new Event(event)))
    expect(result.current).toMatchObject({
      status,
      reasonCode,
      candlesSwitching: false,
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

  const emitStatus = (socket, requestId, revision, state, reasonCode = null, generation = 1) => {
    socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, {
      generation,
      revision,
      resource: 'status',
      state,
      payload: Object.freeze({ connected: state === 'live', reasonCode }),
    })))
  }

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

  const emitHistoryResponse = (socket, requestId, firstRevision, rows) => {
    for (let offset = 0; offset < rows.length; offset += 80) {
      const page = rows.slice(offset, offset + 80)
      emitHistoryPage(socket, requestId, firstRevision + (offset / 80), {
        offset,
        total: rows.length,
        complete: offset + page.length === rows.length,
        rows: page,
      })
    }
  }

  const emitUnavailableHistoryOutcome = (socket, requestId, overrides = {}) => {
    socket.emitMessage(createFuturesProductionWorkstationHistoryOutcome({
      requestId,
      symbol: 'BTCUSDT',
      interval: '1m',
      endTime: START,
      ...overrides,
    }))
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

  it('applies a completed page from its accepted event through a same-cycle outage', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    await act(async () => { await result.current.loadCandleHistory(START) })

    await act(async () => {
      emitHistoryPage(socket, requestId, 2, {
        offset: 0,
        total: 20,
        complete: true,
        rows: historyRows(-20, 0),
      })
      emitStatus(socket, requestId, 3, 'disconnected', 'SOCKET_DISCONNECTED')
    })

    expect(result.current.status).toBe('disconnected')
    expect(result.current.candleHistory.rows).toHaveLength(20)
    expect(result.current.candleHistory.rows[0].openTime).toBe(START - (20 * MINUTE))
    expect(result.current.candleHistory.readFailed).toBe(false)
  })

  it('keeps a matching served page when a mismatched outcome follows in the same batch', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const reads = () => sendMessage.mock.calls.filter(([message]) => (
      message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY
    ))
    await act(async () => { await result.current.loadCandleHistory(START) })

    await act(async () => {
      emitHistoryPage(socket, requestId, 2, {
        offset: 0,
        total: 20,
        complete: true,
        rows: historyRows(-20, 0),
      })
      emitUnavailableHistoryOutcome(socket, requestId, {
        endTime: START - (100 * MINUTE),
      })
    })

    expect(result.current.candleHistory.rows).toHaveLength(20)
    expect(result.current.candleHistory.readFailed).toBe(false)
    await act(async () => { await result.current.loadCandleHistory(START - (20 * MINUTE)) })
    expect(reads()).toHaveLength(2)
  })

  it('does not let a mismatched unavailable outcome release another history read', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const reads = () => sendMessage.mock.calls.filter(([message]) => (
      message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY
    ))
    await act(async () => { await result.current.loadCandleHistory(START) })

    await act(async () => emitUnavailableHistoryOutcome(socket, requestId, {
      endTime: START - (100 * MINUTE),
    }))

    expect(result.current.candleHistory.readFailed).toBe(false)
    await act(async () => { await result.current.loadCandleHistory(START) })
    expect(reads()).toHaveLength(1)
  })

  it('ignores an owner-unavailable outcome for an abandoned selection', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const abandonedRequestId = sendMessage.mock.calls[0][0].requestId
    await act(async () => { await result.current.loadCandleHistory(START) })

    rerender(defaultProps(socket, sendMessage, {
      symbol: 'ETHUSDT',
      candleHistoryCache: missingCache(),
    }))
    await act(async () => emitUnavailableHistoryOutcome(socket, abandonedRequestId))

    expect(result.current.symbol).toBe('ETHUSDT')
    expect(result.current.candleHistory.readFailed).toBe(false)
    await act(async () => { await result.current.loadCandleHistory(START) })
    const latestRead = sendMessage.mock.calls
      .map(([message]) => message)
      .filter(message => message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)
      .at(-1)
    expect(latestRead.symbol).toBe('ETHUSDT')
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

  // A switch keeps the last series on the chart until the new one lands, and
  // the chart asks for history behind the oldest bar it draws. Stamped with the
  // interval just selected, that read fetched 1m candles behind the oldest 5m
  // bar — a page a day and a half behind the 1m window, drawn with a hole in
  // front of it (BTRUSDT, 2026-09-03). A read waits for the series it would
  // page behind.
  it('reads no history behind the series of the interval being switched away from', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const candleHistoryCache = missingCache()
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const liveWindow = (id, revision, interval, rows) => socket.emitMessage(
      createFuturesProductionWorkstationEvent(eventValues(id, {
        revision,
        resource: 'candles',
        payload: Object.freeze({ series: 'contract', interval, rows: Object.freeze(rows) }),
      })),
    )
    act(() => liveWindow(requestId, 2, '1m', historyRows(-80, 0)))

    rerender(defaultProps(socket, sendMessage, { interval: '5m', candleHistoryCache }))
    const switchRequest = sendMessage.mock.calls.at(-1)[0]
    expect(switchRequest.action).toBe(FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL)
    expect(result.current.candlesSwitching).toBe(true)
    const refused = result.current.loadCandleHistory
    const sent = sendMessage.mock.calls.length

    // The chart still draws the 1m series, and asks behind its oldest bar.
    await act(async () => {
      expect(await result.current.loadCandleHistory(START - (80 * MINUTE))).toBe(false)
    })
    expect(sendMessage.mock.calls).toHaveLength(sent)
    expect(candleHistoryCache.readPage).not.toHaveBeenCalled()

    // The 5m series lands. The read is offered again under a new handle — the
    // chart re-evaluates its left edge on it — and pages behind that series.
    const fiveMinuteRows = Array.from({ length: 40 }, (_, index) => ({
      ...historyRows(0, 1)[0],
      openTime: START - ((40 - index) * 5 * MINUTE),
      closeTime: START - ((39 - index) * 5 * MINUTE) - 1,
    }))
    act(() => liveWindow(switchRequest.requestId, 3, '5m', fiveMinuteRows))
    expect(result.current.candlesSwitching).toBe(false)
    expect(result.current.loadCandleHistory).not.toBe(refused)
    await act(async () => {
      expect(await result.current.loadCandleHistory(fiveMinuteRows[0].openTime)).toBe(true)
    })
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY,
      requestId: switchRequest.requestId,
      symbol: 'BTCUSDT',
      interval: '5m',
      endTime: fiveMinuteRows[0].openTime,
    })
  })

  // The local candle store's window of the new interval lands first, under
  // `loading`, and is drawn beneath the veil; the switch waits for the
  // exchange's `live` window before the veil lifts (2026-09-03).
  it('keeps the switch wait through the store\'s loading window and ends it on the exchange\'s live one', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const candlesFrame = (id, revision, state, interval, rows) => socket.emitMessage(
      createFuturesProductionWorkstationEvent(eventValues(id, {
        revision,
        resource: 'candles',
        state,
        payload: Object.freeze({ series: 'contract', interval, rows: Object.freeze(rows) }),
      })),
    )
    act(() => candlesFrame(requestId, 2, 'live', '1m', historyRows(-80, 0)))
    rerender(defaultProps(socket, sendMessage, { interval: '5m' }))
    const switchRequest = sendMessage.mock.calls.at(-1)[0]
    expect(result.current.candlesSwitching).toBe(true)
    const fiveMinuteRows = Array.from({ length: 40 }, (_, index) => ({
      ...historyRows(0, 1)[0],
      openTime: START - ((40 - index) * 5 * MINUTE),
      closeTime: START - ((39 - index) * 5 * MINUTE) - 1,
    }))

    act(() => candlesFrame(switchRequest.requestId, 3, 'loading', '5m', fiveMinuteRows))
    expect(result.current.candlesSwitching).toBe(true)
    expect(result.current.resources.candles).toMatchObject({ interval: '5m', state: 'loading' })
    expect(result.current.resources.candles.contract).toHaveLength(40)

    act(() => candlesFrame(switchRequest.requestId, 4, 'live', '5m', fiveMinuteRows))
    expect(result.current.candlesSwitching).toBe(false)
    expect(result.current.resources.candles).toMatchObject({ interval: '5m', state: 'live' })
  })

  // A switch that fails states the new interval's candles `unavailable` with
  // the reason and retries on its own ladder. Waiting for `live` alone kept
  // the veil over that reason for the whole ladder (audit, 2026-09-04).
  it('ends the switch wait on the new interval\'s stated failure, as before', () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId
    const candlesFrame = (id, revision, state, interval, rows) => socket.emitMessage(
      createFuturesProductionWorkstationEvent(eventValues(id, {
        revision,
        resource: 'candles',
        state,
        payload: Object.freeze({ series: 'contract', interval, rows: Object.freeze(rows) }),
      })),
    )
    act(() => candlesFrame(requestId, 2, 'live', '1m', historyRows(-80, 0)))
    rerender(defaultProps(socket, sendMessage, { interval: '5m' }))
    const switchRequest = sendMessage.mock.calls.at(-1)[0]
    expect(result.current.candlesSwitching).toBe(true)

    act(() => candlesFrame(switchRequest.requestId, 3, 'unavailable', '5m', []))
    expect(result.current.candlesSwitching).toBe(false)
    expect(result.current.resources.candles).toMatchObject({ interval: '5m', state: 'unavailable' })
  })

  it('gives weekly candles and history a fresh owner and ignores the abandoned interval', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const candleHistoryCache = missingCache()
    const { result, rerender } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache }),
    })
    const abandonedRequestId = sendMessage.mock.calls[0][0].requestId
    await act(async () => { await result.current.loadCandleHistory(START) })

    rerender(defaultProps(socket, sendMessage, { interval: '1w', candleHistoryCache }))
    const weeklyRequest = sendMessage.mock.calls.at(-1)[0]
    expect(weeklyRequest).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL,
      interval: '1w',
    })
    expect(result.current.interval).toBe('1w')
    expect(result.current.candleHistory).toMatchObject({ interval: null, rows: [] })

    await act(async () => emitHistoryPage(socket, abandonedRequestId, 2, {
      offset: 0,
      total: 20,
      complete: true,
      rows: historyRows(-20, 0),
    }))
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(abandonedRequestId, {
        revision: 3,
        resource: 'candles',
        payload: Object.freeze({
          series: 'contract',
          interval: '1m',
          rows: Object.freeze([historyRows(-1, 0)[0]]),
        }),
      }),
    )))
    expect(result.current.candleHistory.rows).toHaveLength(0)
    expect(result.current.resources.candles).toBeNull()

    await act(async () => { await result.current.loadCandleHistory(START) })
    expect(sendMessage.mock.calls.at(-1)[0]).toMatchObject({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY,
      requestId: weeklyRequest.requestId,
      interval: '1w',
    })
    await act(async () => emitHistoryPage(socket, weeklyRequest.requestId, 4, {
      interval: '1w',
      offset: 0,
      total: 20,
      complete: true,
      rows: historyRows(-20, 0),
    }))
    act(() => socket.emitMessage(createFuturesProductionWorkstationEvent(
      eventValues(weeklyRequest.requestId, {
        revision: 5,
        resource: 'candles',
        payload: Object.freeze({
          series: 'contract',
          interval: '1w',
          rows: Object.freeze([historyRows(-1, 0)[0]]),
        }),
      }),
    )))

    expect(result.current.candleHistory).toMatchObject({ interval: '1w' })
    expect(result.current.candleHistory.rows).toHaveLength(20)
    expect(result.current.resources.candles).toMatchObject({ interval: '1w' })
    expect(candleHistoryCache.writePage).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      interval: '1w',
    }))
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

  // One failed read used to hold the request forever: scrolling left did
  // nothing for the rest of the session, and nothing on screen said why.
  describe('a read that could not be served', () => {
    const failHistory = (socket, requestId, revision, endTime) => {
      socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, {
        revision,
        resource: 'candleHistory',
        state: 'unavailable',
        payload: Object.freeze({
          series: 'contract',
          interval: '1m',
          endTime,
          offset: 0,
          total: 0,
          complete: true,
          rows: Object.freeze([]),
        }),
      })))
    }

    it('releases the lock so the next scroll asks again, and says why', async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId
      const reads = () => sendMessage.mock.calls
        .filter(([message]) => message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)

      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(1)
      // While one read is in flight, a second scroll asks for nothing.
      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(1)

      await act(async () => failHistory(socket, requestId, 3, START))

      expect(result.current.candleHistory.readFailed).toBe(true)
      // The run on screen is untouched, and nothing about the failure is taken
      // for the exchange saying there is nothing older.
      expect(result.current.candleHistory.exhausted).toBe(false)

      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(2)
    })

    it('answers only the read it was issued for', async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId
      // The session the read belongs to, settled before it is issued: a read
      // outstanding across a generation is a read nothing will answer, and this
      // scenario is about an answer that names another read, not about one.
      act(() => emitStatus(socket, requestId, 2, 'live'))

      await act(async () => { await result.current.loadCandleHistory(START) })
      // The answer to a read the chart has moved on from.
      await act(async () => failHistory(socket, requestId, 3, START - (5_000 * MINUTE)))

      expect(result.current.candleHistory.readFailed).toBe(false)
      const reads = sendMessage.mock.calls
        .filter(([message]) => message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)
      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(sendMessage.mock.calls
        .filter(([message]) => message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY)).toHaveLength(reads.length)
    })

    it('forgets the failure once a page is served', async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId

      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => failHistory(socket, requestId, 3, START))
      expect(result.current.candleHistory.readFailed).toBe(true)

      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => emitHistoryPage(socket, requestId, 4, {
        offset: 0, total: 20, complete: true, rows: historyRows(-20, 0),
      }))

      expect(result.current.candleHistory.readFailed).toBe(false)
      expect(result.current.candleHistory.rows).toHaveLength(20)
    })
  })

  // Runbook step 19. The operator cut the link, scrolled to where candles are
  // missing, restored the link and scrolled again: the candles never loaded for
  // the rest of the session, while the notice went on saying `scroll again to
  // retry`. Two latches produce that one screen — the chart concluding the
  // contract's history starts here, and the renderer holding a read nothing
  // will ever answer — and both are reached by the same sequence.
  describe('the link comes back and the chart asks again', () => {
    const failHistory = (socket, requestId, revision, endTime) => {
      socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, {
        revision,
        resource: 'candleHistory',
        state: 'unavailable',
        payload: Object.freeze({
          series: 'contract',
          interval: '1m',
          endTime,
          offset: 0,
          total: 0,
          complete: true,
          rows: Object.freeze([]),
        }),
      })))
    }

    const openScrolledToTheEdge = async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId
      const reads = () => sendMessage.mock.calls.filter(([message]) => (
        message.action === FUTURES_PRODUCTION_WORKSTATION_ACTIONS.LOAD_CANDLE_HISTORY
      ))
      act(() => emitStatus(socket, requestId, 2, 'live'))
      // The link goes down under the operator: the read they scrolled for is
      // answered by a failure, and the notice goes up.
      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => failHistory(socket, requestId, 3, START))
      expect(result.current.candleHistory.readFailed).toBe(true)
      // They scroll again, at the same left edge, so the same read.
      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(2)
      return { socket, result, requestId, reads }
    }

    // The desk states the link is down, and every resource it holds is restated
    // under that state — the same page, the same endTime, a new object. Read as
    // a page it deepened nothing, and a page that deepens nothing is the chart
    // concluding it has reached the start of the contract's history.
    it('does not read a stated outage as the exchange saying there is nothing older', async () => {
      const { socket, result, requestId, reads } = await openScrolledToTheEdge()

      await act(async () => emitStatus(socket, requestId, 4, 'disconnected', 'SOCKET_DISCONNECTED'))

      expect(result.current.candleHistory.exhausted).toBe(false)
      expect(result.current.candleHistory.exhaustedBy).toBeNull()
      // The notice stands. A status transition is not the answer to the newer
      // read already in flight, so it cannot release that read's lock.
      expect(result.current.candleHistory.readFailed).toBe(true)
      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(2)
    })

    // The link comes back and the session is rebuilt under a new generation.
    // The read outstanding across it is not travelling — its answer is dropped
    // for being older than what is on screen, or was never read at all.
    it('lets go of a read the resynchronization abandoned', async () => {
      const { socket, result, requestId, reads } = await openScrolledToTheEdge()

      await act(async () => emitStatus(socket, requestId, 1, 'live', null, 2))

      await act(async () => { await result.current.loadCandleHistory(START) })
      expect(reads()).toHaveLength(3)
      // And the page that scroll asks for is drawn — served under the
      // generation the session was rebuilt as.
      await act(async () => socket.emitMessage(createFuturesProductionWorkstationEvent(
        eventValues(requestId, {
          generation: 2,
          revision: 2,
          resource: 'candleHistory',
          payload: Object.freeze({
            series: 'contract',
            interval: '1m',
            endTime: START,
            offset: 0,
            total: 20,
            complete: true,
            rows: historyRows(-20, 0),
          }),
        }),
      )))
      expect(result.current.candleHistory.rows).toHaveLength(20)
      expect(result.current.candleHistory.readFailed).toBe(false)
    })

    // The other half of the same rule: a page the exchange did serve, and that
    // came back short, still stops the asking — and says which of the two
    // reasons it is, because they are not the same fact.
    it('still stops asking on a page the exchange served short', async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId

      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => emitHistoryPage(socket, requestId, 2, {
        offset: 0, total: 20, complete: true, rows: historyRows(-20, 0),
      }))

      expect(result.current.candleHistory.exhausted).toBe(true)
      expect(result.current.candleHistory.exhaustedBy).toBe('history-start')
    })

    it('names its own ceiling as its own, not as the start of the contract', async () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      const requestId = sendMessage.mock.calls[0][0].requestId

      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => emitHistoryResponse(
        socket,
        requestId,
        2,
        historyRows(-1_000, 0),
      ))
      expect(result.current.candleHistory.exhausted).toBe(false)
      // A page the exchange served in full, reaching no further back than the
      // rows already held: the desk stops asking, and the reason is the desk's.
      await act(async () => { await result.current.loadCandleHistory(START) })
      await act(async () => emitHistoryResponse(
        socket,
        requestId,
        15,
        historyRows(-1_000, 0),
      ))

      expect(result.current.candleHistory.exhausted).toBe(true)
      expect(result.current.candleHistory.exhaustedBy).toBe('chart-limit')
    })
  })

  // A connection transition rewrites every resource — same page, same endTime,
  // a new object — and the effect that applies a history answer would apply the
  // one it had already applied. That was harmless until a page that cannot
  // deepen the run came to mean the history has a start: a dropped connection
  // then told the chart there was nothing older, and the contract could load no
  // more depth until the operator changed symbol or interval.
  it('does not read a dropped connection as the end of the contract history', async () => {
    const socket = new LocalSocket()
    const sendMessage = vi.fn(() => true)
    const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
      initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
    })
    const requestId = sendMessage.mock.calls[0][0].requestId

    await act(async () => { await result.current.loadCandleHistory(START) })
    const page = historyRows(-1_000, 0)
    for (let offset = 0; offset < page.length; offset += 80) {
      const rows = page.slice(offset, offset + 80)
      await act(async () => emitHistoryPage(socket, requestId, 3 + (offset / 80), {
        offset,
        total: page.length,
        complete: offset + rows.length === page.length,
        rows,
      }))
    }
    expect(result.current.candleHistory.rows).toHaveLength(1_000)
    expect(result.current.candleHistory.exhausted).toBe(false)

    await act(async () => { socket.closeLocally() })

    expect(result.current.status).toBe('disconnected')
    expect(result.current.candleHistory.rows).toHaveLength(1_000)
    expect(result.current.candleHistory.exhausted).toBe(false)
  })

  // The window the stream re-sends is bounded and slides: when a bar opens, the
  // oldest one in it is not in the next frame. History was read behind where
  // the window stood then, so a bar that leaves afterwards was in neither run,
  // and the chart drew bar 19 against bar 23 with nothing to say that four
  // minutes were missing between them.
  describe('bars leaving the live window', () => {
    const liveWindow = (from, to, closed = true) => Object.freeze(
      historyRows(from, to).map(row => Object.freeze({ ...row, closed })),
    )
    const emitWindow = (socket, requestId, revision, rows, interval = '1m') => {
      socket.emitMessage(createFuturesProductionWorkstationEvent(eventValues(requestId, {
        revision,
        resource: 'candles',
        payload: Object.freeze({ series: 'contract', interval, rows }),
      })))
    }
    const openWorkstation = () => {
      const socket = new LocalSocket()
      const sendMessage = vi.fn(() => true)
      const { result } = renderHook(props => useFuturesProductionWorkstation(props), {
        initialProps: defaultProps(socket, sendMessage, { candleHistoryCache: missingCache() }),
      })
      return { socket, result, requestId: sendMessage.mock.calls[0][0].requestId }
    }

    it('keeps a bar that fell out of the window, behind the window it left', async () => {
      const { socket, result, requestId } = openWorkstation()
      act(() => emitWindow(socket, requestId, 2, liveWindow(-20, 0)))
      expect(result.current.candleHistory.rows).toHaveLength(0)

      // Three bars later the window holds -17..3 and bars -20, -19 and -18 are
      // in no frame the renderer will ever see again.
      act(() => emitWindow(socket, requestId, 3, liveWindow(-17, 3)))

      expect(result.current.candleHistory.rows.map(row => row.openTime)).toEqual(
        liveWindow(-20, -17).map(row => row.openTime),
      )
      expect(result.current.candleHistory.symbol).toBe('BTCUSDT')
      expect(result.current.candleHistory.interval).toBe('1m')
    })

    it('joins what leaves the window to the end of the history already read', async () => {
      const { socket, result, requestId } = openWorkstation()
      act(() => emitWindow(socket, requestId, 2, liveWindow(-20, 0)))
      await act(async () => { await result.current.loadCandleHistory(START - (20 * MINUTE)) })
      await act(async () => emitHistoryPage(socket, requestId, 3, {
        endTime: START - (20 * MINUTE),
        offset: 0,
        total: 40,
        complete: true,
        rows: historyRows(-60, -20),
      }))
      expect(result.current.candleHistory.rows).toHaveLength(40)

      act(() => emitWindow(socket, requestId, 4, liveWindow(-18, 2)))

      // One run, in order, with no bar invented or lost where the two meet.
      const rows = result.current.candleHistory.rows
      expect(rows.map(row => row.openTime)).toEqual(historyRows(-60, -18).map(row => row.openTime))
    })

    // A window that jumped is not a window that slid. Joining across the jump
    // would put a hole on screen and call it continuous data, which is the one
    // thing a short chart may never become.
    it('drops rows from a window that jumped instead of joining across the gap', () => {
      const { socket, result, requestId } = openWorkstation()
      act(() => emitWindow(socket, requestId, 2, liveWindow(-20, 0)))
      act(() => emitWindow(socket, requestId, 3, liveWindow(60, 80)))

      expect(result.current.candleHistory.rows).toHaveLength(0)
    })

    // A bar still open is not history: it is the bar the stream is moving.
    it('keeps nothing from a window whose leaving rows never closed', () => {
      const { socket, result, requestId } = openWorkstation()
      act(() => emitWindow(socket, requestId, 2, liveWindow(-20, 0, false)))
      act(() => emitWindow(socket, requestId, 3, liveWindow(-17, 3, false)))

      expect(result.current.candleHistory.rows).toHaveLength(0)
    })
  })
})
