// The account snapshot is the truth about what is open; the mark price feed is
// the truth about what it is worth right now. They are merged here, at read
// time, so the snapshot is never overwritten: when the feed stops, its marks
// are simply gone and every row falls back to the exchange's last account read
// instead of presenting a mark that stopped moving as if it were live.

const toFiniteNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const readFuturesPositionMarks = (value) => {
  if (value === null || typeof value !== 'object') return null
  const marks = {}
  for (const [symbol, mark] of Object.entries(value)) {
    const markPrice = toFiniteNumber(mark?.markPrice)
    if (typeof symbol !== 'string' || symbol.length === 0) continue
    if (markPrice === null || markPrice <= 0) continue
    const lastPrice = toFiniteNumber(mark?.lastPrice)
    marks[symbol.toUpperCase()] = {
      markPrice: String(mark.markPrice),
      updatedAt: Number.isSafeInteger(mark?.updatedAt) ? mark.updatedAt : null,
      lastPrice: lastPrice === null || lastPrice <= 0 ? null : String(mark.lastPrice),
      lastPriceAt: Number.isSafeInteger(mark?.lastPriceAt) ? mark.lastPriceAt : null,
    }
  }
  return marks
}

// USDⓈ-M values an open position at the mark price, so unrealized PnL is
// (mark − entry) × signed quantity — the same arithmetic the exchange reports
// in the account snapshot, applied to a fresher mark. A position missing any of
// those three inputs is left exactly as reported rather than half re-valued.
//
// Binance publishes no mark faster than one a second, and a violent move happens
// inside that second. Between two marks the same arithmetic is applied to the
// last price the contract actually traded at, so the number moves with the
// market instead of stepping once a second — and the reading says which of the
// two it is, because only the mark is what the exchange will settle and
// liquidate on. A mark always replaces the estimate: newer, and confirmed.
export const mergeFuturesPositionMarks = (positions, marks) => {
  if (!Array.isArray(positions) || positions.length === 0) return positions
  if (marks === null || typeof marks !== 'object') return positions
  let changed = false
  const merged = positions.map((position) => {
    const mark = marks[position?.symbol]
    const markPrice = toFiniteNumber(mark?.markPrice)
    const quantity = toFiniteNumber(position?.quantity)
    const entryPrice = toFiniteNumber(position?.entryPrice)
    if (markPrice === null || markPrice <= 0
      || quantity === null || quantity === 0
      || entryPrice === null || entryPrice <= 0) return position
    const lastPrice = toFiniteNumber(mark?.lastPrice)
    // Both stamps, or no estimate: without them there is no way to tell a print
    // that happened after the mark from one that happened before it.
    const estimated = lastPrice !== null
      && lastPrice > 0
      && Number.isFinite(mark?.lastPriceAt)
      && Number.isFinite(mark?.updatedAt)
      && mark.lastPriceAt > mark.updatedAt
    const valuation = estimated ? lastPrice : markPrice
    changed = true
    return {
      ...position,
      markPrice: mark.markPrice,
      // What the PnL below was computed on, and whether that was the exchange's
      // own number. The liquidation price is untouched: it is a function of the
      // mark by definition.
      valuationPrice: estimated ? mark.lastPrice : mark.markPrice,
      valuationEstimated: estimated,
      unrealizedPnl: String((valuation - entryPrice) * quantity),
      // The same figure on the mark, kept whatever the reading above is. Every
      // margin number is measured from it — the margin balance, the distance to
      // liquidation, and the amount the desk will let the operator take out —
      // and none of those may move with an estimate. It is also what the reading
      // states as its confirmation.
      markUnrealizedPnl: String((markPrice - entryPrice) * quantity),
    }
  })
  return changed ? merged : positions
}
