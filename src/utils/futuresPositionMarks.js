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
    const anchorPrice = toFiniteNumber(mark?.anchorPrice)
    marks[symbol.toUpperCase()] = {
      markPrice: String(mark.markPrice),
      updatedAt: Number.isSafeInteger(mark?.updatedAt) ? mark.updatedAt : null,
      lastPrice: lastPrice === null || lastPrice <= 0 ? null : String(mark.lastPrice),
      lastPriceAt: Number.isSafeInteger(mark?.lastPriceAt) ? mark.lastPriceAt : null,
      // The traded price the mark beside it was taken against. It is what makes
      // the estimate below an extension of the mark rather than a different
      // series put in its place.
      anchorPrice: anchorPrice === null || anchorPrice <= 0 ? null : String(mark.anchorPrice),
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
// inside that second. Between two marks the position is valued at the mark
// carried forward by what the tape has done since that mark was taken —
// `mark + (last traded price − the traded price the mark was taken beside)` —
// so the number moves with the market instead of stepping once a second.
//
// It is emphatically not the traded price put in the mark's place, which is what
// this did until it was found reversing the sign of a live position. The mark is
// an index average carried on a smoothing basis and the tape is what printed; on
// a fast move the two sit on opposite sides of an entry, so swapping one for the
// other turned a short's profit into a loss and back again according to which of
// two sockets had delivered most recently. Carried forward instead, the estimate
// equals the mark exactly while the tape is still, so a mark arriving can never
// move the reading on its own — and it still tracks the tape tick for tick,
// which is the whole reason the estimate exists.
//
// The reading still says which of the two it is, because only the mark is what
// the exchange will settle and liquidate on.
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
    const anchorPrice = toFiniteNumber(mark?.anchorPrice)
    // Both stamps, or no estimate: without them there is no way to tell a print
    // that happened after the mark from one that happened before it. And an
    // anchor, or no estimate either: without the traded price the mark was taken
    // beside there is nothing to carry the mark forward by, and the only thing
    // left to do with the tape would be to substitute it.
    const carryable = lastPrice !== null
      && lastPrice > 0
      && anchorPrice !== null
      && anchorPrice > 0
      && Number.isFinite(mark?.lastPriceAt)
      && Number.isFinite(mark?.updatedAt)
      && mark.lastPriceAt > mark.updatedAt
    const carried = carryable ? markPrice + (lastPrice - anchorPrice) : markPrice
    // A price is a positive number. An extrapolation that lands at or below zero
    // is not one, so the mark stands rather than a nonsense valuation.
    const estimated = carryable && carried > 0
    const valuation = estimated ? carried : markPrice
    changed = true
    return {
      ...position,
      markPrice: mark.markPrice,
      // What the PnL below was computed on, and whether that was the exchange's
      // own number. The liquidation price is untouched: it is a function of the
      // mark by definition. The exchange's own string while the mark stands, so
      // nothing rounds a confirmed price on the way to the screen; the
      // carried-forward figure only while it is being carried forward.
      valuationPrice: estimated ? String(valuation) : mark.markPrice,
      valuationEstimated: estimated,
      unrealizedPnl: String((valuation - entryPrice) * quantity),
      // The raw price the contract last printed at, when there is one newer
      // than the mark. Not a valuation — the row is never valued at it — but
      // the chart is drawn from it, and when it and the mark sit on opposite
      // sides of the entry the row reads as wrong against the operator's own
      // ENTRY line. Carried so a surface can say so instead of leaving the
      // operator to conclude the arithmetic is broken.
      tapePrice: carryable ? mark.lastPrice : null,
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
