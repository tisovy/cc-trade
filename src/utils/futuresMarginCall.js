// What the exchange itself warned about.
//
// A liquidation price the desk draws beside a position is the desk's own
// reckoning. `MARGIN_CALL` is Binance saying the position's risk ratio is too
// high, in its own words, and the two must not read the same on screen.
//
// Binance's page for the event is explicit about what it is worth: risk guidance
// only, not a basis for a strategy, and in a highly volatile market the position
// may already have been liquidated by the time the frame arrives. So the desk
// states it, stamps it, and never treats it as the current state of anything.
//
// There is no event for the risk passing. The exchange sends the warning and
// says nothing when it no longer applies, which is why the withdrawal rule below
// is written against the position rather than against a clock.

const POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT'])

const toSymbol = (value) => (
  typeof value === 'string' && value.trim() !== '' ? value.trim().toUpperCase() : null
)

const toAmount = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const futuresMarginCallKey = (position) => {
  const symbol = toSymbol(position?.symbol)
  if (symbol === null) return null
  const side = String(position?.positionSide ?? 'BOTH').toUpperCase()
  return `${symbol}:${POSITION_SIDES.has(side) ? side : 'BOTH'}`
}

/**
 * Read a margin call into the marks it puts on positions.
 *
 * The size and the isolated wallet are kept not to be shown but to be compared:
 * they are what the position looked like when the exchange raised its hand, and
 * the only honest grounds the desk has for taking the warning back down.
 */
export const readFuturesMarginCall = (payload, at = Date.now()) => {
  if (payload === null || typeof payload !== 'object') return null
  const positions = Array.isArray(payload.positions) ? payload.positions : []
  const calls = {}
  for (const position of positions) {
    const key = futuresMarginCallKey(position)
    if (key === null) continue
    calls[key] = Object.freeze({
      symbol: toSymbol(position.symbol),
      positionSide: key.split(':')[1],
      at,
      quantity: Math.abs(toAmount(position.quantity) ?? 0),
      isolatedWallet: toAmount(position.isolatedWallet),
      // What the exchange says has to stand behind the position for it to
      // survive. Shown as the exchange's own number, never recomputed.
      maintenanceMargin: toAmount(position.maintenanceMargin),
      markPrice: toAmount(position.markPrice),
    })
  }
  return Object.keys(calls).length > 0 ? Object.freeze(calls) : null
}

/**
 * Take down the warnings the positions no longer warrant.
 *
 * Three grounds, all of them the exchange's own statements about the position
 * rather than the desk's opinion of the risk: the position is closed, it is
 * smaller than it was when the warning came, or more margin is walled off behind
 * it than there was. Nothing else takes a warning down — in particular not time
 * passing, because a warning that expires on a timer is a warning that
 * disappears while the danger is still there.
 */
export const pruneFuturesMarginCalls = (marginCalls, positions) => {
  const entries = Object.entries(marginCalls ?? {})
  if (entries.length === 0) return marginCalls ?? {}
  const held = new Map((Array.isArray(positions) ? positions : [])
    .map(position => [futuresMarginCallKey(position), position])
    .filter(([key]) => key !== null))
  const kept = entries.filter(([key, call]) => {
    const position = held.get(key) ?? null
    if (position === null) return false
    const size = Math.abs(toAmount(position.quantity) ?? 0)
    if (size === 0) return false
    if (size < call.quantity) return false
    const wallet = toAmount(position.isolatedWallet)
    if (wallet !== null && call.isolatedWallet !== null && wallet > call.isolatedWallet) return false
    return true
  })
  if (kept.length === entries.length) return marginCalls
  return Object.freeze(Object.fromEntries(kept))
}
