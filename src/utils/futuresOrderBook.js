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

export const GROUPING_MULTIPLIERS = Object.freeze([1, 2, 5, 10, 25, 50, 100, 500])

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

// The step is expressed in the contract's own tick so it can never fall between
// two tradable prices.
export const futuresBookGroupSteps = (tickSize) => {
  const tickAtoms = parseAtoms(tickSize)
  if (tickAtoms === null || tickAtoms <= 0n) return Object.freeze([])
  return Object.freeze(GROUPING_MULTIPLIERS.map(multiplier => Object.freeze({
    multiplier,
    step: formatAtoms(tickAtoms * BigInt(multiplier)),
  })).filter(entry => entry.step !== null))
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
