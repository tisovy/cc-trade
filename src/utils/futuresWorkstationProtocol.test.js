import { describe, expect, it } from 'vitest'
import {
  FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE,
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  FUTURES_WORKSTATION_PROTOCOL_VERSION,
  FUTURES_WORKSTATION_RESOURCES,
  FUTURES_WORKSTATION_STATES,
  FuturesWorkstationProtocolError,
  applyFuturesWorkstationEvent,
  parseBoundedFuturesWorkstationJson,
} from './futuresWorkstationProtocolShared.js'
import {
  FUTURES_PRODUCTION_WORKSTATION_ACTIONS,
  createFuturesProductionWorkstationConfigureDepthRequest,
  createFuturesProductionWorkstationConfigureTapeRequest,
  createFuturesProductionWorkstationEvent,
  createFuturesProductionWorkstationSelectIntervalRequest,
  createFuturesProductionWorkstationSelectSymbolRequest,
  createFuturesProductionWorkstationSubscribeRequest,
  createFuturesProductionWorkstationUnsubscribeRequest,
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
  percentPrice: Object.freeze({
    multiplierUp: '1.1500',
    multiplierDown: '0.8500',
    multiplierDecimal: 4,
  }),
  maximumOrders: 200,
  maximumAlgoOrders: 100,
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
      tradable: true,
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
  [FUTURES_WORKSTATION_RESOURCES.CANDLE_HISTORY]: Object.freeze({
    series: 'contract',
    interval: '1m',
    endTime: 1_784_000_000_000,
    offset: 0,
    total: 1,
    complete: true,
    rows: Object.freeze([Object.freeze({
      openTime: 1_783_999_940_000,
      closeTime: 1_783_999_999_999,
      open: '58300',
      high: '58450',
      low: '58250',
      close: '58400',
      volume: '87.25',
      closed: true,
    })]),
  }),
  [FUTURES_WORKSTATION_RESOURCES.DEPTH]: Object.freeze({
    lastUpdateId: '9007199254740993',
    bids: Object.freeze([Object.freeze({ price: '58420', quantity: '2', total: '2' })]),
    asks: Object.freeze([Object.freeze({ price: '58421', quantity: '3', total: '3' })]),
    spread: '1',
  }),
  [FUTURES_WORKSTATION_RESOURCES.TRADES]: Object.freeze({
    rows: Object.freeze([Object.freeze({
      aggregateTradeId: '9007199254740994',
      price: '58420.5',
      quantity: '0.25',
      normalQuantity: '0.25',
      firstTradeId: '9007199254740995',
      lastTradeId: '9007199254740995',
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
  it('uses protocol revision 5 for bounded tape configuration', () => {
    expect(FUTURES_WORKSTATION_PROTOCOL_VERSION).toBe('6')
  })

  it('preserves an unavailable per-symbol algo limit instead of inventing one', () => {
    const contract = payloads.catalog.contracts[0]
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('catalog'),
      payload: {
        ...payloads.catalog,
        contracts: [{
          ...contract,
          filters: { ...contract.filters, maximumAlgoOrders: null },
        }],
      },
    })).not.toThrow()
  })

  it.each([
    ['negative max orders', { maximumOrders: -1 }],
    ['missing max orders', { maximumOrders: null }],
    ['zero legacy algo orders', { maximumAlgoOrders: 0 }],
    ['negative legacy algo orders', { maximumAlgoOrders: -1 }],
  ])('rejects %s in a catalog filter projection', (_label, filterOverride) => {
    const contract = payloads.catalog.contracts[0]
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('catalog'),
      payload: {
        ...payloads.catalog,
        contracts: [{
          ...contract,
          filters: { ...contract.filters, ...filterOverride },
        }],
      },
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it.each([
    ['subscribe', createFuturesProductionWorkstationSubscribeRequest, FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE],
    ['symbol', createFuturesProductionWorkstationSelectSymbolRequest, FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_SYMBOL],
    ['interval', createFuturesProductionWorkstationSelectIntervalRequest, FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SELECT_INTERVAL],
  ])('round-trips the exact production %s action', (_label, create, action) => {
    const request = create(requestValues)
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
    expect(request.action).toBe(action)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it('uses an exact smaller unsubscribe shape', () => {
    const request = createFuturesProductionWorkstationUnsubscribeRequest({
      requestId: requestValues.requestId,
    })
    expect(request).not.toHaveProperty('symbol')
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
  })

  it('round-trips an exact bounded tape configuration without market authority', () => {
    const request = createFuturesProductionWorkstationConfigureTapeRequest({
      requestId: requestValues.requestId,
      throttleEnabled: true,
      timeoutMs: 250,
      minNotionalUsdt: '1250.5',
    })

    expect(request).toEqual(expect.objectContaining({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_TAPE,
      throttleEnabled: true,
      timeoutMs: 250,
      minNotionalUsdt: '1250.5',
    }))
    expect(request).not.toHaveProperty('symbol')
    expect(request).not.toHaveProperty('interval')
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it.each([
    ['non-boolean throttle', { throttleEnabled: 'true' }],
    ['sub-frame timeout', { timeoutMs: 15 }],
    ['oversized timeout', { timeoutMs: 5_001 }],
    ['floating timeout', { timeoutMs: 250.5 }],
    ['negative notional', { minNotionalUsdt: '-1' }],
    ['non-finite notional', { minNotionalUsdt: 'Infinity' }],
    ['non-canonical notional', { minNotionalUsdt: '01' }],
  ])('rejects %s in bounded tape configuration', (_label, override) => {
    expect(() => createFuturesProductionWorkstationConfigureTapeRequest({
      requestId: requestValues.requestId,
      throttleEnabled: true,
      timeoutMs: 250,
      minNotionalUsdt: '0',
      ...override,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_TAPE_CONFIGURATION' }))
  })

  // How far past the best price the rows on screen reach — the rows times the
  // step they are grouped by. One decimal, because the count and the step are
  // the renderer's to know and their product is all the backend needs to pick
  // which page of the book to buy.
  it('round-trips a bounded depth reading without market authority', () => {
    const request = createFuturesProductionWorkstationConfigureDepthRequest({
      requestId: requestValues.requestId,
      range: '0.000014',
    })

    expect(request).toEqual(expect.objectContaining({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH,
      range: '0.000014',
    }))
    expect(request).not.toHaveProperty('symbol')
    expect(request).not.toHaveProperty('interval')
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it.each([
    ['a negative range', '-1'],
    ['a non-finite range', 'Infinity'],
    ['a non-canonical range', '01'],
    ['a range that is not a string', 14],
    ['a range longer than the bound', `0.${'0'.repeat(64)}1`],
  ])('rejects %s in a bounded depth reading', (_label, range) => {
    expect(() => createFuturesProductionWorkstationConfigureDepthRequest({
      requestId: requestValues.requestId,
      range,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_DEPTH_CONFIGURATION' }))
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
        ...createFuturesProductionWorkstationSubscribeRequest(requestValues),
        ...extra,
      })
      expect(() => readFuturesProductionWorkstationRequest(raw)).toThrow(FuturesWorkstationProtocolError)
    }
  })

  it('rejects duplicate keys before object materialization', () => {
    const raw = JSON.stringify(createFuturesProductionWorkstationSubscribeRequest(requestValues))
      .replace('"symbol":"BTCUSDT"', '"symbol":"BTCUSDT","symbol":"ETHUSDT"')
    expect(() => readFuturesProductionWorkstationRequest(raw)).toThrowError(
      expect.objectContaining({ code: 'DUPLICATE_JSON_KEY' }),
    )
  })

  it.each(['btcusdt', ' BTCUSDT', 'BTC/USDT', 'A'.repeat(21)])(
    'rejects malformed symbol %s',
    (symbol) => {
      expect(() => createFuturesProductionWorkstationSubscribeRequest({
        ...requestValues,
        symbol,
      })).toThrow(FuturesWorkstationProtocolError)
    },
  )

  it('round-trips an official dated delivery-contract symbol', () => {
    const delivery = { ...requestValues, symbol: 'BTCUSDT_260925' }
    const production = createFuturesProductionWorkstationSubscribeRequest(delivery)
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(production))).toEqual(production)
  })

  it('round-trips a bounded Unicode public symbol and keeps it observe-only', () => {
    const symbol = '测试测试USDT'
    const request = createFuturesProductionWorkstationSubscribeRequest({
      ...requestValues,
      symbol,
    })
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)

    const contract = payloads.catalog.contracts[0]
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('catalog'),
      symbol,
      payload: {
        ...payloads.catalog,
        contracts: [{
          ...contract,
          symbol,
          pair: symbol,
          baseAsset: '测试测试',
          tradable: false,
        }],
      },
    })).not.toThrow()
  })

  it.each([
    `${'测'.repeat(17)}USDT`,
    `${'\u{20000}'.repeat(16)}USDT`,
  ])('rejects an over-bound Unicode public symbol %s', (symbol) => {
    expect(() => createFuturesProductionWorkstationSubscribeRequest({
      ...requestValues,
      symbol,
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it.each(['BTCUSDT_BAD', 'BTCUSDT_26092', 'BTCUSDT_260925_', '_BTCUSDT260925'])(
    'rejects malformed dated symbol %s',
    (symbol) => {
      expect(() => createFuturesProductionWorkstationSubscribeRequest({
        ...requestValues,
        symbol,
      })).toThrow(FuturesWorkstationProtocolError)
    },
  )

  it('accepts exactly 1024 catalog rows and rejects 1025', () => {
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('catalog'),
      payload: { ...payloads.catalog, total: 1_024, complete: false },
    })).not.toThrow()
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('catalog'),
      payload: { ...payloads.catalog, total: 1_025, complete: false },
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it.each(['3m', '1M', '60m', '', '1m '])('rejects an unreviewed interval %s', (interval) => {
    expect(() => createFuturesProductionWorkstationSubscribeRequest({
      ...requestValues,
      interval,
    })).toThrow(FuturesWorkstationProtocolError)
  })

  it('rejects oversized request frames before parsing', () => {
    const request = JSON.stringify(createFuturesProductionWorkstationSubscribeRequest(requestValues))
    expect(() => readFuturesProductionWorkstationRequest(`${request}${' '.repeat(1_024)}`))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  // The parser counts a string's bytes instead of encoding it, and takes an
  // unescaped span verbatim instead of re-parsing it. Both shortcuts sit on the
  // depth hot path and both are security-relevant, so they are held against the
  // things they replaced rather than assumed equivalent.
  it.each([
    'plain',
    'кириллица',
    '☃ snowman',
    '𝄞 clef',
    'quote \\" and backslash \\\\',
    'escaped \\u0416 codepoint',
    'tab\\tnewline\\n',
  ])('decodes and measures %s exactly as JSON and TextEncoder do', (encoded) => {
    const raw = `{"value":"${encoded}"}`
    const expected = JSON.parse(raw).value
    expect(parseBoundedFuturesWorkstationJson(raw, { maxBytes: 1_000 }).value).toBe(expected)
    const bytes = new TextEncoder().encode(expected).byteLength
    expect(parseBoundedFuturesWorkstationJson(raw, { maxBytes: 1_000, maxStringBytes: bytes }).value)
      .toBe(expected)
    expect(() => parseBoundedFuturesWorkstationJson(raw, {
      maxBytes: 1_000,
      maxStringBytes: bytes - 1,
    })).toThrowError(expect.objectContaining({ code: 'JSON_RESOURCE_LIMIT' }))
    expect(() => parseBoundedFuturesWorkstationJson(raw, {
      maxBytes: new TextEncoder().encode(raw).byteLength - 1,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  it('rejects a lone surrogate rather than counting it as a pair', () => {
    expect(() => parseBoundedFuturesWorkstationJson('{"value":"\ud83d"}', { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  it('rejects unsafe and floating JSON numbers', () => {
    expect(() => parseBoundedFuturesWorkstationJson('{"value":9007199254740993}', { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'UNSAFE_JSON_INTEGER' }))
    expect(() => parseBoundedFuturesWorkstationJson('{"value":1.5}', { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_NUMBER' }))
  })

  it.each(Object.values(FUTURES_WORKSTATION_RESOURCES))(
    'round-trips immutable production %s events',
    (resource) => {
      const production = createFuturesProductionWorkstationEvent(createEventValues(resource))
      expect(parseFuturesProductionWorkstationEvent(JSON.stringify(production))).toEqual(production)
      expect(Object.isFrozen(production.payload)).toBe(true)
    },
  )

  it('rejects retired environment identities on the production protocol', () => {
    const productionRequest = createFuturesProductionWorkstationSubscribeRequest(requestValues)
    expect(() => readFuturesProductionWorkstationRequest(JSON.stringify({
      ...productionRequest,
      environment: 'TESTNET',
    }))).toThrow(FuturesWorkstationProtocolError)

    const productionEvent = createFuturesProductionWorkstationEvent(createEventValues('status'))
    expect(() => parseFuturesProductionWorkstationEvent(JSON.stringify({
      ...productionEvent,
      environment: 'TESTNET',
    }))).toThrow(FuturesWorkstationProtocolError)
  })

  // The book the desk delivers is the largest and node-densest frame on the
  // wire. Its byte bound, its node bound and the level count it is allowed to
  // carry are three separate numbers, and a frame that clears the payload rules
  // but trips either parser bound does not degrade — depth simply stops
  // arriving. So the deepest legal book is parsed here, not reasoned about.
  it('parses the deepest legal depth frame rather than running out of budget', () => {
    // Long decimals throughout, and the longest identities the rules accept:
    // the bound has to hold for the widest book the protocol calls legal, not
    // for the tidy one this contract happens to quote today.
    const level = index => ({
      price: `${900_000 + index}.123456789012345678`,
      quantity: '184467440737.09551615',
      total: `${184_467_440_737 * (index + 1)}.09551615`,
    })
    const event = createFuturesProductionWorkstationEvent({
      ...createEventValues('depth'),
      requestId: 'a'.repeat(96),
      symbol: 'ABCDEFGHIJKLMNOPQRST',
      payload: {
        lastUpdateId: '18446744073709551615',
        bids: Array.from({ length: FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE },
          (_, index) => level(-index)),
        asks: Array.from({ length: FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE },
          (_, index) => level(index + 1)),
        spread: '0.00001',
      },
    })
    const raw = JSON.stringify(event)
    expect(new TextEncoder().encode(raw).byteLength)
      .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES)
    expect(parseFuturesProductionWorkstationEvent(raw).payload.bids)
      .toHaveLength(FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE)
  })

  it('preserves lossless int64 identities as strings', () => {
    const event = createFuturesProductionWorkstationEvent(createEventValues('trades'))
    const parsed = parseFuturesProductionWorkstationEvent(JSON.stringify(event))
    expect(parsed.payload.rows[0].aggregateTradeId).toBe('9007199254740994')
    expect(typeof parsed.payload.rows[0].aggregateTradeId).toBe('string')
  })

  it('rejects renderer identities outside unsigned int64', () => {
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('depth'),
      payload: { ...payloads.depth, lastUpdateId: '18446744073709551616' },
    })).toThrow(FuturesWorkstationProtocolError)
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
    const contract = createFuturesProductionWorkstationEvent(createEventValues('candles'))
    const index = createFuturesProductionWorkstationEvent({
      ...createEventValues('candles'),
      revision: 2,
      payload: { ...payloads.candles, series: 'index' },
    })
    const next = applyFuturesWorkstationEvent(applyFuturesWorkstationEvent(initial, contract), index)
    expect(next.resources.candles.contract).toHaveLength(1)
    expect(next.resources.candles.index).toHaveLength(1)
  })

  it('clears prior-generation resources and marks cached data non-live during resync', () => {
    const initial = Object.freeze({
      status: 'live',
      symbol: 'BTCUSDT',
      generation: 1,
      revision: 9,
      observedAt: 1_784_000_000_000,
      resources: Object.freeze({
        status: Object.freeze({ connected: true, reasonCode: null, state: 'live' }),
        catalog: null,
        header: Object.freeze({ ...payloads.header, state: 'live' }),
        candles: null,
        depth: Object.freeze({ ...payloads.depth, state: 'live' }),
        trades: null,
      }),
    })
    const loading = createFuturesProductionWorkstationEvent({
      ...createEventValues('status'),
      generation: 2,
      state: 'loading',
      payload: { connected: false, reasonCode: null },
    })
    const reset = applyFuturesWorkstationEvent(initial, loading)
    expect(reset.resources.header).toBeNull()
    expect(reset.resources.depth).toBeNull()

    const header = createFuturesProductionWorkstationEvent({
      ...createEventValues('header'),
      generation: 2,
      revision: 2,
    })
    const resynchronizing = createFuturesProductionWorkstationEvent({
      ...createEventValues('status'),
      generation: 2,
      revision: 3,
      state: 'resynchronizing',
      payload: { connected: false, reasonCode: 'DEPTH_SEQUENCE_GAP' },
    })
    const transitioned = applyFuturesWorkstationEvent(
      applyFuturesWorkstationEvent(reset, header),
      resynchronizing,
    )
    expect(transitioned.status).toBe('resynchronizing')
    expect(transitioned.resources.header.state).toBe('resynchronizing')
    expect(transitioned.resources.header.observedAt).toBe(resynchronizing.observedAt)
  })
})
