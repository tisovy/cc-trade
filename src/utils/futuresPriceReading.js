// Where a price came from, and how old it was when it got there.
//
// The desk used to answer one question — "is this reading current?" — and then
// let the answer decide a different one: "may the operator act?". A display
// state cannot decide that. Order entry never travelled the market-data path,
// and a chart that has gone quiet still shows the last price it had; refusing
// the click only leaves the operator typing the same number by hand.
//
// So a picked price stops being a bare string and carries the reading it was
// taken off: which surface, what that surface could vouch for, and when the desk
// last saw it live. The controls stay armed and the age travels with the price
// to the confirmation, where it is stated in the second before money moves.

const SURFACE_LABELS = Object.freeze({
  chart: 'chart',
  'order-book': 'order book',
})

export const FUTURES_PRICE_READING_SURFACES = Object.freeze({
  CHART: 'chart',
  ORDER_BOOK: 'order-book',
})

export const isFuturesReadingObservedAt = value => (
  Number.isFinite(value) && value > 0
)

// A stream that stopped while its transport is still up is a market with nothing
// to say, not a feed that died. The exchange sends no per-stream heartbeat, so
// this is the strongest statement available: the connection is proven live by
// everything else arriving on it, therefore the silence belongs to the market.
// It is a weaker claim than freshness and is never presented as one — the age is
// stated beside it either way.
export const describeFuturesPriceReading = ({
  surface,
  state,
  observedAt,
  connected = false,
} = {}) => {
  if (typeof surface !== 'string' || !(surface in SURFACE_LABELS)) return null
  const declared = typeof state === 'string' && state.length > 0 ? state : 'loading'
  const readingState = declared === 'stale' && connected === true ? 'quiet' : declared
  return Object.freeze({
    surface,
    surfaceLabel: SURFACE_LABELS[surface],
    state: readingState,
    live: readingState === 'live',
    observedAt: isFuturesReadingObservedAt(observedAt) ? observedAt : null,
  })
}

// Coarse on purpose. An operator deciding whether a price is worth acting on
// reads "4s" or "3m 12s"; a millisecond count is noise at the moment it is read,
// and a rounded-up second never claims the reading is fresher than it is.
export const formatFuturesReadingAge = (observedAt, now) => {
  if (!isFuturesReadingObservedAt(observedAt) || !Number.isFinite(now)) return null
  const seconds = Math.max(0, Math.floor((now - observedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

// What the operator reads on the ticket and on the confirmation. A live reading
// says nothing: it is the ordinary case, and a line that is always there is a
// line nobody reads when it matters.
export const describeFuturesReadingAgeNotice = (reading, now) => {
  if (!reading || reading.live) return null
  const age = formatFuturesReadingAge(reading.observedAt, now)
  return age === null
    ? `${reading.state.toUpperCase()} ${reading.surfaceLabel} — age unknown`
    : `${reading.state.toUpperCase()} ${reading.surfaceLabel} · ${age} old`
}
