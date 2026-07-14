import { describe, expect, it } from 'vitest'
import {
  FUTURES_WORKSTATION_RESOURCES,
  FUTURES_WORKSTATION_STATES,
  FuturesWorkstationProtocolError,
  applyFuturesWorkstationEvent,
  parseBoundedFuturesWorkstationJson,
} from './futuresWorkstationProtocolShared.js'
import {
  FUTURES_TESTNET_WORKSTATION_ACTIONS,
  createFuturesTestnetWorkstationEvent,
  createFuturesTestnetWorkstationSelectIntervalRequest,
  createFuturesTestnetWorkstationSelectSymbolRequest,
  createFuturesTestnetWorkstationSubscribeRequest,
  createFuturesTestnetWorkstationUnsubscribeRequest,
  parseFuturesTestnetWorkstationEvent,
  readFuturesTestnetWorkstationRequest,
} from './futuresTestnetWorkstationProtocol.js'
import {
  createFuturesProductionWorkstationEvent,
  createFuturesProductionWorkstationSubscribeRequest,
  parseFuturesProductionWorkstationEvent,
  readFuturesProductionWorkstationRequest,
} from './futuresProductionWorkstationProtocol.js'

const requestValues = Object.freeze({
  requestId: 'protocol-request-1',
  symbol: 'BTCUSDT',
  interval: '1m',
})

const filters = Object.freeze({
  price: Object.freeze({ min: '0.1', max: '1000000', tickSize: '0.1' }),
  quantity: Object.freeze({ min: '0.001', max: '1000', stepSize: '0.001' }),
  marketQuantity: Object.freeze({ min: '0.001', max: '100', stepSize: '0.001' }),
  minimumNotional: '5',
})

const payloads = Object.freeze({
  [FUTURES_WORKSTATION_RESOURCES.STATUS]: Object.freeze({
    connected: true,
    reasonCode: null,
  }),
  [FUTURES_WORKSTATION_RESOURCES.CATALOG]: Object.freeze({
    offset: 0,
    total: 1,
    complete: true,
    contracts: Object.freeze([Object.freeze({
      symbol: 'BTCUSDT',
      pair: 'BTCUSDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marginAsset: 'USDT',
      allowlisted: true,
      filters,
    })]),
  }),
  [FUTURES_WORKSTATION_RESOURCES.HEADER]: Object.freeze({
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
  }),
  [FUTURES_WORKSTATION_RESOURCES.CANDLES]: Object.freeze({
    series: 'contract',
    interval: '1m',
    rows: Object.freeze([Object.freeze({
      openTime: 1_784_000_000_000,
      closeTime: 1_784_000_059_999,
      open: '58400',
      high: '58500',
      low: '58300',
      close: '58420',
      volume: '100.5',
      closed: false,
    })]),
  }),
  [FUTURES_WORKSTATION_RESOURCES.DEPTH]: Object.freeze({
    lastUpdateId: '90071992547409931234',
    bids: Object.freeze([Object.freeze({ price: '58420', quantity: '2', total: '2' })]),
    asks: Object.freeze([Object.freeze({ price: '58421', quantity: '3', total: '3' })]),
    spread: '1',
  }),
  [FUTURES_WORKSTATION_RESOURCES.TRADES]: Object.freeze({
    rows: Object.freeze([Object.freeze({
      aggregateTradeId: '90071992547409931235',
      price: '58420.5',
      quantity: '0.25',
      normalQuantity: '0.25',
      firstTradeId: '90071992547409931236',
      lastTradeId: '90071992547409931236',
      tradeTime: 1_784_000_000_000,
      buyerMaker: false,
    })]),
  }),
})

const createEventValues = resource => ({
  requestId: requestValues.requestId,
  symbol: requestValues.symbol,
  generation: 1,
  revision: 1,
  resource,
  state: FUTURES_WORKSTATION_STATES.LIVE,
  observedAt: 1_784_000_000_000,
  payload: payloads[resource],
})

describe('Futures workstation environment-specific protocols', () => {
  it.each([
    ['subscribe', createFuturesTestnetWorkstationSubscribeRequest, FUTURES_TESTNET_WORKSTATION_ACTIONS.SUBSCRIBE],
    ['symbol', createFuturesTestnetWorkstationSelectSymbolRequest, FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_SYMBOL],
    ['interval', createFuturesTestnetWorkstationSelectIntervalRequest, FUTURES_TESTNET_WORKSTATION_ACTIONS.SELECT_INTERVAL],
  ])('round-trips the exact Testnet %s action', (_label, create, action) => {
    const request = create(requestValues)
    expect(readFuturesTestnetWorkstationRequest(JSON.stringify(request))).toEqual(request)
    expect(request.action).toBe(action)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('uses an exact smaller unsubscribe shape', () => {
    const request = createFuturesTestnetWorkstationUnsubscribeRequest({
      requestId: requestValues.requestId,
    })
    expect(request).not.toHaveProperty('symbol')
    expect(readFuturesTestnetWorkstationRequest(JSON.stringify(request))).toEqual(request)
  })

  it('rejects extra request fields including network and execution authority', () => {
    for (const extra of [
      { host: 'demo-fapi.binance.com' },
      { headers: {} },
      { quantity: '1' },
      { orderType: 'MARKET' },
      { environmentOption: 'PRODUCTION' },
    ]) {
      const raw = JSON.stringify({
        ...createFuturesTestnetWorkstationSubscribeRequest(requestValues),
        ...extra,
      })
      expect(() => readFuturesTestnetWorkstationRequest(raw)).toThrow(FuturesWorkstationProtocolError)
    }
  })

  it('rejects duplicate keys before object materialization', () => {
    const raw = JSON.stringify(createFuturesTestnetWorkstationSubscribeRequest(requestValues))
      .replace('"symbol":"BTCUSDT"', '"symbol":"BTCUSDT","symbol":"ETHUSDT"')
    expect(() => readFuturesTestnetWorkstationRequest(raw)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_JSON_KEY' }),
    )
  })

  it.each(['btcusdt', ' BTCUSDT', 'BTC/USDT', 'A'.repeat(21)])(
    'rejects malformed symbol %s',
    (symbol) => {
      expect(() => createFuturesTestnetWorkstationSubscribeRequest({
        ...requestValues,
        symbol,
      })).toThrow(FuturesWorkstationProtocolError)
    },
  )

  it.each(['3m', '1M', '60m', '', '1m '])('rejects an unreviewed interval %s', (interval) => {
    expect(() => createFuturesTestnetWorkstationSubscribeRequest({
      ...requestValues,
      interval,
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it('rejects oversized request frames before parsing', () => {
    const request = JSON.stringify(createFuturesTestnetWorkstationSubscribeRequest(requestValues))
    expect(() => readFuturesTestnetWorkstationRequest(`${request}${' '.repeat(1_024)}`))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  it('rejects unsafe and floating JSON numbers', () => {
    expect(() => parseBoundedFuturesWorkstationJson('{"value":9007199254740993}', { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'UNSAFE_JSON_INTEGER' }))
    expect(() => parseBoundedFuturesWorkstationJson('{"value":1.5}', { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_NUMBER' }))
  })

  it.each(Object.values(FUTURES_WORKSTATION_RESOURCES))(
    'round-trips immutable Testnet and production %s events',
    (resource) => {
      const testnet = createFuturesTestnetWorkstationEvent(createEventValues(resource))
      const production = createFuturesProductionWorkstationEvent(createEventValues(resource))
      expect(parseFuturesTestnetWorkstationEvent(JSON.stringify(testnet))).toEqual(testnet)
      expect(parseFuturesProductionWorkstationEvent(JSON.stringify(production))).toEqual(production)
      expect(Object.isFrozen(testnet.payload)).toBe(true)
      expect(Object.isFrozen(production.payload)).toBe(true)
    },
  )

  it('rejects Testnet/production protocol confusion in both directions', () => {
    const testnetRequest = createFuturesTestnetWorkstationSubscribeRequest(requestValues)
    const productionRequest = createFuturesProductionWorkstationSubscribeRequest(requestValues)
    expect(() => readFuturesProductionWorkstationRequest(JSON.stringify(testnetRequest)))
      .toThrow(FuturesWorkstationProtocolError)
    expect(() => readFuturesTestnetWorkstationRequest(JSON.stringify(productionRequest)))
      .toThrow(FuturesWorkstationProtocolError)

    const testnetEvent = createFuturesTestnetWorkstationEvent(createEventValues('status'))
    const productionEvent = createFuturesProductionWorkstationEvent(createEventValues('status'))
    expect(() => parseFuturesProductionWorkstationEvent(JSON.stringify(testnetEvent)))
      .toThrow(FuturesWorkstationProtocolError)
    expect(() => parseFuturesTestnetWorkstationEvent(JSON.stringify(productionEvent)))
      .toThrow(FuturesWorkstationProtocolError)
  })

  it('preserves lossless int64 identities as strings', () => {
    const event = createFuturesProductionWorkstationEvent(createEventValues('trades'))
    const parsed = parseFuturesProductionWorkstationEvent(JSON.stringify(event))
    expect(parsed.payload.rows[0].aggregateTradeId).toBe('90071992547409931235')
    expect(typeof parsed.payload.rows[0].aggregateTradeId).toBe('string')
  })

  it('rejects invalid resource payloads and noncanonical decimals', () => {
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('header'),
      payload: { ...payloads.header, lastPrice: '058420.1' },
    })).toThrow(FuturesWorkstationProtocolError)
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('status'),
      payload: { connected: true, reasonCode: null, credentials: 'forbidden' },
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it('merges candle series without environment or authority selection', () => {
    const initial = Object.freeze({
      status: 'loading',
      symbol: 'BTCUSDT',
      generation: 0,
      revision: 0,
      observedAt: null,
      resources: Object.freeze({
        status: null,
        catalog: null,
        header: null,
        candles: null,
        depth: null,
        trades: null,
      }),
    })
    const contract = createFuturesTestnetWorkstationEvent(createEventValues('candles'))
    const mark = createFuturesTestnetWorkstationEvent({
      ...createEventValues('candles'),
      revision: 2,
      payload: { ...payloads.candles, series: 'mark' },
    })
    const next = applyFuturesWorkstationEvent(applyFuturesWorkstationEvent(initial, contract), mark)
    expect(next.resources.candles.contract).toHaveLength(1)
    expect(next.resources.candles.mark).toHaveLength(1)
    expect(next.resources.candles.index).toEqual([])
  })
})
