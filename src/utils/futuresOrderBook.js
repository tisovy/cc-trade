// The book a trader reads is not the book the exchange sends. Sizes matter in
// USDT, not in base units, and at a tick of 0.000001 the top twenty levels can
// span less than a tick of intent — so levels are grouped by a chosen price
// step before anything is displayed. All of it is exact decimal arithmetic:
// float sums of a hundred levels drift, and a drifting cumulative column is
// worse than none.

const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const MAX_DECIMAL_LENGTH = 64
const SCALE_DIGITS = 18
const SCALE = 10n ** BigInt(SCALE_DIGITS)

// Spaced about twice apart the whole way up, because the ladder is cut against
// what the exchange publishes and a gap in it is reach the operator loses: with
// a fivefold jump from 100 to 500, a contract whose book ends anywhere between
// them dropped to 100 — on AKEUSDT, from 3.9% of price published down to 1.8%
// offered. No existing rung moves; a stored step is never invalidated by a rung
// added beside it.
export const GROUPING_MULTIPLIERS = Object.freeze([1, 2, 5, 10, 25, 50, 100, 200, 500, 1_000])

const parseAtoms = (value) => {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DECIMAL_LENGTH
    || !DECIMAL_PATTERN.test(value)) return null
  const [integer, fraction = ''] = value.split('.')
  if (fraction.length > SCALE_DIGITS) return null
  return (BigInt(integer) * SCALE)
    + BigInt((fraction + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS))
}

const formatAtoms = (atoms) => {
  if (typeof atoms !== 'bigint' || atoms < 0n) return null
  const integer = atoms / SCALE
  const fraction = String(atoms % SCALE).padStart(SCALE_DIGITS, '0').replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : String(integer)
}

const atomsToNumber = atoms => Number(formatAtoms(atoms) ?? '0')

// The coarsest step whose rows fit inside what the book states it reaches, in
// atoms. Against the narrower of the two sides: a step is one step on both
// halves of the panel, and cutting against the wider one asks the narrow half
// for rows nothing can fill.
const groupStepCeiling = (reach, rows) => {
  if (reach === null || typeof reach !== 'object') return null
  if (!Number.isSafeInteger(rows) || rows <= 0) return null
  const below = parseAtoms(reach.below)
  const above = parseAtoms(reach.above)
  if (below === null || above === null) return null
  const narrower = below < above ? below : above
  if (narrower <= 0n) return null
  return narrower / BigInt(rows)
}

/**
 * The grouping steps a contract offers, coarsest last.
 *
 * The step is expressed in the contract's own tick so it can never fall between
 * two tradable prices. How many of them are offered is a fact about the market
 * rather than the contract: the ladder ends at the coarsest step whose rows fit
 * inside the book the exchange publishes, because a step past that draws the
 * same book over fewer filled rows — the same market at lower resolution, read
 * as the book ending early.
 *
 * A reach of null is a book that may still be bought deeper, and the whole
 * ladder is offered against it: cutting there would describe what the desk has
 * spent rather than what the market publishes, and would stop the operator
 * asking for the deeper page by choosing the step that needs it.
 */
export const futuresBookGroupSteps = ({ tickSize = null, reach = null, rows = null } = {}) => {
  const tickAtoms = parseAtoms(tickSize)
  if (tickAtoms === null || tickAtoms <= 0n) return Object.freeze([])
  const ceiling = groupStepCeiling(reach, rows)
  const steps = []
  for (const multiplier of GROUPING_MULTIPLIERS) {
    const stepAtoms = tickAtoms * BigInt(multiplier)
    // The finest step is always offered. It is the book as the exchange sent it,
    // with no alignment pass at all, and a reach too narrow for even one tick of
    // grouping is a reading with nothing left to cut.
    if (ceiling !== null && steps.length > 0 && stepAtoms > ceiling) break
    const step = formatAtoms(stepAtoms)
    if (step !== null) steps.push(Object.freeze({ multiplier, step }))
  }
  return Object.freeze(steps)
}

/**
 * How far past the best price the rows on screen reach: how many of them, times
 * the step they are grouped by.
 *
 * Exact, in the contract's own quote currency. The backend buys the book one
 * page deeper when the snapshot it holds does not prove that far — and opens
 * every contract on the cheapest page, which is a tenth of the weight of the
 * thousand levels a 500-tick step would need.
 */
export const futuresBookDepthRange = ({ step, rows } = {}) => {
  const stepAtoms = parseAtoms(typeof step === 'string' ? step : '')
  if (stepAtoms === null || stepAtoms <= 0n) return null
  if (!Number.isSafeInteger(rows) || rows <= 0) return null
  return formatAtoms(stepAtoms * BigInt(rows))
}

const alignAtoms = (priceAtoms, stepAtoms, roundUp) => {
  const remainder = priceAtoms % stepAtoms
  if (remainder === 0n) return priceAtoms
  return roundUp ? priceAtoms + (stepAtoms - remainder) : priceAtoms - remainder
}

/**
 * The display row a price falls into, as an opaque key.
 *
 * A working order is marked on the book by matching this key rather than the
 * printed price: a grouped row prints the boundary of its bucket, so comparing
 * printed strings would miss every order inside the bucket.
 */
export const futuresBookGroupKey = ({ price, side = 'bid', step = null } = {}) => {
  const priceAtoms = parseAtoms(price)
  if (priceAtoms === null) return null
  const stepAtoms = parseAtoms(step)
  if (stepAtoms === null || stepAtoms <= 0n) return String(priceAtoms)
  return String(alignAtoms(priceAtoms, stepAtoms, side === 'ask'))
}

/**
 * Aggregates raw exchange levels into display rows.
 *
 * `side` is `'ask'` or `'bid'`: asks round a group up to its boundary and bids
 * round down, so a grouped price is always a price the side would actually
 * fill through. Sizes are converted to USDT (price × quantity) and accumulated
 * from the top of the book outwards.
 */
export const groupFuturesBookLevels = ({
  levels = [],
  side = 'bid',
  step = null,
  limit = 12,
} = {}) => {
  const stepAtoms = parseAtoms(step)
  const usableStep = stepAtoms !== null && stepAtoms > 0n ? stepAtoms : null
  const stepDecimals = typeof step === 'string' && step.includes('.')
    ? step.split('.')[1].replace(/0+$/, '').length
    : 0
  const roundUp = side === 'ask'
  const groups = new Map()
  const order = []
  for (const level of levels) {
    const priceAtoms = parseAtoms(level?.price)
    const quantityAtoms = parseAtoms(level?.quantity)
    if (priceAtoms === null || quantityAtoms === null || quantityAtoms === 0n) continue
    const groupAtoms = usableStep === null
      ? priceAtoms
      : alignAtoms(priceAtoms, usableStep, roundUp)
    const key = String(groupAtoms)
    const notionalAtoms = (priceAtoms * quantityAtoms) / SCALE
    const existing = groups.get(key)
    if (existing) {
      existing.quantityAtoms += quantityAtoms
      existing.notionalAtoms += notionalAtoms
      continue
    }
    // A level that already sits on the boundary keeps the exchange's own
    // string, so the book never loses the trailing digits the contract quotes.
    const entry = {
      groupAtoms,
      quantityAtoms,
      notionalAtoms,
      displayPrice: groupAtoms === priceAtoms
        ? level.price
        : Number(formatAtoms(groupAtoms) ?? '0').toFixed(stepDecimals),
    }
    groups.set(key, entry)
    order.push(entry)
    // Levels are monotonic in price, so opening the (limit + 1)-th group proves
    // every earlier group is closed. Without this the whole delivered book —
    // a thousand levels per side — is walked to fill fourteen rows.
    if (order.length > limit) break
  }
  // Levels arrive best-price-first and grouping preserves that order, so the
  // cumulative column can be built in one pass without re-sorting.
  let cumulativeAtoms = 0n
  return Object.freeze(order.slice(0, limit).map((entry) => {
    cumulativeAtoms += entry.notionalAtoms
    return Object.freeze({
      price: entry.displayPrice,
      groupKey: String(entry.groupAtoms),
      quantity: formatAtoms(entry.quantityAtoms),
      notionalUsdt: atomsToNumber(entry.notionalAtoms),
      cumulativeUsdt: atomsToNumber(cumulativeAtoms),
    })
  }))
}

// A book is scanned for its walls: the few levels holding far more than the rest
// of what is on screen. Five a side is what the eye picks out at a glance —
// marking more of them makes the marking the background it is meant to stand
// out from.
export const FUTURES_BOOK_WALL_COUNT = 5

// Ties are kept whole: two levels resting the same size are both walls or
// neither, since choosing between them by their position in the array would
// mark one wall and leave its twin plain. A side holding no more levels than
// walls is left unmarked for the same reason — marking every row says nothing.
export const futuresBookWallKeys = (levels, count = FUTURES_BOOK_WALL_COUNT) => {
  if (!Array.isArray(levels) || !Number.isSafeInteger(count) || count < 1) return new Set()
  if (levels.length <= count) return new Set()
  const resting = levels
    .map(level => level?.notionalUsdt)
    .filter(notional => Number.isFinite(notional) && notional > 0)
    .sort((left, right) => right - left)
  if (resting.length === 0) return new Set()
  const wall = resting[Math.min(count, resting.length) - 1]
  return new Set(levels
    .filter(level => Number.isFinite(level?.notionalUsdt) && level.notionalUsdt >= wall)
    .map(level => level.groupKey))
}
