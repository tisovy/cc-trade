export const FUTURES_WORKSTATION_MARKET_TYPE = 'USD_M_FUTURES'
export const FUTURES_WORKSTATION_PROTOCOL_VERSION = '7'
export const FUTURES_WORKSTATION_REQUEST_MAX_BYTES = 1_024
// Sized around the largest frame the desk actually sends — a full depth view.
// The bound exists so a hostile frame can never force an unbounded parse, not to
// keep frames small; 256 KiB is still a bounded, trivially cheap parse, and a
// ceiling that silently truncated the book would be the more dangerous of the two.
export const FUTURES_WORKSTATION_EVENT_MAX_BYTES = 256 * 1_024
export const FUTURES_WORKSTATION_UINT64_MAX = '18446744073709551615'

// The most of the book that may ever cross to the renderer. This is a count of
// *raw* exchange levels, but the book is displayed *grouped*: 14 rows at a 50×
// step consume 700 levels. Sizing this below rows × step makes the book look
// empty far from the mid — the feed ran out, not the market. It is pinned to the
// thousand levels per side Binance serves, which is the deepest book that can
// be delivered complete rather than guessed at.
//
// It is a ceiling, not the delivery: what actually crosses is bounded by the
// range the panel stated it reads. See `FUTURES_WORKSTATION_DEPTH_RANGE_MAX_LENGTH`
// below and `toRendererView`.
export const FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE = 1_000

// The fewest levels a delivery carries, whatever range was stated.
//
// Ungrouped, a row is one raw level, so the panel needs one level per row and
// the price distance they span is whatever the market happens to rest at — a
// contract quoting a tick of 0.000001 with levels every tenth of a percent puts
// fourteen rows far outside fourteen ticks. The stated range is rows × step,
// which assumes a level on every step, so on a sparse book it names a distance
// the rows overflow. This is the panel's own row cap, so a delivery is never
// shorter than the rows it can draw, and it costs a fifth of the ceiling.
export const FUTURES_WORKSTATION_DEPTH_MIN_LEVELS_PER_SIDE = 200

// A full depth frame is the node-densest event the desk sends: every level is
// an object plus three strings. Deriving the parser's node budget from the level
// count keeps it from being the bound that silently kills the book — a frame the
// payload rules accept but the parser refuses is a feed that simply stops.
export const FUTURES_WORKSTATION_EVENT_MAX_NODES = (
  (FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE * 2 * 4) + 256
)

// A diff is not a snapshot, and bounding it like one is what took the desk off
// the market at every sharp move.
//
// `<symbol>@depth@100ms` carries every level that *changed* in the last hundred
// milliseconds. That is unrelated to the thousand levels per side Binance serves
// in a snapshot: a sweep that lifts a book and the makers re-posting behind it
// restate far more levels than the book is deep. The desk applied the snapshot's
// bound to the diff, and a frame past it was refused — which resynchronized the
// whole workspace, at the one moment the operator needed depth, tape, header and
// candles most.
//
// Four times the snapshot depth per side is chosen for what it costs rather than
// for what has been observed: a refused frame costs the market, a frame carried
// costs a bounded number of bytes.
export const FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE = (
  FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE * 4
)

// The frame bounds follow the diff, not the book, for the same reason the node
// budget above follows the level count: a frame the payload rules accept but the
// parser refuses is a feed that simply stops. A level is a two-element array of
// decimal strings, and sixty-four bytes is more than any USDⓈ-M price and
// quantity pair reaches, with the envelope allowed for separately.
export const FUTURES_WORKSTATION_STREAM_FRAME_BYTES = (
  (FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE * 2 * 64) + (4 * 1024)
)

export const FUTURES_WORKSTATION_STREAM_MAX_NODES = (
  (FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE * 2 * 4) + 256
)

export const FUTURES_WORKSTATION_TAPE_LIMITS = Object.freeze({
  MIN_TIMEOUT_MS: 16,
  MAX_TIMEOUT_MS: 5_000,
})

export const FUTURES_WORKSTATION_DEFAULT_TAPE_SETTINGS = Object.freeze({
  throttleEnabled: true,
  timeoutMs: 250,
  minNotionalUsdt: '0',
})

// How far past the best price the rows on screen reach: how many of them, times
// the step they are grouped by. The desk buys the book one page deeper when the
// snapshot it holds does not prove that far — a book bought deeper than it is
// read costs ten times the weight of one read at the finest step.
export const FUTURES_WORKSTATION_DEPTH_RANGE_MAX_LENGTH = 64

// One request reads at most this many candles behind the live window. Binance
// serves 1500 per call; 1000 keeps the read at weight 5 and the response inside
// the transport's body bound, and deeper history is simply more requests.
export const FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS = Object.freeze({
  MAX_ROWS: 1_000,
  DEFAULT_ROWS: 1_000,
})

export const FUTURES_WORKSTATION_INTERVALS = Object.freeze([
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
])

export const FUTURES_WORKSTATION_RESOURCES = Object.freeze({
  STATUS: 'status',
  CATALOG: 'catalog',
  HEADER: 'header',
  CANDLES: 'candles',
  CANDLE_HISTORY: 'candleHistory',
  DEPTH: 'depth',
  TRADES: 'trades',
})

export const FUTURES_WORKSTATION_STATES = Object.freeze({
  LOADING: 'loading',
  LIVE: 'live',
  STALE: 'stale',
  DISCONNECTED: 'disconnected',
  RESYNCHRONIZING: 'resynchronizing',
  UNAVAILABLE: 'unavailable',
})

const RESOURCE_VALUES = new Set(Object.values(FUTURES_WORKSTATION_RESOURCES))
const STATE_VALUES = new Set(Object.values(FUTURES_WORKSTATION_STATES))
const INTERVAL_VALUES = new Set(FUTURES_WORKSTATION_INTERVALS)
const EXCHANGE_IDENTITY_MAX_BYTES = 64
const UTF8_ENCODER = new TextEncoder()
const JSON_WHITESPACE = new Set([' ', '\n', '\r', '\t'])
const JSON_STRING_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])
const EXCHANGE_IDENTITY_CHARACTERS = '[\\p{Lu}\\p{Lt}\\p{Lo}\\p{N}]'
const SYMBOL_PATTERN = new RegExp(
  `^(?:${EXCHANGE_IDENTITY_CHARACTERS}{1,20}|${EXCHANGE_IDENTITY_CHARACTERS}{1,13}_[0-9]{6})$`,
  'u',
)
const PAIR_PATTERN = new RegExp(`^${EXCHANGE_IDENTITY_CHARACTERS}{1,20}$`, 'u')
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/
const UNSIGNED_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/
const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const NONNEGATIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const NON_LIVE_RESOURCE_STATES = new Set([
  FUTURES_WORKSTATION_STATES.DISCONNECTED,
  FUTURES_WORKSTATION_STATES.RESYNCHRONIZING,
  FUTURES_WORKSTATION_STATES.UNAVAILABLE,
])

export class FuturesWorkstationProtocolError extends Error {
  constructor(code) {
    super('Futures workstation protocol value was rejected')
    this.name = 'FuturesWorkstationProtocolError'
    this.code = code
  }
}

const fail = (code) => {
  throw new FuturesWorkstationProtocolError(code)
}

export const isFuturesWorkstationRecord = value => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
)

export const hasExactFuturesWorkstationKeys = (value, expectedKeys) => {
  if (!isFuturesWorkstationRecord(value)) return false
  const actualKeys = Object.keys(value).sort()
  const sortedExpected = [...expectedKeys].sort()
  return actualKeys.length === sortedExpected.length
    && actualKeys.every((key, index) => key === sortedExpected[index])
}

export const isCanonicalFuturesDecimal = value => (
  typeof value === 'string'
  && value.length <= 64
  && DECIMAL_PATTERN.test(value)
)

export const isCanonicalFuturesIdentity = value => (
  typeof value === 'string'
  && UNSIGNED_INTEGER_PATTERN.test(value)
  && (value.length < FUTURES_WORKSTATION_UINT64_MAX.length
    || (value.length === FUTURES_WORKSTATION_UINT64_MAX.length
      && value <= FUTURES_WORKSTATION_UINT64_MAX))
)

const isBoundedFuturesWorkstationExchangeIdentity = (value, pattern, maximum) => (
  typeof value === 'string'
  && Array.from(value).length <= maximum
  && UTF8_ENCODER.encode(value).byteLength <= EXCHANGE_IDENTITY_MAX_BYTES
  && pattern.test(value)
)

export const isFuturesWorkstationSymbol = value => (
  isBoundedFuturesWorkstationExchangeIdentity(value, SYMBOL_PATTERN, 20)
)

export const isFuturesWorkstationInterval = value => INTERVAL_VALUES.has(value)

const isSafeTimestamp = value => Number.isSafeInteger(value) && value >= 0
const isPositiveSafeInteger = value => Number.isSafeInteger(value) && value > 0
const isReasonCode = value => (
  value === null
  || (typeof value === 'string' && /^[A-Z0-9_]{1,96}$/.test(value))
)

// Measured, not encoded. A full depth frame carries six thousand short strings
// and each one used to be encoded into a throwaway buffer — behind a throwaway
// encoder — purely to learn its length. Counting the bytes is the same number.
// Lone surrogates are counted as if paired; hasOnlyUnicodeScalars rejects them
// on the same expression, so the value never survives the miscount.
const utf8Length = (value) => {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) bytes += 1
    else if (unit < 0x800) bytes += 2
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4
      index += 1
    } else bytes += 3
  }
  return bytes
}

const hasOnlyUnicodeScalars = (value) => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

export const parseBoundedFuturesWorkstationJson = (
  text,
  {
    maxBytes,
    maxDepth = 12,
    maxNodes = 8_192,
    maxStringBytes = 8_192,
  },
) => {
  if (typeof text !== 'string'
    || utf8Length(text) > maxBytes
    || !hasOnlyUnicodeScalars(text)) {
    fail('INVALID_JSON_ENCODING')
  }

  let cursor = 0
  let nodes = 0
  const countNode = () => {
    nodes += 1
    if (nodes > maxNodes) fail('JSON_RESOURCE_LIMIT')
  }
  const skipWhitespace = () => {
    while (JSON_WHITESPACE.has(text[cursor])) cursor += 1
  }
  const parseString = () => {
    if (text[cursor] !== '"') fail('INVALID_JSON')
    const start = cursor
    cursor += 1
    let closed = false
    let escaped = false
    while (cursor < text.length) {
      const character = text[cursor]
      const unit = text.charCodeAt(cursor)
      if (character === '"') {
        cursor += 1
        closed = true
        break
      }
      if (unit < 0x20) fail('INVALID_JSON')
      if (character === '\\') {
        escaped = true
        cursor += 1
        const escape = text[cursor]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(cursor + 1, cursor + 5))) {
            fail('INVALID_JSON')
          }
          cursor += 5
          continue
        }
        if (!JSON_STRING_ESCAPES.has(escape)) {
          fail('INVALID_JSON')
        }
        cursor += 1
        continue
      }
      cursor += 1
    }
    if (!closed) fail('INVALID_JSON')
    let value
    // The loop above already proved the span is a well-formed JSON string, and
    // a span with no escape in it decodes to itself. Prices, sizes and IDs are
    // never escaped, so the whole book takes this exit.
    if (!escaped) {
      value = text.slice(start + 1, cursor - 1)
    } else {
      try {
        value = JSON.parse(text.slice(start, cursor))
      } catch {
        fail('INVALID_JSON')
      }
    }
    if (!hasOnlyUnicodeScalars(value) || utf8Length(value) > maxStringBytes) {
      fail('JSON_RESOURCE_LIMIT')
    }
    return value
  }
  const parseInteger = () => {
    const start = cursor
    if (text[cursor] === '-') cursor += 1
    if (text[cursor] === '0') {
      cursor += 1
      if (/^[0-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON')
    } else {
      if (!/^[1-9]$/.test(text[cursor] ?? '')) fail('INVALID_JSON')
      while (/^[0-9]$/.test(text[cursor] ?? '')) cursor += 1
    }
    if (['.', 'e', 'E'].includes(text[cursor])) fail('INVALID_JSON_NUMBER')
    const value = Number(text.slice(start, cursor))
    if (!Number.isSafeInteger(value)) fail('UNSAFE_JSON_INTEGER')
    return value
  }
  const parseObject = (depth) => {
    cursor += 1
    skipWhitespace()
    const result = Object.create(null)
    const keys = new Set()
    if (text[cursor] === '}') {
      cursor += 1
      return result
    }
    while (cursor < text.length) {
      const key = parseString()
      if (keys.has(key)) fail('DUPLICATE_JSON_KEY')
      keys.add(key)
      skipWhitespace()
      if (text[cursor] !== ':') fail('INVALID_JSON')
      cursor += 1
      result[key] = parseValue(depth)
      skipWhitespace()
      if (text[cursor] === '}') {
        cursor += 1
        return result
      }
      if (text[cursor] !== ',') fail('INVALID_JSON')
      cursor += 1
      skipWhitespace()
    }
    fail('INVALID_JSON')
  }
  const parseArray = (depth) => {
    cursor += 1
    skipWhitespace()
    const result = []
    if (text[cursor] === ']') {
      cursor += 1
      return result
    }
    while (cursor < text.length) {
      result.push(parseValue(depth))
      skipWhitespace()
      if (text[cursor] === ']') {
        cursor += 1
        return result
      }
      if (text[cursor] !== ',') fail('INVALID_JSON')
      cursor += 1
      skipWhitespace()
    }
    fail('INVALID_JSON')
  }
  const parseValue = (depth) => {
    if (depth > maxDepth) fail('JSON_RESOURCE_LIMIT')
    countNode()
    skipWhitespace()
    if (text[cursor] === '"') return parseString()
    if (text[cursor] === '{') return parseObject(depth + 1)
    if (text[cursor] === '[') return parseArray(depth + 1)
    if (text.slice(cursor, cursor + 4) === 'true') {
      cursor += 4
      return true
    }
    if (text.slice(cursor, cursor + 5) === 'false') {
      cursor += 5
      return false
    }
    if (text.slice(cursor, cursor + 4) === 'null') {
      cursor += 4
      return null
    }
    return parseInteger()
  }

  skipWhitespace()
  const result = parseValue(0)
  skipWhitespace()
  if (cursor !== text.length) fail('INVALID_JSON')
  return result
}

export const freezeFuturesWorkstationValue = (value) => {
  if (Array.isArray(value)) {
    value.forEach(freezeFuturesWorkstationValue)
    return Object.freeze(value)
  }
  if (isFuturesWorkstationRecord(value)) {
    Object.values(value).forEach(freezeFuturesWorkstationValue)
    return Object.freeze(value)
  }
  return value
}

const isCanonicalNonnegativeFuturesDecimal = value => (
  typeof value === 'string'
  && value.length <= 64
  && NONNEGATIVE_DECIMAL_PATTERN.test(value)
)

const isCanonicalPositiveFuturesDecimal = value => (
  isCanonicalNonnegativeFuturesDecimal(value)
  && !/^0(?:\.0+)?$/.test(value)
)

const validateRangeFilter = (value, stepKey, allowDisabled) => (
  value === null
  || (hasExactFuturesWorkstationKeys(value, ['min', 'max', stepKey])
    && isCanonicalNonnegativeFuturesDecimal(value.min)
    && (allowDisabled
      ? isCanonicalNonnegativeFuturesDecimal(value.max)
      : isCanonicalPositiveFuturesDecimal(value.max))
    && (allowDisabled
      ? isCanonicalNonnegativeFuturesDecimal(value[stepKey])
      : isCanonicalPositiveFuturesDecimal(value[stepKey])))
)

const validatePercentPriceFilter = value => (
  hasExactFuturesWorkstationKeys(value, [
    'multiplierUp',
    'multiplierDown',
    'multiplierDecimal',
  ])
  && isCanonicalPositiveFuturesDecimal(value.multiplierUp)
  && isCanonicalPositiveFuturesDecimal(value.multiplierDown)
  && Number.isSafeInteger(value.multiplierDecimal)
  && value.multiplierDecimal >= 0
  && value.multiplierDecimal <= 18
)

const validateContract = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'symbol',
    'pair',
    'contractType',
    'status',
    'baseAsset',
    'quoteAsset',
    'marginAsset',
    'tradable',
    'filters',
  ])
  && isFuturesWorkstationSymbol(value.symbol)
  && isBoundedFuturesWorkstationExchangeIdentity(value.pair, PAIR_PATTERN, 20)
  && typeof value.contractType === 'string'
  && value.contractType.length > 0
  && value.contractType.length <= 32
  && typeof value.status === 'string'
  && value.status.length > 0
  && value.status.length <= 32
  && isBoundedFuturesWorkstationExchangeIdentity(value.baseAsset, PAIR_PATTERN, 16)
  && isBoundedFuturesWorkstationExchangeIdentity(value.quoteAsset, PAIR_PATTERN, 16)
  && value.marginAsset === 'USDT'
  && typeof value.tradable === 'boolean'
  && hasExactFuturesWorkstationKeys(value.filters, [
    'price',
    'quantity',
    'marketQuantity',
    'percentPrice',
    'maximumOrders',
    'maximumAlgoOrders',
    'minimumNotional',
  ])
  && validateRangeFilter(value.filters.price, 'tickSize', true)
  && validateRangeFilter(value.filters.quantity, 'stepSize', false)
  && validateRangeFilter(value.filters.marketQuantity, 'stepSize', false)
  && validatePercentPriceFilter(value.filters.percentPrice)
  && Number.isSafeInteger(value.filters.maximumOrders)
  && value.filters.maximumOrders >= 0
  && (value.filters.maximumAlgoOrders === null
    || isPositiveSafeInteger(value.filters.maximumAlgoOrders))
  && isCanonicalNonnegativeFuturesDecimal(value.filters.minimumNotional)
)

const validateCatalog = (value) => (
  hasExactFuturesWorkstationKeys(value, ['offset', 'total', 'complete', 'contracts'])
  && Number.isSafeInteger(value.offset)
  && value.offset >= 0
  && Number.isSafeInteger(value.total)
  && value.total >= 0
  && value.total <= 1_024
  && typeof value.complete === 'boolean'
  && Array.isArray(value.contracts)
  && value.contracts.length <= 8
  && value.contracts.every(validateContract)
)

const validateHeader = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'lastPrice',
    'markPrice',
    'indexPrice',
    'basis',
    'priceChange',
    'priceChangePercent',
    'highPrice',
    'lowPrice',
    'volume',
    'quoteVolume',
    'lastQuantity',
    'fundingRate',
    'fundingRatePercent',
    'nextFundingTime',
    'eventTime',
    'contractStatus',
  ])
  && [
    value.lastPrice,
    value.markPrice,
    value.indexPrice,
    value.basis,
    value.priceChange,
    value.priceChangePercent,
    value.highPrice,
    value.lowPrice,
    value.volume,
    value.quoteVolume,
    value.lastQuantity,
    value.fundingRate,
    value.fundingRatePercent,
  ].every(isCanonicalFuturesDecimal)
  && isSafeTimestamp(value.nextFundingTime)
  && isSafeTimestamp(value.eventTime)
  && typeof value.contractStatus === 'string'
  && value.contractStatus.length > 0
  && value.contractStatus.length <= 32
)

const validateCandle = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'openTime',
    'closeTime',
    'open',
    'high',
    'low',
    'close',
    'volume',
    'closed',
  ])
  && isSafeTimestamp(value.openTime)
  && isSafeTimestamp(value.closeTime)
  && value.closeTime >= value.openTime
  && [value.open, value.high, value.low, value.close, value.volume]
    .every(isCanonicalFuturesDecimal)
  && typeof value.closed === 'boolean'
)

const validateCandles = (value) => (
  hasExactFuturesWorkstationKeys(value, ['series', 'interval', 'rows'])
  && ['contract', 'index'].includes(value.series)
  && isFuturesWorkstationInterval(value.interval)
  && Array.isArray(value.rows)
  && value.rows.length <= 80
  && value.rows.every(validateCandle)
)

// History is the same candle behind the live window, delivered in pages that
// obey the same per-event bounds as everything else: depth comes from more
// events, never from a bigger one.
const validateCandleHistory = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'series',
    'interval',
    'endTime',
    'offset',
    'total',
    'complete',
    'rows',
  ])
  && value.series === 'contract'
  && isFuturesWorkstationInterval(value.interval)
  && isSafeTimestamp(value.endTime)
  && Number.isSafeInteger(value.offset)
  && value.offset >= 0
  && Number.isSafeInteger(value.total)
  && value.total >= 0
  && value.total <= FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS.MAX_ROWS
  && typeof value.complete === 'boolean'
  && Array.isArray(value.rows)
  && value.rows.length <= 80
  && value.rows.every(validateCandle)
)

// A level is what it rests at and how much rests there. It carries no running
// total: a total accumulated over raw levels is not a total over the grouped
// rows the panel draws, so the panel builds the only cumulative column it can
// display from the notional of the rows it grouped. A second one cost a decimal
// addition per level, a third of every frame's bytes, and a validation pass —
// to be discarded on arrival.
const validateDepthLevel = (value) => (
  hasExactFuturesWorkstationKeys(value, ['price', 'quantity'])
  && [value.price, value.quantity].every(isCanonicalFuturesDecimal)
)

const validateDepth = (value) => (
  hasExactFuturesWorkstationKeys(value, ['lastUpdateId', 'bids', 'asks', 'spread'])
  && isCanonicalFuturesIdentity(value.lastUpdateId)
  && Array.isArray(value.bids)
  && Array.isArray(value.asks)
  && value.bids.length <= FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE
  && value.asks.length <= FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE
  && value.bids.every(validateDepthLevel)
  && value.asks.every(validateDepthLevel)
  && isCanonicalFuturesDecimal(value.spread)
)

const validateTrade = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'aggregateTradeId',
    'price',
    'quantity',
    'normalQuantity',
    'firstTradeId',
    'lastTradeId',
    'tradeTime',
    'buyerMaker',
  ])
  && [value.aggregateTradeId, value.firstTradeId, value.lastTradeId]
    .every(isCanonicalFuturesIdentity)
  && [value.price, value.quantity, value.normalQuantity]
    .every(isCanonicalFuturesDecimal)
  && isSafeTimestamp(value.tradeTime)
  && typeof value.buyerMaker === 'boolean'
)

const validateTrades = (value) => (
  hasExactFuturesWorkstationKeys(value, ['rows'])
  && Array.isArray(value.rows)
  && value.rows.length <= 80
  && value.rows.every(validateTrade)
)

const validateStatus = (value) => (
  hasExactFuturesWorkstationKeys(value, ['connected', 'reasonCode'])
  && typeof value.connected === 'boolean'
  && isReasonCode(value.reasonCode)
)

export const validateFuturesWorkstationPayload = (resource, payload) => {
  if (resource === FUTURES_WORKSTATION_RESOURCES.STATUS) return validateStatus(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.CATALOG) return validateCatalog(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.HEADER) return validateHeader(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) return validateCandles(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.CANDLE_HISTORY) {
    return validateCandleHistory(payload)
  }
  if (resource === FUTURES_WORKSTATION_RESOURCES.DEPTH) return validateDepth(payload)
  if (resource === FUTURES_WORKSTATION_RESOURCES.TRADES) return validateTrades(payload)
  return false
}

export const validateFuturesWorkstationRequest = ({
  value,
  channelId,
  environment,
  actions,
}) => {
  if (!isFuturesWorkstationRecord(value)
    || value.channelId !== channelId
    || value.version !== FUTURES_WORKSTATION_PROTOCOL_VERSION
    || value.marketType !== FUTURES_WORKSTATION_MARKET_TYPE
    || value.environment !== environment
    || !Object.values(actions).includes(value.action)
    || !REQUEST_ID_PATTERN.test(value.requestId ?? '')) {
    fail('INVALID_REQUEST_IDENTITY')
  }

  if (value.action === actions.UNSUBSCRIBE) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId', 'version', 'marketType', 'environment', 'action', 'requestId',
    ])) fail('INVALID_REQUEST_SHAPE')
    return freezeFuturesWorkstationValue(value)
  }

  if (value.action === actions.CONFIGURE_TAPE) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId',
      'version',
      'marketType',
      'environment',
      'action',
      'requestId',
      'throttleEnabled',
      'timeoutMs',
      'minNotionalUsdt',
    ])
      || typeof value.throttleEnabled !== 'boolean'
      || !Number.isSafeInteger(value.timeoutMs)
      || value.timeoutMs < FUTURES_WORKSTATION_TAPE_LIMITS.MIN_TIMEOUT_MS
      || value.timeoutMs > FUTURES_WORKSTATION_TAPE_LIMITS.MAX_TIMEOUT_MS
      || typeof value.minNotionalUsdt !== 'string'
      || value.minNotionalUsdt.length > 64
      || !NONNEGATIVE_DECIMAL_PATTERN.test(value.minNotionalUsdt)) {
      fail('INVALID_TAPE_CONFIGURATION')
    }
    return freezeFuturesWorkstationValue(value)
  }

  // How far past the best price the rows on screen reach. One decimal, in the
  // contract's own quote currency, because the step and the row count are the
  // renderer's to know and their product is all the backend needs.
  if (value.action === actions.CONFIGURE_DEPTH) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId',
      'version',
      'marketType',
      'environment',
      'action',
      'requestId',
      'range',
    ])
      || typeof value.range !== 'string'
      || value.range.length > FUTURES_WORKSTATION_DEPTH_RANGE_MAX_LENGTH
      || !NONNEGATIVE_DECIMAL_PATTERN.test(value.range)) {
      fail('INVALID_DEPTH_CONFIGURATION')
    }
    return freezeFuturesWorkstationValue(value)
  }

  // Reading behind the live window is bounded on both sides: a point in time to
  // read back from, and how many candles that one read may return.
  if (value.action === actions.LOAD_CANDLE_HISTORY) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId',
      'version',
      'marketType',
      'environment',
      'action',
      'requestId',
      'symbol',
      'interval',
      'endTime',
      'limit',
    ])
      || !isFuturesWorkstationSymbol(value.symbol)
      || !isFuturesWorkstationInterval(value.interval)
      || !isPositiveSafeInteger(value.endTime)
      || !isPositiveSafeInteger(value.limit)
      || value.limit > FUTURES_WORKSTATION_CANDLE_HISTORY_LIMITS.MAX_ROWS) {
      fail('INVALID_CANDLE_HISTORY_REQUEST')
    }
    return freezeFuturesWorkstationValue(value)
  }

  if (!hasExactFuturesWorkstationKeys(value, [
    'channelId',
    'version',
    'marketType',
    'environment',
    'action',
    'requestId',
    'symbol',
    'interval',
  ])
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isFuturesWorkstationInterval(value.interval)) {
    fail('INVALID_REQUEST_SHAPE')
  }
  return freezeFuturesWorkstationValue(value)
}

export const validateFuturesWorkstationEvent = ({
  value,
  channelId,
  environment,
  eventType,
}) => {
  if (!hasExactFuturesWorkstationKeys(value, [
    'channelId',
    'version',
    'marketType',
    'environment',
    'type',
    'requestId',
    'symbol',
    'generation',
    'revision',
    'resource',
    'state',
    'observedAt',
    'payload',
  ])
    || value.channelId !== channelId
    || value.version !== FUTURES_WORKSTATION_PROTOCOL_VERSION
    || value.marketType !== FUTURES_WORKSTATION_MARKET_TYPE
    || value.environment !== environment
    || value.type !== eventType
    || !REQUEST_ID_PATTERN.test(value.requestId ?? '')
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isPositiveSafeInteger(value.generation)
    || !isPositiveSafeInteger(value.revision)
    || !RESOURCE_VALUES.has(value.resource)
    || !STATE_VALUES.has(value.state)
    || !isSafeTimestamp(value.observedAt)
    || !validateFuturesWorkstationPayload(value.resource, value.payload)) {
    fail('INVALID_EVENT')
  }
  return freezeFuturesWorkstationValue(value)
}

export const createFuturesWorkstationRequest = ({
  channelId,
  environment,
  action,
  requestId,
  symbol,
  interval,
  endTime,
  limit,
  throttleEnabled,
  timeoutMs,
  minNotionalUsdt,
  range,
  actions,
}) => validateFuturesWorkstationRequest({
  value: {
    channelId,
    version: FUTURES_WORKSTATION_PROTOCOL_VERSION,
    marketType: FUTURES_WORKSTATION_MARKET_TYPE,
    environment,
    action,
    requestId,
    ...(action === actions.UNSUBSCRIBE
      ? {}
      : action === actions.CONFIGURE_TAPE
        ? { throttleEnabled, timeoutMs, minNotionalUsdt }
        : action === actions.CONFIGURE_DEPTH
          ? { range }
          : action === actions.LOAD_CANDLE_HISTORY
            ? { symbol, interval, endTime, limit }
            : { symbol, interval }),
  },
  channelId,
  environment,
  actions,
})

export const createFuturesWorkstationEvent = ({
  channelId,
  environment,
  eventType,
  requestId,
  symbol,
  generation,
  revision,
  resource,
  state,
  observedAt,
  payload,
}) => validateFuturesWorkstationEvent({
  value: {
    channelId,
    version: FUTURES_WORKSTATION_PROTOCOL_VERSION,
    marketType: FUTURES_WORKSTATION_MARKET_TYPE,
    environment,
    type: eventType,
    requestId,
    symbol,
    generation,
    revision,
    resource,
    state,
    observedAt,
    payload,
  },
  channelId,
  environment,
  eventType,
})

const createEmptyFuturesWorkstationResources = () => ({
  status: null,
  catalog: null,
  header: null,
  candles: null,
  candleHistory: null,
  depth: null,
  trades: null,
})

const transitionFuturesWorkstationResources = (resources, nextState, observedAt) => (
  Object.freeze(Object.fromEntries(
    Object.entries(resources).map(([resource, value]) => [
      resource,
      value === null
        ? null
        : Object.freeze({
          ...value,
          state: nextState,
          ...(observedAt === undefined ? {} : { observedAt }),
        }),
    ]),
  ))
)

export const transitionFuturesWorkstationConnectionState = (state, status, reasonCode) => {
  if (![FUTURES_WORKSTATION_STATES.DISCONNECTED, FUTURES_WORKSTATION_STATES.UNAVAILABLE]
    .includes(status)
    || !isReasonCode(reasonCode)) {
    fail('INVALID_CONNECTION_TRANSITION')
  }
  const resources = transitionFuturesWorkstationResources(state.resources, status)
  return Object.freeze({
    ...state,
    status,
    reasonCode,
    resources: Object.freeze({
      ...resources,
      status: Object.freeze({
        connected: false,
        reasonCode,
        state: status,
        observedAt: state.observedAt,
      }),
    }),
  })
}

export const applyFuturesWorkstationEvent = (state, event) => {
  const generationChanged = event.generation > state.generation
  const generationResources = generationChanged
    ? createEmptyFuturesWorkstationResources()
    : state.resources
  const baseResources = event.resource === FUTURES_WORKSTATION_RESOURCES.STATUS
    && NON_LIVE_RESOURCE_STATES.has(event.state)
    ? transitionFuturesWorkstationResources(
      generationResources,
      event.state,
      event.observedAt,
    )
    : generationResources
  const nextResources = { ...baseResources }
  if (event.resource === FUTURES_WORKSTATION_RESOURCES.CATALOG) {
    const previousContracts = event.payload.offset === 0
      ? []
      : (baseResources.catalog?.contracts ?? [])
    nextResources.catalog = Object.freeze({
      ...event.payload,
      contracts: Object.freeze([...previousContracts, ...event.payload.contracts]),
      state: event.state,
      observedAt: event.observedAt,
    })
  } else if (event.resource === FUTURES_WORKSTATION_RESOURCES.CANDLE_HISTORY) {
    // One response, many pages: the rows accumulate until it completes, and a
    // fresh response (offset 0) starts over rather than appending to the last.
    const previousRows = event.payload.offset === 0
      ? []
      : (baseResources.candleHistory?.rows ?? [])
    nextResources.candleHistory = Object.freeze({
      ...event.payload,
      rows: Object.freeze([...previousRows, ...event.payload.rows]),
      state: event.state,
      observedAt: event.observedAt,
    })
  } else if (event.resource === FUTURES_WORKSTATION_RESOURCES.CANDLES) {
    const previous = baseResources.candles ?? Object.freeze({
      interval: event.payload.interval,
      contract: Object.freeze([]),
      index: Object.freeze([]),
    })
    nextResources.candles = Object.freeze({
      ...previous,
      interval: event.payload.interval,
      [event.payload.series]: event.payload.rows,
      state: event.state,
      observedAt: event.observedAt,
    })
  } else {
    nextResources[event.resource] = Object.freeze({
      ...event.payload,
      state: event.state,
      observedAt: event.observedAt,
    })
  }

  const statusState = event.resource === FUTURES_WORKSTATION_RESOURCES.STATUS
    ? event.state
    : generationChanged
      ? FUTURES_WORKSTATION_STATES.LOADING
      : state.status
  return Object.freeze({
    ...state,
    status: statusState,
    symbol: event.symbol,
    generation: event.generation,
    revision: event.revision,
    observedAt: event.observedAt,
    resources: Object.freeze(nextResources),
  })
}
