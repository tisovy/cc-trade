import { describe, expect, it } from 'vitest'
import {
  FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE,
  FUTURES_WORKSTATION_EVENT_MAX_BYTES,
  FUTURES_WORKSTATION_PROTOCOL_VERSION,
  FUTURES_WORKSTATION_RESOURCES,
  FUTURES_WORKSTATION_STATES,
  FuturesWorkstationProtocolError,
  applyFuturesWorkstationEvent,
  parseBoundedFuturesWorkstationJson,
  transitionFuturesWorkstationConnectionState,
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
    step: null,
    bids: Object.freeze([Object.freeze({
      price: '58420',
      quantity: '2',
      value: '116840',
      groupKey: '58420000000000000000000',
      whole: true,
    })]),
    asks: Object.freeze([Object.freeze({
      price: '58421',
      quantity: '3',
      value: '175263',
      groupKey: '58421000000000000000000',
      whole: true,
    })]),
    spread: '1',
    reach: Object.freeze({ below: '120', above: '118' }),
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
  // Bumped with the shape of what crosses: 8 let the request that opens a
  // contract carry the reading its rows need, 9 stated the book's reach on the
  // delivery, and 10 crosses the rows the panel draws instead of the levels they
  // are grouped from — the request states a step and a row count, the delivery
  // answers in rows. 11 states on each row whether the page the band was read
  // from named every price it could hold, and drops the reading of that boundary
  // nothing was left asking. A renderer and a desk that disagree about that shape would
  // refuse every frame by exact keys, so they refuse each other on the version
  // instead — once, legibly.
  it('uses protocol revision 11 for rows that say which of them are whole', () => {
    expect(FUTURES_WORKSTATION_PROTOCOL_VERSION).toBe('11')
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

  // How the panel reads the book: the step its rows are grouped by and how many
  // of them it draws. Both, because the backend needs both — it groups the book
  // by the step and bounds the delivery by the count — and derives from the two
  // together how far past the best price the rows reach, which is what picks the
  // page of the book to buy.
  it('round-trips a bounded depth reading without market authority', () => {
    const request = createFuturesProductionWorkstationConfigureDepthRequest({
      requestId: requestValues.requestId,
      step: '0.000001',
      rows: 14,
    })

    expect(request).toEqual(expect.objectContaining({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.CONFIGURE_DEPTH,
      step: '0.000001',
      rows: 14,
    }))
    expect(request).not.toHaveProperty('symbol')
    expect(request).not.toHaveProperty('interval')
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
    expect(Object.isFrozen(request)).toBe(true)
  })

  it.each([
    ['a negative step', { step: '-1', rows: 14 }],
    ['a non-finite step', { step: 'Infinity', rows: 14 }],
    ['a non-canonical step', { step: '01', rows: 14 }],
    ['a zero step', { step: '0', rows: 14 }],
    ['a step that is not a string or null', { step: 14, rows: 14 }],
    ['a step longer than the bound', { step: `0.${'0'.repeat(64)}1`, rows: 14 }],
    ['no row count', { step: '0.000001' }],
    ['a fractional row count', { step: '0.000001', rows: 1.5 }],
    ['a row count of zero', { step: '0.000001', rows: 0 }],
    ['a negative row count', { step: '0.000001', rows: -14 }],
    ['a row count past the ceiling', { step: '0.000001', rows: 65 }],
  ])('rejects %s in a bounded depth reading', (_label, reading) => {
    expect(() => createFuturesProductionWorkstationConfigureDepthRequest({
      requestId: requestValues.requestId,
      ...reading,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_DEPTH_CONFIGURATION' }))
  })

  // The ungrouped reading. A null step is a reading like any other — one row is
  // one level, as the exchange sent it — and must not be mistaken for a request
  // that states nothing.
  it('round-trips the ungrouped reading', () => {
    const request = createFuturesProductionWorkstationConfigureDepthRequest({
      requestId: requestValues.requestId,
      step: null,
      rows: 14,
    })
    expect(request.step).toBeNull()
    expect(request.rows).toBe(14)
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
  })

  // The snapshot that opens a contract is bought before a second message could
  // arrive, so a reading stated in a message of its own is stated too late to
  // buy the page it asks for. It travels with the request instead — and is read
  // by the same rule, because a reading the desk would accept from one message
  // and refuse from another is a reading whose meaning depends on how it arrived.
  it('opens a contract at the reading its rows need', () => {
    const request = createFuturesProductionWorkstationSubscribeRequest({
      ...requestValues,
      step: '0.0005',
      rows: 44,
    })
    expect(request).toEqual(expect.objectContaining({
      action: FUTURES_PRODUCTION_WORKSTATION_ACTIONS.SUBSCRIBE,
      symbol: requestValues.symbol,
      step: '0.0005',
      rows: 44,
    }))
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
  })

  // Nothing has been drawn for the first contract of a session. Such a request
  // states no reading rather than inventing one, and opens at the cheapest page.
  it('opens a contract that states no reading', () => {
    const request = createFuturesProductionWorkstationSubscribeRequest(requestValues)
    expect(request).not.toHaveProperty('step')
    expect(request).not.toHaveProperty('rows')
    expect(readFuturesProductionWorkstationRequest(JSON.stringify(request))).toEqual(request)
  })

  it.each([
    ['a negative step', { step: '-1', rows: 14 }],
    ['a non-canonical step', { step: '01', rows: 14 }],
    ['a step that is not a string or null', { step: 14, rows: 14 }],
    ['a step longer than the bound', { step: `0.${'0'.repeat(64)}1`, rows: 14 }],
    ['a row count past the ceiling', { step: '0.0005', rows: 65 }],
    ['a fractional row count', { step: '0.0005', rows: 1.5 }],
  ])('rejects %s on the request that opens a contract', (_label, reading) => {
    expect(() => createFuturesProductionWorkstationSubscribeRequest({
      ...requestValues,
      ...reading,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST_SHAPE' }))
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

  // A duplicate key is no longer a refusal of its own: the platform's parser
  // keeps the last value and that is the one the rules are applied to. Stated as
  // a test rather than left to be discovered, because it is a refusal the desk
  // used to make and does not.
  it('validates the last of a duplicated key rather than refusing the frame', () => {
    const duplicate = second => JSON.stringify(
      createFuturesProductionWorkstationSubscribeRequest(requestValues),
    ).replace('"symbol":"BTCUSDT"', `"symbol":"BTCUSDT","symbol":"${second}"`)

    expect(readFuturesProductionWorkstationRequest(duplicate('ETHUSDT')).symbol).toBe('ETHUSDT')
    // Which means the value that stands is the value that must pass.
    expect(() => readFuturesProductionWorkstationRequest(duplicate('btcusdt')))
      .toThrow(FuturesWorkstationProtocolError)
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

  // The ceiling is the desk's own code and it is what stands between an
  // unbounded frame and a parse, so it is measured against what a UTF-8 encoder
  // says rather than against a character count.
  it.each([
    'plain',
    'кириллица',
    '☃ snowman',
    '𝄞 clef',
    'quote \\" and backslash \\\\',
    'escaped \\u0416 codepoint',
    'tab\\tnewline\\n',
  ])('measures the ceiling for %s in bytes, not characters', (encoded) => {
    const raw = `{"value":"${encoded}"}`
    const bytes = new TextEncoder().encode(raw).byteLength

    expect(parseBoundedFuturesWorkstationJson(raw, { maxBytes: bytes }).value)
      .toBe(JSON.parse(raw).value)
    expect(() => parseBoundedFuturesWorkstationJson(raw, { maxBytes: bytes - 1 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  it('refuses a frame it cannot read at all', () => {
    for (const raw of ['{"a":1}x', '{"a":01}', '{', 'not json', '']) {
      expect(() => parseBoundedFuturesWorkstationJson(raw, { maxBytes: 100 }))
        .toThrowError(expect.objectContaining({ code: 'INVALID_JSON' }))
    }
    expect(() => parseBoundedFuturesWorkstationJson(null, { maxBytes: 100 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_JSON_ENCODING' }))
  })

  // Half a surrogate pair used to be refused by the parser, over the whole
  // frame. It is refused where it can still survive: the three fields whose rule
  // is a length and nothing else. Everywhere else a pattern spells the value,
  // and no pattern here can spell half a pair.
  it('refuses a lone surrogate in the exchange words a contract carries', () => {
    for (const field of ['contractType', 'status']) {
      expect(() => createFuturesProductionWorkstationEvent({
        ...createEventValues('catalog'),
        payload: {
          ...payloads.catalog,
          contracts: [{ ...payloads.catalog.contracts[0], [field]: 'PERPETUAL\ud83d' }],
        },
      })).toThrow(FuturesWorkstationProtocolError)
    }
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('header'),
      payload: { ...payloads.header, contractStatus: 'TRADING\ud83d' },
    })).toThrow(FuturesWorkstationProtocolError)
  })

  // A number that is not the integer a field calls for is still refused — by the
  // rules rather than by the reading. What is no longer refused is *notation*:
  // an integer written as an exponent, and one past what a JavaScript number
  // holds exactly, which is rounded to one. Both are stated here so the change
  // is weighed rather than found later. Exact wide integers are read by the
  // upstream parser, which keeps its own reading for that reason.
  it('refuses a number that is not the integer the rules call for', () => {
    expect(() => createFuturesProductionWorkstationEvent({
      ...createEventValues('status'),
      revision: 1.5,
    })).toThrow(FuturesWorkstationProtocolError)

    const exponent = JSON.stringify(createFuturesProductionWorkstationEvent(
      createEventValues('status'),
    )).replace('"revision":1', '"revision":1e2')
    expect(parseFuturesProductionWorkstationEvent(exponent).revision).toBe(100)
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
  // wire. Its byte bound, its node bound and the row count it is allowed to
  // carry are three separate numbers, and a frame that clears the payload rules
  // but trips either parser bound does not degrade — depth simply stops
  // arriving. So the deepest legal book is parsed here, not reasoned about.
  it('parses the deepest legal depth frame rather than running out of budget', () => {
    // Long decimals throughout, and the longest identities the rules accept:
    // the bound has to hold for the widest book the protocol calls legal, not
    // for the tidy one this contract happens to quote today.
    const row = index => ({
      price: `${900_000 + index}.123456789012345678`,
      quantity: '184467440737.09551615',
      value: '170028355150614447.123456789012345678',
      groupKey: '9'.repeat(64),
      whole: true,
    })
    const event = createFuturesProductionWorkstationEvent({
      ...createEventValues('depth'),
      requestId: 'a'.repeat(96),
      symbol: 'ABCDEFGHIJKLMNOPQRST',
      payload: {
        lastUpdateId: '18446744073709551615',
        step: '0.00001',
        bids: Array.from({ length: FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE },
          (_, index) => row(-index)),
        asks: Array.from({ length: FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE },
          (_, index) => row(index + 1)),
        spread: '0.00001',
        reach: null,
      },
    })
    const raw = JSON.stringify(event)
    expect(new TextEncoder().encode(raw).byteLength)
      .toBeLessThanOrEqual(FUTURES_WORKSTATION_EVENT_MAX_BYTES)
    expect(parseFuturesProductionWorkstationEvent(raw).payload.bids)
      .toHaveLength(FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE)
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

  // A price picked off a surface is confirmed with the age of the reading behind
  // it. `observedAt` cannot supply that age once the surface stops being live:
  // the desk re-emits a resource it marks stale stamped with the moment of the
  // marking, which is younger than the reading by the whole freshness window.
  it('remembers when each resource was last live, separately from when it last spoke', () => {
    const initial = Object.freeze({
      status: 'live',
      symbol: 'BTCUSDT',
      generation: 1,
      revision: 0,
      observedAt: 1_784_000_000_000,
      resources: Object.freeze({
        status: null,
        catalog: null,
        header: null,
        candles: null,
        candleHistory: null,
        depth: null,
        trades: null,
      }),
    })
    const live = createFuturesProductionWorkstationEvent(createEventValues('depth'))
    const afterLive = applyFuturesWorkstationEvent(initial, live)
    expect(afterLive.resources.depth.liveObservedAt).toBe(live.observedAt)

    const marked = createFuturesProductionWorkstationEvent({
      ...createEventValues('depth'),
      revision: 2,
      state: FUTURES_WORKSTATION_STATES.STALE,
      observedAt: live.observedAt + 5_000,
    })
    const afterStale = applyFuturesWorkstationEvent(afterLive, marked)
    expect(afterStale.resources.depth.state).toBe(FUTURES_WORKSTATION_STATES.STALE)
    expect(afterStale.resources.depth.observedAt).toBe(live.observedAt + 5_000)
    expect(afterStale.resources.depth.liveObservedAt).toBe(live.observedAt)

    // A resource that has never been live has no last-live time to state, and a
    // reading with no age says so rather than reading as a fresh one.
    const neverLive = applyFuturesWorkstationEvent(initial, createFuturesProductionWorkstationEvent({
      ...createEventValues('candles'),
      state: FUTURES_WORKSTATION_STATES.STALE,
    }))
    expect(neverLive.resources.candles.liveObservedAt).toBeNull()
  })

  it('carries the last-live time through a connection transition', () => {
    const live = createFuturesProductionWorkstationEvent(createEventValues('depth'))
    const afterLive = applyFuturesWorkstationEvent(Object.freeze({
      status: 'live',
      symbol: 'BTCUSDT',
      generation: 1,
      revision: 0,
      observedAt: 1_784_000_000_000,
      resources: Object.freeze({
        status: null,
        catalog: null,
        header: null,
        candles: null,
        candleHistory: null,
        depth: null,
        trades: null,
      }),
    }), live)
    const dropped = transitionFuturesWorkstationConnectionState(
      afterLive,
      FUTURES_WORKSTATION_STATES.DISCONNECTED,
      'SOCKET_CLOSED',
    )
    expect(dropped.resources.depth.state).toBe(FUTURES_WORKSTATION_STATES.DISCONNECTED)
    expect(dropped.resources.depth.liveObservedAt).toBe(live.observedAt)
  })
})
