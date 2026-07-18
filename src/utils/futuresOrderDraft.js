const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const MAX_DECIMAL_LENGTH = 64
const SCALE_DIGITS = 18
const SCALE = 10n ** BigInt(SCALE_DIGITS)

const parseDecimalAtoms = (value, { positive = false } = {}) => {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_DECIMAL_LENGTH
    || !DECIMAL_PATTERN.test(value)) return null
  const [integer, fraction = ''] = value.split('.')
  if (fraction.length > SCALE_DIGITS) return null
  const atoms = (BigInt(integer) * SCALE)
    + BigInt((fraction + '0'.repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS))
  if (positive && atoms <= 0n) return null
  return atoms
}

const formatDecimalAtoms = (atoms) => {
  if (typeof atoms !== 'bigint' || atoms < 0n) return null
  const integer = atoms / SCALE
  const fraction = String(atoms % SCALE).padStart(SCALE_DIGITS, '0').replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : String(integer)
}

const floorToIncrement = (atoms, increment) => (
  increment > 0n ? atoms - (atoms % increment) : null
)

export const normalizeFuturesDraftPrice = (price, tickSize) => {
  const priceAtoms = parseDecimalAtoms(price, { positive: true })
  const tickAtoms = parseDecimalAtoms(tickSize, { positive: true })
  if (priceAtoms === null || tickAtoms === null) return null
  const normalized = floorToIncrement(priceAtoms, tickAtoms)
  return normalized > 0n ? formatDecimalAtoms(normalized) : null
}

export const calculateFuturesNotionalForPercent = (maximumNotionalUsdt, percent) => {
  const maximumAtoms = parseDecimalAtoms(maximumNotionalUsdt, { positive: true })
  if (maximumAtoms === null
    || !Number.isSafeInteger(percent)
    || percent < 0
    || percent > 100) return null
  return formatDecimalAtoms((maximumAtoms * BigInt(percent)) / 100n)
}

export const calculateFuturesNotionalPercent = (notionalUsdt, maximumNotionalUsdt) => {
  const notionalAtoms = parseDecimalAtoms(notionalUsdt)
  const maximumAtoms = parseDecimalAtoms(maximumNotionalUsdt, { positive: true })
  if (notionalAtoms === null || maximumAtoms === null) return null
  const bounded = notionalAtoms > maximumAtoms ? maximumAtoms : notionalAtoms
  return Number((bounded * 100n) / maximumAtoms)
}

export const calculateFuturesEntryBudget = ({
  maximumOrderNotionalUsdt,
  maximumDailyNotionalUsdt,
  dailyUsedNotionalUsdt,
} = {}) => {
  const orderMaximum = parseDecimalAtoms(maximumOrderNotionalUsdt, { positive: true })
  const dailyMaximum = parseDecimalAtoms(maximumDailyNotionalUsdt, { positive: true })
  const dailyUsed = parseDecimalAtoms(dailyUsedNotionalUsdt)
  if (orderMaximum === null || dailyMaximum === null || dailyUsed === null) return null
  const dailyRemaining = dailyUsed >= dailyMaximum ? 0n : dailyMaximum - dailyUsed
  return formatDecimalAtoms(orderMaximum < dailyRemaining ? orderMaximum : dailyRemaining)
}

export const calculateFuturesExitBudget = ({
  positionQuantity,
  price,
  tickSize,
  maximumOrderNotionalUsdt,
  maximumDailyNotionalUsdt,
  dailyUsedNotionalUsdt,
} = {}) => {
  const quantityAtoms = parseDecimalAtoms(positionQuantity, { positive: true })
  const normalizedPrice = normalizeFuturesDraftPrice(price, tickSize)
  const priceAtoms = normalizedPrice === null
    ? null
    : parseDecimalAtoms(normalizedPrice, { positive: true })
  const safeBudget = calculateFuturesEntryBudget({
    maximumOrderNotionalUsdt,
    maximumDailyNotionalUsdt,
    dailyUsedNotionalUsdt,
  })
  const safeBudgetAtoms = parseDecimalAtoms(safeBudget)
  if (quantityAtoms === null || priceAtoms === null || safeBudgetAtoms === null) return null
  const positionNotionalAtoms = (quantityAtoms * priceAtoms) / SCALE
  return formatDecimalAtoms(
    positionNotionalAtoms < safeBudgetAtoms ? positionNotionalAtoms : safeBudgetAtoms,
  )
}

export const isFuturesDraftAmountWithinBudget = (amount, budget) => {
  const amountAtoms = parseDecimalAtoms(amount, { positive: true })
  const budgetAtoms = parseDecimalAtoms(budget, { positive: true })
  return amountAtoms !== null && budgetAtoms !== null && amountAtoms <= budgetAtoms
}

export const deriveFuturesLimitOrderDraft = ({
  notionalUsdt,
  price,
  tickSize,
  stepSize,
  minQuantity,
  maxQuantity,
  minNotionalUsdt,
  leverage = 2,
} = {}) => {
  const notionalAtoms = parseDecimalAtoms(notionalUsdt, { positive: true })
  const normalizedPrice = normalizeFuturesDraftPrice(price, tickSize)
  const priceAtoms = normalizedPrice === null
    ? null
    : parseDecimalAtoms(normalizedPrice, { positive: true })
  const stepAtoms = parseDecimalAtoms(stepSize, { positive: true })
  const minimumQuantityAtoms = parseDecimalAtoms(minQuantity, { positive: true })
  const maximumQuantityAtoms = parseDecimalAtoms(maxQuantity, { positive: true })
  const minimumNotionalAtoms = parseDecimalAtoms(minNotionalUsdt, { positive: true })
  if (notionalAtoms === null
    || priceAtoms === null
    || stepAtoms === null
    || minimumQuantityAtoms === null
    || maximumQuantityAtoms === null
    || minimumNotionalAtoms === null
    || !Number.isSafeInteger(leverage)
    || leverage <= 0) {
    return Object.freeze({ ok: false, reason: 'INVALID_DRAFT_INPUT' })
  }

  const rawQuantityAtoms = (notionalAtoms * SCALE) / priceAtoms
  if (rawQuantityAtoms < minimumQuantityAtoms) {
    return Object.freeze({ ok: false, reason: 'BELOW_MINIMUM_QUANTITY' })
  }
  const quantityAtoms = minimumQuantityAtoms
    + floorToIncrement(rawQuantityAtoms - minimumQuantityAtoms, stepAtoms)
  if (quantityAtoms > maximumQuantityAtoms) {
    return Object.freeze({ ok: false, reason: 'ABOVE_MAXIMUM_QUANTITY' })
  }
  const exactNotionalAtoms = (quantityAtoms * priceAtoms) / SCALE
  if (exactNotionalAtoms < minimumNotionalAtoms) {
    return Object.freeze({ ok: false, reason: 'BELOW_MINIMUM_NOTIONAL' })
  }

  return Object.freeze({
    ok: true,
    price: normalizedPrice,
    quantity: formatDecimalAtoms(quantityAtoms),
    notionalUsdt: formatDecimalAtoms(exactNotionalAtoms),
    estimatedMarginUsdt: formatDecimalAtoms(exactNotionalAtoms / BigInt(leverage)),
  })
}
