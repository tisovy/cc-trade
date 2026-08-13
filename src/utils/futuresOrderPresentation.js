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

  // What the exchange requires the position to keep. Liquidation is the moment
  // the margin balance reaches it, so it is the floor under everything below.
  const maintenanceMargin = toFiniteNumber(position?.maintenanceMargin)
  // The mark's figure, never the estimate beside it. Everything below this line
  // is a statement about liquidation, and liquidation is the mark's by
  // definition — an estimate here would put a wrong distance under a real one,
  // and would tell the operator they may withdraw margin they may not.
  const unrealizedPnl = toFiniteNumber(position?.markUnrealizedPnl)
    ?? toFiniteNumber(position?.unrealizedPnl)
    ?? 0
  // Unrealized profit is not counted: it is not in the wallet and cannot be
  // withdrawn. Unrealized loss is, because it has already been taken out.
  const marginBalance = margin === null ? null : margin + Math.min(0, unrealizedPnl)
  // The distance to liquidation measured in money rather than in price — and
  // only for an isolated position, because a cross position's buffer is the
  // whole account's and cannot be attributed to one row.
  //
  // This is where liquidation becomes certain, not the amount Binance will
  // release: its leverage brackets hold back more, and the v3 read reports no
  // leverage to reproduce that from. The exchange refuses the rest itself.
  const liquidationBuffer = marginMode === 'ISOLATED'
    && marginBalance !== null
    && maintenanceMargin !== null
    ? marginBalance - maintenanceMargin
    : null
  return Object.freeze({
    marginMode,
    margin,
    maintenanceMargin,
    marginBalance,
    liquidationBuffer,
    // What can be taken out without putting the position under: never negative,
    // because a position already below its floor has nothing spare to give.
    removable: liquidationBuffer === null ? null : Math.max(0, liquidationBuffer),
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
    // The PnL beside it was computed on the last traded price rather than on a
    // confirmed mark. True only between two marks, and never true of the
    // liquidation price, which is the mark's by definition.
    pnlEstimated: position?.valuationEstimated === true,
    // The exchange's own arithmetic on its own mark, kept beside the reading so
    // a surface showing an estimate can always state what it is an estimate of.
    confirmedUnrealizedPnl: toFiniteNumber(position?.markUnrealizedPnl) ?? unrealizedPnl,
  })
}

// Where moving margin would put the liquidation price. Margin does not change
// the size of the position, so every USDT transferred buys exactly one
// contract's worth of price: the exchange closes the position when the loss eats
// the margin, and the loss per unit of price is the quantity. Adding pushes the
// price away from the entry, removing pulls it in.
//
// An estimate, and labelled as one on screen: the maintenance requirement is
// itself a share of the notional at the liquidation price, which bends the true
// answer by that rate — well under a percent of the move. Binance sets the price;
// this says which way it goes and how far, which is what nothing on this panel
// said before.
export const projectLiquidationPrice = ({
  liquidationPrice,
  quantity,
  positionSide,
  marginDelta,
} = {}) => {
  const liquidation = toFiniteNumber(liquidationPrice)
  const size = Math.abs(toFiniteNumber(quantity) ?? 0)
  const delta = toFiniteNumber(marginDelta)
  // A position with no liquidation price reported has none to move: Binance
  // sends 0 for that, and 0 is not a price this may do arithmetic on.
  if (liquidation === null || liquidation <= 0) return null
  if (!(size > 0) || delta === null || delta === 0) return null
  const shift = delta / size
  const moved = positionSide === 'SHORT' ? liquidation + shift : liquidation - shift
  return moved > 0 ? moved : 0
}

// What an exit at this price would settle: the amount coming off the table and
// the profit taken with it. Both are estimates by nature — a market exit pays
// whatever the book pays — and neither carries the exchange's fees, so the panel
// says so where it shows them.
export const describeFuturesCloseOutcome = ({
  positionSide,
  entryPrice,
  quantity,
  exitPrice,
} = {}) => {
  const size = toFiniteNumber(quantity)
  const exit = toFiniteNumber(exitPrice)
  const entry = toFiniteNumber(entryPrice)
  const usable = size !== null && size > 0 && exit !== null && exit > 0
  const direction = normalizePositionSide(positionSide) === 'SHORT' ? -1 : 1
  return Object.freeze({
    notional: usable ? size * exit : null,
    // Never a confident zero: without an entry price there is no profit to
    // state, and 0.00 would read as a break-even exit.
    realizedPnl: usable && entry !== null && entry > 0
      ? (exit - entry) * size * direction
      : null,
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
