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

// Prices, sizes and caps arrive as exchange decimal strings from the renderer
// and as plain numbers from the main process. Both are read as exact decimals;
// a float that only has an exponent form is reported as unreadable rather than
// silently mis-parsed.
const toDecimalText = (value) => {
  if (typeof value === 'string') return value
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const text = String(value)
  if (!text.includes('e') && !text.includes('E')) return text
  const fixed = value.toFixed(SCALE_DIGITS)
  return fixed.includes('e') || fixed.includes('E') ? null : fixed
}

export const normalizeFuturesDraftPrice = (price, tickSize) => {
  const priceAtoms = parseDecimalAtoms(price, { positive: true })
  const tickAtoms = parseDecimalAtoms(tickSize, { positive: true })
  if (priceAtoms === null || tickAtoms === null) return null
  const normalized = floorToIncrement(priceAtoms, tickAtoms)
  return normalized > 0n ? formatDecimalAtoms(normalized) : null
}

// Sizing is a whole-dollar decision. Fractional cents in the readout are noise
// that no trader acts on, so notional is floored to whole USDT everywhere.
export const quantizeFuturesNotionalUsdt = (notionalUsdt) => {
  const atoms = parseDecimalAtoms(notionalUsdt)
  if (atoms === null) return null
  return formatDecimalAtoms(atoms - (atoms % SCALE))
}

export const calculateFuturesNotionalForPercent = (maximumNotionalUsdt, percent) => {
  const maximumAtoms = parseDecimalAtoms(maximumNotionalUsdt, { positive: true })
  if (maximumAtoms === null
    || !Number.isSafeInteger(percent)
    || percent < 0
    || percent > 100) return null
  const notionalAtoms = (maximumAtoms * BigInt(percent)) / 100n
  return formatDecimalAtoms(notionalAtoms - (notionalAtoms % SCALE))
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
  availableBalanceUsdt,
  minimumAvailableBalanceUsdt,
  leverage,
} = {}) => {
  const orderMaximum = parseDecimalAtoms(maximumOrderNotionalUsdt, { positive: true })
  const dailyMaximum = parseDecimalAtoms(maximumDailyNotionalUsdt, { positive: true })
  const dailyUsed = parseDecimalAtoms(dailyUsedNotionalUsdt)
  if (orderMaximum === null || dailyMaximum === null || dailyUsed === null) return null
  const dailyRemaining = dailyUsed >= dailyMaximum ? 0n : dailyMaximum - dailyUsed
  const policyBudget = orderMaximum < dailyRemaining ? orderMaximum : dailyRemaining
  const hasAccountSizingInputs = availableBalanceUsdt !== undefined
    || minimumAvailableBalanceUsdt !== undefined
    || leverage !== undefined
  if (!hasAccountSizingInputs) return formatDecimalAtoms(policyBudget)

  const availableBalance = parseDecimalAtoms(availableBalanceUsdt)
  const minimumAvailableBalance = parseDecimalAtoms(minimumAvailableBalanceUsdt)
  if (availableBalance === null
    || minimumAvailableBalance === null
    || !Number.isSafeInteger(leverage)
    || leverage <= 0) return null
  const availableMargin = availableBalance > minimumAvailableBalance
    ? availableBalance - minimumAvailableBalance
    : 0n
  const balanceBudget = availableMargin * BigInt(leverage)
  return formatDecimalAtoms(policyBudget < balanceBudget ? policyBudget : balanceBudget)
}

export const calculateFuturesExitBudget = ({
  positionQuantity,
  price,
  tickSize,
} = {}) => {
  const quantityAtoms = parseDecimalAtoms(positionQuantity, { positive: true })
  const normalizedPrice = normalizeFuturesDraftPrice(price, tickSize)
  const priceAtoms = normalizedPrice === null
    ? null
    : parseDecimalAtoms(normalizedPrice, { positive: true })
  if (quantityAtoms === null || priceAtoms === null) return null
  const positionNotionalAtoms = (quantityAtoms * priceAtoms) / SCALE
  return formatDecimalAtoms(positionNotionalAtoms)
}

export const isFuturesDraftAmountWithinBudget = (amount, budget) => {
  const amountAtoms = parseDecimalAtoms(amount, { positive: true })
  const budgetAtoms = parseDecimalAtoms(budget, { positive: true })
  return amountAtoms !== null && budgetAtoms !== null && amountAtoms <= budgetAtoms
}

// Closing a position is sized in contracts, not in USDT: the trader is giving
// back a quantity they already hold, so it is floored to the lot step and can
// never exceed what is open.
export const deriveFuturesCloseQuantity = ({ quantity, openQuantity, stepSize } = {}) => {
  const quantityAtoms = parseDecimalAtoms(quantity, { positive: true })
  const openAtoms = parseDecimalAtoms(openQuantity, { positive: true })
  const stepAtoms = parseDecimalAtoms(stepSize, { positive: true })
  if (quantityAtoms === null || openAtoms === null) {
    return Object.freeze({ ok: false, reason: 'INVALID_CLOSE_QUANTITY' })
  }
  if (quantityAtoms > openAtoms) {
    return Object.freeze({ ok: false, reason: 'ABOVE_OPEN_QUANTITY' })
  }
  const snappedAtoms = stepAtoms === null
    ? quantityAtoms
    : floorToIncrement(quantityAtoms, stepAtoms)
  if (snappedAtoms === null || snappedAtoms <= 0n) {
    return Object.freeze({ ok: false, reason: 'BELOW_LOT_STEP' })
  }
  return Object.freeze({ ok: true, quantity: formatDecimalAtoms(snappedAtoms) })
}

// A percentage of an open position, floored to the lot step so the exchange
// never rejects the exit the operator just asked for.
export const calculateFuturesCloseQuantityForPercent = ({
  openQuantity,
  percent,
  stepSize,
} = {}) => {
  const openAtoms = parseDecimalAtoms(openQuantity, { positive: true })
  if (openAtoms === null || !Number.isSafeInteger(percent) || percent <= 0 || percent > 100) {
    return null
  }
  const targetAtoms = percent === 100 ? openAtoms : (openAtoms * BigInt(percent)) / 100n
  const stepAtoms = parseDecimalAtoms(stepSize, { positive: true })
  const snappedAtoms = stepAtoms === null ? targetAtoms : floorToIncrement(targetAtoms, stepAtoms)
  if (snappedAtoms === null || snappedAtoms <= 0n) return null
  return formatDecimalAtoms(snappedAtoms)
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

// ─────────────────────────────────────────────────────────────────────────────
// The risk ceiling
//
// FUTURES_MAX_ORDER_USDT is one rule, so it has one implementation. The audit
// found it enforced on placement and absent from every amendment path for
// exactly the reason such gaps happen: the comparison lived at the call site.
// The ticket, the order editor, the chart drag and the main process all ask
// this module instead, and the main process asks it again on its own for the
// command it received, so the renderer is never the only gate.
//
// What this module deliberately does *not* evaluate: minPrice, maxPrice, the
// percent-price band and the maximum open order count. Those are the exchange's
// filters and Binance applies them itself; a local copy is one more thing to
// keep in sync for no decision the operator makes differently.
// ─────────────────────────────────────────────────────────────────────────────

export const FUTURES_RISK_REASONS = Object.freeze({
  ABOVE_ORDER_CAP: 'ABOVE_ORDER_CAP',
  UNPRICEABLE_ORDER: 'UNPRICEABLE_ORDER',
})

export const calculateFuturesOrderNotional = (quantity, price) => {
  const quantityAtoms = parseDecimalAtoms(toDecimalText(quantity) ?? '', { positive: true })
  const priceAtoms = parseDecimalAtoms(toDecimalText(price) ?? '', { positive: true })
  if (quantityAtoms === null || priceAtoms === null) return null
  return formatDecimalAtoms((quantityAtoms * priceAtoms) / SCALE)
}

export const isFuturesOrderCapConfigured = capUsdt => (
  capUsdt !== null && capUsdt !== undefined && capUsdt !== ''
)

export const exceedsFuturesOrderCap = (notionalUsdt, capUsdt) => {
  if (!isFuturesOrderCapConfigured(capUsdt)) return false
  const capAtoms = parseDecimalAtoms(toDecimalText(capUsdt) ?? '', { positive: true })
  const notionalAtoms = parseDecimalAtoms(toDecimalText(notionalUsdt) ?? '', { positive: true })
  // A ceiling the desk cannot read, or an order it cannot value, is not
  // evidence that the order is small enough.
  if (capAtoms === null || notionalAtoms === null) return true
  return notionalAtoms > capAtoms
}

// Evaluated against the notional the order will *have*, never the one it had:
// an amendment is priced at its new price against the quantity it will work.
export const evaluateFuturesOrderRisk = ({
  quantity,
  price,
  maxOrderNotionalUsdt = null,
  exposureIncreasing = true,
} = {}) => {
  const notionalUsdt = calculateFuturesOrderNotional(quantity, price)
  // A reduce-only exit is exempt by design: a position stays closable whatever
  // the ceiling says, and closing it lowers exposure rather than raising it.
  if (!exposureIncreasing || !isFuturesOrderCapConfigured(maxOrderNotionalUsdt)) {
    return Object.freeze({ ok: true, notionalUsdt, capUsdt: null })
  }
  const capUsdt = toDecimalText(maxOrderNotionalUsdt)
  if (notionalUsdt === null) {
    return Object.freeze({
      ok: false,
      reason: FUTURES_RISK_REASONS.UNPRICEABLE_ORDER,
      notionalUsdt: null,
      capUsdt,
    })
  }
  if (exceedsFuturesOrderCap(notionalUsdt, maxOrderNotionalUsdt)) {
    return Object.freeze({
      ok: false,
      reason: FUTURES_RISK_REASONS.ABOVE_ORDER_CAP,
      notionalUsdt,
      capUsdt,
    })
  }
  return Object.freeze({ ok: true, notionalUsdt, capUsdt })
}

// The one evaluator every renderer submission surface calls: submittability
// first, then the ceiling, so a single draft is refused for a single stated
// reason wherever it was typed.
export const evaluateFuturesLimitSubmission = ({
  maxOrderNotionalUsdt = null,
  exposureIncreasing = true,
  ...draftInput
} = {}) => {
  const draft = deriveFuturesLimitOrderDraft(draftInput)
  if (!draft.ok) return draft
  const risk = evaluateFuturesOrderRisk({
    quantity: draft.quantity,
    price: draft.price,
    maxOrderNotionalUsdt,
    exposureIncreasing,
  })
  if (risk.ok) return draft
  return Object.freeze({
    ok: false,
    reason: risk.reason,
    notionalUsdt: risk.notionalUsdt,
    capUsdt: risk.capUsdt,
  })
}
