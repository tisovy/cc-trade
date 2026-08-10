// One place that answers "what is this order, and what colour is it?".
//
// Binance reports positionSide BOTH for one-way accounts, so colouring or
// labelling by positionSide alone paints every order the same and hides whether
// it buys or sells. Direction is therefore always derived from side + reduceOnly,
// and the colour tone always follows the side: BUY is green, SELL is red.

const normalizeSide = value => (
  String(value ?? '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY'
)

const normalizePositionSide = (value) => {
  const positionSide = String(value ?? '').toUpperCase()
  return positionSide === 'LONG' || positionSide === 'SHORT' ? positionSide : null
}

export const describeFuturesOrderIntent = (order) => {
  const side = normalizeSide(order?.side)
  const reduceOnly = order?.reduceOnly === true
  // Hedge accounts state the leg outright; one-way accounts imply it: a
  // reduce-only BUY closes a SHORT, a plain BUY opens a LONG.
  const positionSide = normalizePositionSide(order?.positionSide)
    ?? ((side === 'BUY') === !reduceOnly ? 'LONG' : 'SHORT')
  const positionEffect = (positionSide === 'LONG') === (side === 'BUY') ? 'ENTRY' : 'EXIT'
  return Object.freeze({
    side,
    positionSide,
    positionEffect,
    tone: side === 'BUY' ? 'buy' : 'sell',
    // The leg plus the side colour already says everything: a red LONG closes a
    // long, a red SHORT opens one. Spelling out "entry"/"exit" adds only noise.
    label: positionSide,
  })
}

// What an order is worth, unrounded. Every surface that prices an order — the
// row, the editor, the chart label, the ticket's total — goes through here, so
// none of them can price the same order differently.
// An order with no price or no size is not an order worth nothing — it is one
// this cannot value. `Number(null)` is 0, so without the positive test a missing
// field would be reported as a confident zero, and a row that reads `0` in a
// column of order values reads as an order that commits nothing.
//
// A close-position stop carries no quantity of its own, and a market-triggered
// stop carries no limit price; both land here rather than at zero.
const orderNotionalValue = (order) => {
  const price = Number(order?.triggerPrice ?? order?.price)
  const quantity = Number(order?.origQty)
  if (!(price > 0) || !(Math.abs(quantity) > 0)) return null
  return Math.abs(price * quantity)
}

// What an order is worth is the number a trader compares against balance and
// risk; the exact quantity in base units is secondary.
export const orderNotionalUsdt = (order) => {
  const notional = orderNotionalValue(order)
  if (notional === null) return null
  return notional >= 1 ? String(Math.round(notional)) : notional.toFixed(2)
}

// What the resting orders come to, over the same arithmetic as the column they
// are read in, so the ticket's figure and a hand-sum of the list cannot
// disagree.
//
// This is order value, not the margin the exchange holds against it: at leverage
// the second is a fraction of the first, and reduce-only exits hold none at all.
// The operator reads this against their own list of orders, not against the
// wallet.
export const totalOrderNotionalUsdt = (orders) => {
  if (!Array.isArray(orders)) return null
  let total = 0
  let priced = 0
  for (const order of orders) {
    const notional = orderNotionalValue(order)
    if (notional === null) continue
    total += notional
    priced += 1
  }
  // Orders that exist but cannot be priced would otherwise total a confident
  // zero. An empty list is a real zero: there is nothing resting.
  if (orders.length > 0 && priced === 0) return null
  return total
}

// `Number(null)` is 0, so a missing field would otherwise be reported as a
// perfectly confident zero PnL. An absent number is absent, not zero.
const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const firstPositiveNumber = (candidates) => {
  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate)
    if (parsed !== null && parsed > 0) return parsed
  }
  return null
}

const entryNotionalOf = (position) => {
  const quantity = toFiniteNumber(position?.quantity)
  const entryPrice = toFiniteNumber(position?.entryPrice)
  return quantity !== null && entryPrice !== null ? Math.abs(quantity) * entryPrice : null
}

// The margin standing behind a position: what its liquidation price is computed
// from, and the denominator of the ROE shown beside it. Both readings come from
// here, so the percentage and the amount it is measured against can never
// disagree on the same row.
//
// `/fapi/v3/positionRisk` stopped reporting `marginType`, so the mode is read
// rather than inferred: isolating a position *is* walling funds off behind it,
// and a cross position has none. A source that still states the mode outright
// is believed first.
export const describeFuturesPositionMargin = (position) => {
  const declaredMode = String(position?.marginType ?? '').toUpperCase()
  // What the position actually holds, not what it was required to post: an
  // isolated wallet grows with every top-up and that is the amount at stake.
  const isolatedAmount = firstPositiveNumber([
    position?.isolatedWallet,
    position?.isolatedMargin,
  ])
  const leverage = toFiniteNumber(position?.leverage)
  const notional = entryNotionalOf(position)
  const sharedAmount = firstPositiveNumber([
    position?.initialMargin,
    // Only for sources that still carry leverage; the v3 read does not, and a
    // margin invented from a leverage nobody reported would be a guess.
    notional !== null && leverage !== null && leverage > 0 ? notional / leverage : null,
  ])
  const marginMode = declaredMode === 'ISOLATED'
    ? 'ISOLATED'
    : declaredMode === 'CROSS' || declaredMode === 'CROSSED'
      ? 'CROSS'
      : isolatedAmount !== null
        ? 'ISOLATED'
        : sharedAmount !== null ? 'CROSS' : null
  // Never a confident zero: a read that carried no margin figure says so.
  const margin = marginMode === 'ISOLATED'
    ? (isolatedAmount ?? sharedAmount)
    : marginMode === 'CROSS' ? sharedAmount : null
  return Object.freeze({
    marginMode,
    margin,
    // Binance moves margin on isolated positions only; a cross position's
    // margin is the whole account's and cannot be assigned to one row.
    adjustable: marginMode === 'ISOLATED' && margin !== null,
  })
}

export const describeFuturesPosition = (position) => {
  const quantity = toFiniteNumber(position?.quantity)
  const positionSide = normalizePositionSide(position?.positionSide)
    ?? (quantity !== null && quantity < 0 ? 'SHORT' : 'LONG')
  const unrealizedPnl = toFiniteNumber(position?.unrealizedPnl)
  const notional = entryNotionalOf(position)
  // What the position is worth right now — an amount, never a negative one.
  // Direction is already stated by the side badge and the row accent, so a sign
  // here only asks "minus what?". Entry notional answers a different question
  // and stays separate.
  const markPrice = toFiniteNumber(position?.markPrice)
  const markNotional = quantity !== null && markPrice !== null
    ? Math.abs(quantity * markPrice)
    : null
  // ROE the way Binance shows it: PnL against the margin actually committed.
  // Without a margin figure ROE is unavailable — never 0.
  const { margin } = describeFuturesPositionMargin(position)
  const roePercent = unrealizedPnl !== null && margin !== null
    ? (unrealizedPnl / margin) * 100
    : null
  return Object.freeze({
    positionSide,
    tone: positionSide === 'LONG' ? 'buy' : 'sell',
    quantity,
    absoluteQuantity: quantity === null ? null : Math.abs(quantity),
    notional,
    markNotional,
    unrealizedPnl,
    roePercent,
    pnlTone: unrealizedPnl === null || unrealizedPnl === 0
      ? 'flat'
      : unrealizedPnl > 0 ? 'positive' : 'negative',
  })
}

// A quantity of money, not a result: no sign, because there is nothing for the
// sign to mean.
export const formatUsdt = (value, fractionDigits = 2) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return '—'
  return Math.abs(parsed).toFixed(fractionDigits)
}

export const formatSignedUsdt = (value, fractionDigits = 2) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return '—'
  const sign = parsed > 0 ? '+' : parsed < 0 ? '−' : ''
  return `${sign}${Math.abs(parsed).toFixed(fractionDigits)}`
}

export const formatSignedPercent = (value, fractionDigits = 2) => {
  const parsed = toFiniteNumber(value)
  if (parsed === null) return '—'
  const sign = parsed > 0 ? '+' : parsed < 0 ? '−' : ''
  return `${sign}${Math.abs(parsed).toFixed(fractionDigits)}%`
}
