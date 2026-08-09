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
    marks[symbol.toUpperCase()] = {
      markPrice: String(mark.markPrice),
      updatedAt: Number.isSafeInteger(mark?.updatedAt) ? mark.updatedAt : null,
    }
  }
  return marks
}

// USDⓈ-M values an open position at the mark price, so unrealized PnL is
// (mark − entry) × signed quantity — the same arithmetic the exchange reports
// in the account snapshot, applied to a fresher mark. A position missing any of
// those three inputs is left exactly as reported rather than half re-valued.
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
    changed = true
    return {
      ...position,
      markPrice: mark.markPrice,
      unrealizedPnl: String((markPrice - entryPrice) * quantity),
    }
  })
  return changed ? merged : positions
}
