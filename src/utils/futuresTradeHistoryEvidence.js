// Dependency-free admission contract for `/fapi/v1/userTrades` evidence.
// Electron validates fresh endpoint pages with it; the renderer-side history
// store validates persisted v2 rows with the same rules before trusting their
// cursor or coverage. Keep this module free of transport, storage, and UI
// dependencies so those boundaries cannot drift apart.

const FUTURES_TRADE_EVIDENCE_LIMITS = Object.freeze({
  IDENTITY: 20,
  SYMBOL: 32,
  ASSET: 32,
  DECIMAL_TEXT: 256,
  DECIMAL_DIGITS: 128,
  DECIMAL_SCALE: 64,
  TIME_TEXT: 16,
})
const FUTURES_TRADE_SIDES = new Set(['BUY', 'SELL'])
const FUTURES_TRADE_POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT'])

const canonicalIdentity = (value) => {
  if (typeof value === 'string') {
    return value.length > 0
      && value.length <= FUTURES_TRADE_EVIDENCE_LIMITS.IDENTITY
      && /^\d+$/.test(value)
      ? value
      : null
  }
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : null
}

const canonicalUpperText = (value, maximum, pattern) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return null
  const normalized = value.trim().toUpperCase()
  return normalized !== '' && pattern.test(normalized) ? normalized : null
}

// The exchange's identity alphabet — uppercase, titlecase and caseless
// letters and numbers, with the delivery-dated underscore — because the
// account provably holds trades on unicode listings (龙虾USDT) that the
// desk's own, deliberately ASCII, execution path will never place. Reading
// is not executing: refusing the symbol here refused the operator's own
// history (2026-08-28) while still spelling amounts impossible.
export const normalizeFuturesTradeHistorySymbol = value => canonicalUpperText(
  value,
  FUTURES_TRADE_EVIDENCE_LIMITS.SYMBOL,
  /^[\p{Lu}\p{Lt}\p{Lo}\p{N}_]+$/u,
)

const canonicalAsset = value => canonicalUpperText(
  value,
  FUTURES_TRADE_EVIDENCE_LIMITS.ASSET,
  /^[A-Z0-9]+$/,
)

// Shared with the renderer-side round fold as a defense-in-depth money
// boundary. REST/store admission should already have applied this domain, but
// a streamed or future internal caller must not be able to invent an unbounded
// denomination after supplying optimistic coverage metadata.
export const normalizeFuturesTradeHistoryAsset = value => canonicalAsset(value)

const canonicalEnum = (value, values) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16) return null
  const normalized = value.trim().toUpperCase()
  return values.has(normalized) ? normalized : null
}

const decimalEvidence = (value, { unsigned = false } = {}) => {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > FUTURES_TRADE_EVIDENCE_LIMITS.DECIMAL_TEXT) return null
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (match === null || (unsigned && match[1] === '-')) return null
  const fraction = match[3] ?? ''
  if (match[2].length + fraction.length > FUTURES_TRADE_EVIDENCE_LIMITS.DECIMAL_DIGITS
    || fraction.length > FUTURES_TRADE_EVIDENCE_LIMITS.DECIMAL_SCALE) return null
  return Object.freeze({
    text: value,
    zero: /^0(?:\.0+)?$/.test(value),
  })
}

export const normalizeFuturesTradeHistoryTime = (value) => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > FUTURES_TRADE_EVIDENCE_LIMITS.TIME_TEXT
    || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export const normalizeFuturesTradeHistoryEvidence = (trade = {}) => {
  const price = decimalEvidence(trade?.price, { unsigned: true })
  // `/userTrades` calls this field `qty`. Do not let an unexpected auxiliary
  // `quantity` property hide a missing/malformed endpoint field; canonical
  // persisted rows are validated below and never pass through this projector.
  const quantity = decimalEvidence(trade?.qty, { unsigned: true })
  const quoteQty = trade?.quoteQty === null || trade?.quoteQty === undefined
    ? null
    : decimalEvidence(trade.quoteQty, { unsigned: true })
  const realizedPnl = decimalEvidence(trade?.realizedPnl)
  const commission = decimalEvidence(trade?.commission, { unsigned: true })
  return Object.freeze({
    // REST parsing quotes identifiers before JSON.parse. Refuse numeric input:
    // even a currently-safe double is not proof that the endpoint token was
    // preserved exactly.
    id: typeof trade?.id === 'string' ? canonicalIdentity(trade.id) : null,
    orderId: typeof trade?.orderId === 'string' ? canonicalIdentity(trade.orderId) : null,
    symbol: normalizeFuturesTradeHistorySymbol(trade?.symbol),
    side: canonicalEnum(trade?.side, FUTURES_TRADE_SIDES),
    positionSide: canonicalEnum(trade?.positionSide, FUTURES_TRADE_POSITION_SIDES),
    price: price?.text ?? null,
    quantity: quantity?.text ?? null,
    quoteQty: quoteQty?.text ?? null,
    realizedPnl: realizedPnl?.text ?? null,
    commission: commission?.text ?? null,
    commissionAsset: canonicalAsset(trade?.commissionAsset),
    marginAsset: canonicalAsset(trade?.marginAsset),
    maker: trade?.maker === true,
    time: normalizeFuturesTradeHistoryTime(trade?.time),
  })
}

const tradeEvidenceFailure = (code, message) => Object.freeze({ code, message })

export const futuresTradeHistoryEvidenceError = (trade, {
  expectedSymbol = null,
  startTime = null,
  endTime = null,
} = {}) => {
  if (trade === null || typeof trade !== 'object' || Array.isArray(trade)) {
    return tradeEvidenceFailure('INVALID_TRADE_EVIDENCE', 'Trade-history row must be an object')
  }
  if (typeof trade.id !== 'string'
    || canonicalIdentity(trade.id) !== trade.id
    || typeof trade.orderId !== 'string'
    || canonicalIdentity(trade.orderId) !== trade.orderId) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_IDENTITY',
      'Trade-history row must carry exact trade and order identities',
    )
  }
  const symbol = normalizeFuturesTradeHistorySymbol(trade.symbol)
  if (symbol === null || symbol !== trade.symbol) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_EVIDENCE',
      'Trade-history row must carry one canonical contract symbol',
    )
  }
  const wanted = expectedSymbol === null
    ? null
    : normalizeFuturesTradeHistorySymbol(expectedSymbol)
  if (expectedSymbol !== null && wanted === null) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_EVIDENCE',
      'Trade-history boundary must name one canonical expected contract',
    )
  }
  if (wanted !== null && symbol !== wanted) {
    return tradeEvidenceFailure(
      'FOREIGN_TRADE_SYMBOL',
      'Trade-history page contains a row for another contract',
    )
  }
  if (!FUTURES_TRADE_SIDES.has(trade.side)
    || !FUTURES_TRADE_POSITION_SIDES.has(trade.positionSide)) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_EVIDENCE',
      'Trade-history row must carry canonical side and position-side evidence',
    )
  }
  const price = decimalEvidence(trade.price, { unsigned: true })
  const quantity = decimalEvidence(trade.quantity, { unsigned: true })
  const realizedPnl = decimalEvidence(trade.realizedPnl)
  const commission = decimalEvidence(trade.commission, { unsigned: true })
  const quoteQty = trade.quoteQty === null || trade.quoteQty === undefined
    ? null
    : decimalEvidence(trade.quoteQty, { unsigned: true })
  const marginAsset = canonicalAsset(trade.marginAsset)
  const commissionAsset = canonicalAsset(trade.commissionAsset)
  if (price === null || price.zero || quantity === null || quantity.zero
    || realizedPnl === null || commission === null
    || (trade.quoteQty !== null && trade.quoteQty !== undefined && quoteQty === null)
    || marginAsset === null || marginAsset !== trade.marginAsset
    || (!commission.zero
      && (commissionAsset === null || commissionAsset !== trade.commissionAsset))
    || (commission.zero
      && trade.commissionAsset !== null
      && trade.commissionAsset !== undefined
      && (commissionAsset === null || commissionAsset !== trade.commissionAsset))) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_EVIDENCE',
      'Trade-history row contains missing or non-canonical fill evidence',
    )
  }
  const time = normalizeFuturesTradeHistoryTime(trade.time)
  if (time === null || time !== trade.time) {
    return tradeEvidenceFailure(
      'INVALID_TRADE_TIME',
      'Trade-history row must carry one safe canonical timestamp',
    )
  }
  if ((startTime !== null && time < startTime) || (endTime !== null && time > endTime)) {
    return tradeEvidenceFailure(
      'OUT_OF_WINDOW_TRADE',
      'Trade-history page contains a row outside its requested window',
    )
  }
  return null
}
