export const FUTURES_WORKSTATION_MARKET_TYPE = 'USD_M_FUTURES'
export const FUTURES_WORKSTATION_PROTOCOL_VERSION = '10'
export const FUTURES_WORKSTATION_REQUEST_MAX_BYTES = 1_024
// Sized around the largest frame the desk actually sends — a full depth view.
// The bound exists so a hostile frame can never force an unbounded parse, not to
// keep frames small; 256 KiB is still a bounded, trivially cheap parse, and a
// ceiling that silently truncated the book would be the more dangerous of the two.
export const FUTURES_WORKSTATION_EVENT_MAX_BYTES = 256 * 1_024
export const FUTURES_WORKSTATION_UINT64_MAX = '18446744073709551615'

// The deepest page a single REST read returns, which is the deepest stretch of
// price a snapshot can prove complete. It sizes the read and the diff bound
// below; it is no longer a delivery bound, because a level count was never a
// bound the panel could use.
export const FUTURES_WORKSTATION_DEPTH_LEVELS_PER_SIDE = 1_000

// The most of the book that may ever cross to the renderer: rows, the things the
// panel actually draws, rather than the levels they are grouped from.
//
// A level count is the wrong bound for a grouped book, and it failed in the one
// direction that matters. Fourteen rows at a step of a thousand ticks consume
// however many levels happen to rest inside fourteen thousand ticks — on
// AKEUSDT on 2026-08-14 that was well past the nearest thousand, so the nearest
// thousand crossed, three rows drew, and eleven were blank over a book that had
// levels for every one of them. The feed had run out, not the market.
//
// Rows cannot fail that way: the panel states how many it draws and gets them,
// grouped where the whole book is. Sixty-four is far above any panel a desk can
// show — the operator's runs about fourteen a side — and it exists to bound a
// hostile request rather than to shape an honest one. At four fields a row it
// is a frame of a few KiB against the protocol's 256 KiB, where the level-based
// delivery it replaces ran to 68 KiB to fill those same fourteen rows.
export const FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE = 64

// The node budget an event was read under is gone with the parser that counted
// it. What it protected against was an unbounded parse, and the byte ceiling
// above already bounds that: no frame is read before its bytes are counted, and
// a bounded number of bytes cannot describe an unbounded number of nodes. What
// the frame is then permitted to *contain* was never the budget's job — that is
// the structural validators below, which is where it stays.
//
// The upstream parser keeps its own budget, for its own reason: see
// `FUTURES_WORKSTATION_STREAM_MAX_NODES`.

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

// The step the rows on screen are grouped by, in the contract's own quote
// currency. With the row count beside it, it says both of the things the backend
// needs: how far past the best price the rows reach, which is what a deeper page
// is bought against, and how the book is bucketed, which is what the rows are
// built with.
export const FUTURES_WORKSTATION_DEPTH_STEP_MAX_LENGTH = 64

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

// The three places a value survives validation as free text: the exchange's own
// words for what a contract is and whether it is trading. Every other string the
// rules accept is spelled by a pattern — a decimal, an identity, a symbol, a
// reason code — and none of those patterns can spell half a surrogate pair. Here
// the rule is a length and nothing else, so the scalar check that used to run
// over the whole frame runs over these instead.
const isBoundedFuturesWorkstationText = (value, maxLength) => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= maxLength
  && hasOnlyUnicodeScalars(value)
)

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

// The key a row is matched by: its bucket boundary in the grouper's own fixed
// point. Not an exchange identity — those are bounded by uint64, and a bucket
// key is a price scaled by 1e18, so a five-figure contract's keys run to
// twenty-three digits. Bounded by length alone, which is all it is: an opaque
// string the panel and the book must agree on, compared and never arithmetic.
const isFuturesWorkstationBucketKey = value => (
  typeof value === 'string'
  && value.length <= 64
  && UNSIGNED_INTEGER_PATTERN.test(value)
)

// A reading, wherever it is stated. The panel restates it on the request that
// opens a contract as well as on its own, and one rule reads both — a reading
// the desk would accept from one message and refuse from the other is a reading
// whose meaning depends on how it arrived.
//
// Two numbers, not their product. The product — rows × step, one distance — was
// enough while the backend only bought pages against it, and the step could stay
// the renderer's private business. It cannot now: the book is grouped where the
// book is, and a step cannot be recovered from a distance. The distance is
// derived from these instead, so the page bought and the rows drawn can never
// describe different readings.
//
// A null step is the ungrouped reading: one row is one level, as the exchange
// sent it. It is not the tick — a contract whose quoted prices disagree with its
// own tick filter must still draw level by level, and aligning to the filter
// there would merge two real levels into a price neither rests at.
const isFuturesWorkstationDepthStep = value => (
  value === null || (
    typeof value === 'string'
    && value.length <= FUTURES_WORKSTATION_DEPTH_STEP_MAX_LENGTH
    && NONNEGATIVE_DECIMAL_PATTERN.test(value)
    && Number(value) > 0
  )
)

const isFuturesWorkstationDepthRows = value => (
  Number.isSafeInteger(value)
  && value > 0
  && value <= FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE
)

const statesFuturesWorkstationReading = value => (
  isFuturesWorkstationDepthStep(value.step) && isFuturesWorkstationDepthRows(value.rows)
)

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

/**
 * Reads a frame of the desk's own local protocol.
 *
 * The ceiling is enforced on the bytes, before anything is read, so an
 * unbounded frame is refused without being parsed. What the frame is then
 * permitted to contain is decided by the structural validators below — exact
 * keys, canonical decimals, exchange identities, timestamps, level counts —
 * which is what actually rejects a malformed payload and always was.
 *
 * This used to be a JSON parser written out by hand, a character at a time,
 * preceded by two more full passes over the string. On a real book that was
 * 1.369 ms against the platform's 0.390 — three and a half times — ten times a
 * second, on the path the operator reads the market through.
 *
 * What the hand-written parser refused and this does not, stated so it can be
 * weighed rather than discovered: a duplicate key is no longer a refusal (the
 * last value stands, and it is the one the validators check); an integer
 * written in exponent form is read as the integer it denotes; and an integer
 * past what a JavaScript number holds exactly is rounded to one rather than
 * refused. All three are refusals of *notation*, on a socket that carries the
 * desk's own frames between its own two halves, bound to the loopback and
 * gated by a session token. Notation is not what the validators are for, and
 * exact wide integers — the one place the distinction has teeth — are read by
 * the upstream parser, which keeps its own reading for exactly that reason.
 */
export const parseBoundedFuturesWorkstationJson = (text, { maxBytes }) => {
  if (typeof text !== 'string' || utf8Length(text) > maxBytes) {
    fail('INVALID_JSON_ENCODING')
  }
  try {
    return JSON.parse(text)
  } catch {
    return fail('INVALID_JSON')
  }
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
  && isBoundedFuturesWorkstationText(value.contractType, 32)
  && isBoundedFuturesWorkstationText(value.status, 32)
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
  && isBoundedFuturesWorkstationText(value.contractStatus, 32)
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

// A row is a bucket of the book: the price it prints, how much rests inside it,
// what that is worth, and the key an order is matched against it by.
//
// `value` is carried rather than recomputed because it is the one number that
// cannot be rebuilt from the row: it is the sum of price × quantity over the
// levels the bucket holds, and multiplying the printed boundary by the summed
// quantity is a different, wrong number — every level inside the bucket rests
// somewhere other than its edge. `groupKey` is carried for the same reason in
// the other direction: a grouped row prints a boundary, so an order resting
// inside the bucket would never match the printed price.
//
// No running total: a cumulative column is a fact about the rows on screen, and
// which of them are on screen is the panel's business. It is built there.
const validateDepthRow = (value) => (
  hasExactFuturesWorkstationKeys(value, ['price', 'quantity', 'value', 'groupKey'])
  && [value.price, value.quantity, value.value].every(isCanonicalFuturesDecimal)
  && isFuturesWorkstationBucketKey(value.groupKey)
)

// reach: how far the book on hand reaches past the best price on each side, or
// null while a deeper page can still be bought. It is where the book ends, which
// is not where the rows end and cannot be worked out from them: the delivery is
// the rows the panel asked for, so a panel measuring what it was sent would only
// ever measure its own step back.
const validateDepthReach = (value) => (
  value === null || (
    hasExactFuturesWorkstationKeys(value, ['below', 'above'])
    && [value.below, value.above].every(isCanonicalFuturesDecimal)
  )
)

const validateDepth = (value) => (
  hasExactFuturesWorkstationKeys(value, [
    'lastUpdateId',
    // The step the rows were grouped by, or null for the ungrouped reading. The
    // panel needs it to key its own working orders against the rows it was sent
    // rather than against the reading it last asked for.
    'step',
    'bids',
    'asks',
    'spread',
    'reach',
    // How far the book is accounted for, inside the reach above. Rows beyond it
    // hold what the stream has restated and may understate what rests there;
    // rows inside it are complete. Null when no page has proved anything yet, or
    // when the market has traded clean out of the one that did.
    'proven',
  ])
  && validateDepthReach(value.reach)
  && validateDepthReach(value.proven)
  && (value.step === null || isCanonicalFuturesDecimal(value.step))
  && isCanonicalFuturesIdentity(value.lastUpdateId)
  && Array.isArray(value.bids)
  && Array.isArray(value.asks)
  && value.bids.length <= FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE
  && value.asks.length <= FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE
  && value.bids.every(validateDepthRow)
  && value.asks.every(validateDepthRow)
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

  // How the panel reads the book: the step its rows are grouped by and how many
  // of them it draws. Both, always — the backend groups the book with the first
  // and bounds the delivery by the second, and derives the distance to buy pages
  // against from the two together.
  if (value.action === actions.CONFIGURE_DEPTH) {
    if (!hasExactFuturesWorkstationKeys(value, [
      'channelId',
      'version',
      'marketType',
      'environment',
      'action',
      'requestId',
      'step',
      'rows',
    ])
      || !statesFuturesWorkstationReading(value)) {
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

  // A contract is selected with the reading its rows need, when the panel
  // already has one for it: the page that covers that reading is then bought
  // against the first band the snapshot proves, rather than after a second
  // message that arrives once the book is already open and short. The key is
  // optional because the first contract of a session is selected before any
  // book has been drawn — such a request opens at the cheapest page, as every
  // request did before.
  const selectionKeys = [
    'channelId',
    'version',
    'marketType',
    'environment',
    'action',
    'requestId',
    'symbol',
    'interval',
  ]
  const statesReading = hasExactFuturesWorkstationKeys(value, [...selectionKeys, 'step', 'rows'])
  if ((!statesReading && !hasExactFuturesWorkstationKeys(value, selectionKeys))
    || !isFuturesWorkstationSymbol(value.symbol)
    || !isFuturesWorkstationInterval(value.interval)
    || (statesReading && !statesFuturesWorkstationReading(value))) {
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
  step,
  rows,
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
          ? { step, rows }
          : action === actions.LOAD_CANDLE_HISTORY
            ? { symbol, interval, endTime, limit }
            // The reading is carried only when there is one to carry: a request
            // that states no reading is the request that opened every contract
            // before this, and it still opens one at the cheapest page. The step
            // is carried even when it is null — null is a reading, not the
            // absence of one — so the row count is what decides.
            : {
              symbol,
              interval,
              ...(rows === undefined ? {} : { step: step ?? null, rows }),
            }),
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

// When this resource was last live, carried forward across every state that is
// not. A resource the freshness monitor marks stale is re-emitted with the time
// of the *marking*, not the time its data arrived, so `observedAt` alone dates
// the desk's own bookkeeping and is younger than the reading by the whole
// freshness window. A price picked off a surface is confirmed with the age of
// the last reading the desk could vouch for, and understating that age is the
// one direction that costs the operator money.
const carryLiveObservedAt = (previous, event) => (
  event.state === FUTURES_WORKSTATION_STATES.LIVE
    ? event.observedAt
    : previous?.liveObservedAt ?? null
)

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
      liveObservedAt: carryLiveObservedAt(previous, event),
    })
  } else {
    nextResources[event.resource] = Object.freeze({
      ...event.payload,
      state: event.state,
      observedAt: event.observedAt,
      liveObservedAt: carryLiveObservedAt(baseResources[event.resource], event),
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
