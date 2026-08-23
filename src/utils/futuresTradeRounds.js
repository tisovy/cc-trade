import { normalizeFuturesTradeHistoryAsset } from './futuresTradeHistoryEvidence.js'

// Binance reports executions, not positions. One market close of a 136 439-unit
// position arrives as five fills in the same second, each with its own price, fee
// and slice of the realized PnL, and a session's worth of that is a wall of rows
// none of which is the number the operator is looking for. What they trade is a
// position: bought here, sold there, and the difference between the two.
//
// This walks the fills in order and folds them back into the positions they were:
// a round opens when exposure is taken and closes when it returns to flat.

const ATOM_DIGITS = 8
const ATOM_SCALE = 10n ** BigInt(ATOM_DIGITS)
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const SIGNED_DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const INTEGER_IDENTITY_PATTERN = /^\d{1,20}$/
const POSITION_LEGS = new Set(['BOTH', 'LONG', 'SHORT'])
const DEFAULT_SETTLEMENT_DIGITS = 8
const DEFAULT_HISTORY_PAGE_LIMIT = 1_000
const MAX_EXCHANGE_DECIMAL_TEXT_LENGTH = 256
const MAX_EXCHANGE_DECIMAL_DIGITS = 128
const MAX_EXCHANGE_DECIMAL_SCALE = 64

// Versioned separately from the persisted history store. Consumers can reject a
// symbol-only coverage record without throwing away the canonical fills it was
// built from, then rebuild this derived index under the current schema.
export const FUTURES_TRADE_ROUND_INDEX_VERSION = 2

const absoluteBigInt = value => (value < 0n ? -value : value)

const greatestCommonDivisor = (left, right) => {
  let a = absoluteBigInt(left)
  let b = absoluteBigInt(right)
  while (b !== 0n) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a === 0n ? 1n : a
}

// Prices and realized PnL are exchange decimals, not floating-point
// measurements. Fractions keep their exact text through the one decision where
// a sub-cent difference used to be compared with one percent of notional.
const ratio = (numerator, denominator = 1n) => {
  if (denominator === 0n) return null
  const sign = denominator < 0n ? -1n : 1n
  const signedNumerator = numerator * sign
  const positiveDenominator = denominator * sign
  const divisor = greatestCommonDivisor(signedNumerator, positiveDenominator)
  return Object.freeze({
    numerator: signedNumerator / divisor,
    denominator: positiveDenominator / divisor,
  })
}

const decimalRatio = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string'
    || text.length > MAX_EXCHANGE_DECIMAL_TEXT_LENGTH
    || !SIGNED_DECIMAL_PATTERN.test(text)) return null
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const [integer, fraction = ''] = unsigned.split('.')
  if (integer.length + fraction.length > MAX_EXCHANGE_DECIMAL_DIGITS
    || fraction.length > MAX_EXCHANGE_DECIMAL_SCALE) return null
  const scale = 10n ** BigInt(fraction.length)
  const numerator = (BigInt(integer) * scale) + BigInt(fraction || '0')
  return ratio(negative ? -numerator : numerator, scale)
}

// Raw exchange numbers in exponent notation are rejected above because their
// original decimal text has already been rounded by JavaScript. A number that
// this module derived from an exact, bounded ratio is different evidence: only
// its presentation switched to exponent notation. Expand that bounded view for
// terminal comparison instead of throwing away the exact fill basis a second
// time.
const derivedNumberRatio = (value) => {
  const direct = decimalRatio(value)
  if (direct !== null || typeof value !== 'number' || !Number.isFinite(value)) return direct
  const match = String(value).match(/^(-?)([0-9]+)(?:\.([0-9]+))?e([+-]?[0-9]+)$/i)
  if (match === null) return null
  const [, sign, integer, fraction = '', exponentText] = match
  const exponent = Number(exponentText)
  const digits = `${integer}${fraction}`
  const power = exponent - fraction.length
  if (!Number.isSafeInteger(exponent)
    || digits.length > MAX_EXCHANGE_DECIMAL_DIGITS
    || (power >= 0 && digits.length + power > MAX_EXCHANGE_DECIMAL_DIGITS)
    || (power < 0 && -power > MAX_EXCHANGE_DECIMAL_SCALE)) return null
  const numerator = BigInt(digits) * (power > 0 ? 10n ** BigInt(power) : 1n)
  const denominator = power < 0 ? 10n ** BigInt(-power) : 1n
  return ratio(sign === '-' ? -numerator : numerator, denominator)
}

const addRatios = (left, right) => ratio(
  (left.numerator * right.denominator) + (right.numerator * left.denominator),
  left.denominator * right.denominator,
)

const subtractRatios = (left, right) => ratio(
  (left.numerator * right.denominator) - (right.numerator * left.denominator),
  left.denominator * right.denominator,
)

const multiplyRatios = (left, right) => ratio(
  left.numerator * right.numerator,
  left.denominator * right.denominator,
)

const divideRatios = (left, right) => (
  right.numerator === 0n
    ? null
    : ratio(left.numerator * right.denominator, left.denominator * right.numerator)
)

const ratioAsNumber = value => Number(value.numerator) / Number(value.denominator)

// Exact decimal text where a rational terminates in base ten. A proportional
// split whose denominator contains any other prime is intentionally refused;
// that round's commission coverage becomes partial instead of rounding a fee
// and presenting the rounded subtotal as wallet-exact.
const terminatingDecimalText = (value) => {
  if (value === null) return null
  let denominator = value.denominator
  let twos = 0
  let fives = 0
  while (denominator % 2n === 0n) {
    denominator /= 2n
    twos += 1
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n
    fives += 1
  }
  if (denominator !== 1n) return null
  const scale = Math.max(twos, fives)
  const scaled = value.numerator
    * (2n ** BigInt(scale - twos))
    * (5n ** BigInt(scale - fives))
  const negative = scaled < 0n
  const digits = String(negative ? -scaled : scaled).padStart(scale + 1, '0')
  const integer = scale === 0 ? digits : digits.slice(0, -scale)
  const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '')
  const result = fraction === '' ? integer : `${integer}.${fraction}`
  return negative && result !== '0' ? `-${result}` : result
}

const ratiosWithin = (left, right, tolerance) => {
  const difference = subtractRatios(left, right)
  return absoluteBigInt(difference.numerator) * tolerance.denominator
    <= tolerance.numerator * difference.denominator
}

const quantityRatio = atoms => ratio(atoms, ATOM_SCALE)

const boundedSettlementDigits = value => (
  Number.isSafeInteger(value) && value >= 0 && value <= 18
    ? value
    : DEFAULT_SETTLEMENT_DIGITS
)

const settlementQuantum = digits => ratio(1n, 10n ** BigInt(boundedSettlementDigits(digits)))

const decimalPlaces = (value) => {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const point = text.indexOf('.')
  return point === -1 ? 0 : text.length - point - 1
}

const identityText = (value) => {
  const text = String(value ?? '').trim()
  return INTEGER_IDENTITY_PATTERN.test(text) ? text : null
}

const compareIntegerIdentity = (left, right) => {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  return BigInt(left) < BigInt(right) ? -1 : 1
}

// Quantities are compared for equality with zero — that is what "the position is
// flat" means — so they are held as integers. `0.1 + 0.2 - 0.3` is 5.5e-17 in
// floating point, and a position that never reaches flat swallows every fill after
// it into one endless round.
const toAtoms = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value
  if (typeof text !== 'string'
    || text.length > MAX_EXCHANGE_DECIMAL_TEXT_LENGTH
    || !DECIMAL_PATTERN.test(text)) return null
  const [integer, fraction = ''] = text.split('.')
  if (integer.length + fraction.length > MAX_EXCHANGE_DECIMAL_DIGITS
    || fraction.length > MAX_EXCHANGE_DECIMAL_SCALE) return null
  return (BigInt(integer) * ATOM_SCALE)
    + BigInt((fraction + '0'.repeat(ATOM_DIGITS)).slice(0, ATOM_DIGITS))
}

const fromAtoms = (atoms) => {
  const integer = atoms / ATOM_SCALE
  const fraction = String(atoms % ATOM_SCALE).padStart(ATOM_DIGITS, '0').replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : String(integer)
}

const allocationIdentity = (value) => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

const positiveAllocationAtoms = (value) => {
  if (typeof value === 'bigint') return value > 0n ? value : null
  if (typeof value !== 'string'
    || value.length > MAX_EXCHANGE_DECIMAL_DIGITS + ATOM_DIGITS
    || !/^[1-9][0-9]*$/.test(value)) return null
  return BigInt(value)
}

const sortedFrozenStrings = values => Object.freeze([...new Set(values)].sort())

// This deliberately audits the finished, serializable round contributions
// against a separate canonical source set. Re-summing only round aggregates
// would let an omitted or duplicated fill validate itself. Integer quantity
// atoms keep reversal splits exact where floating `share` is presentation-only.
export const auditFuturesFillAllocation = ({
  canonicalFills = [],
  contributions = [],
  roundKeys = [],
} = {}) => {
  const normalizedCanonical = []
  const invalidCanonicalFills = []
  for (const source of Array.isArray(canonicalFills) ? canonicalFills : []) {
    const identity = allocationIdentity(source?.identity)
    const atoms = positiveAllocationAtoms(source?.quantityAtoms)
    if (identity === null || atoms === null) {
      invalidCanonicalFills.push(Object.freeze({
        identity,
        quantityAtoms: atoms === null ? null : atoms.toString(),
      }))
      continue
    }
    normalizedCanonical.push({ identity, atoms })
  }
  normalizedCanonical.sort((left, right) => left.identity.localeCompare(right.identity)
    || (left.atoms < right.atoms ? -1 : left.atoms > right.atoms ? 1 : 0))

  const canonicalByIdentity = new Map()
  const duplicateCanonicalFillIds = new Set()
  for (const source of normalizedCanonical) {
    if (canonicalByIdentity.has(source.identity)) {
      duplicateCanonicalFillIds.add(source.identity)
      continue
    }
    canonicalByIdentity.set(source.identity, source.atoms)
  }

  const assignedByIdentity = new Map()
  const contributionRoundKeys = new Set()
  const invalidAssignments = []
  for (const contribution of Array.isArray(contributions) ? contributions : []) {
    const identity = allocationIdentity(contribution?.identity)
    const atoms = positiveAllocationAtoms(contribution?.quantityAtoms)
    const roundKey = allocationIdentity(contribution?.roundKey)
    if (identity === null || atoms === null || roundKey === null) {
      invalidAssignments.push(Object.freeze({
        identity,
        quantityAtoms: atoms === null ? null : atoms.toString(),
        roundKey,
      }))
      if (roundKey !== null) contributionRoundKeys.add(roundKey)
      continue
    }
    assignedByIdentity.set(identity, (assignedByIdentity.get(identity) ?? 0n) + atoms)
    contributionRoundKeys.add(roundKey)
  }

  const missingFillIds = []
  const underallocatedFillIds = []
  const overallocatedFillIds = []
  for (const [identity, expected] of canonicalByIdentity) {
    const assigned = assignedByIdentity.get(identity) ?? 0n
    if (assigned === 0n) missingFillIds.push(identity)
    if (assigned < expected) underallocatedFillIds.push(identity)
    if (assigned > expected) overallocatedFillIds.push(identity)
  }
  const unknownFillIds = [...assignedByIdentity.keys()]
    .filter(identity => !canonicalByIdentity.has(identity))
  const affectedFillIds = sortedFrozenStrings([
    ...duplicateCanonicalFillIds,
    ...missingFillIds,
    ...underallocatedFillIds,
    ...overallocatedFillIds,
    ...unknownFillIds,
    ...invalidCanonicalFills.map(source => source.identity).filter(Boolean),
    ...invalidAssignments.map(assignment => assignment.identity).filter(Boolean),
  ])
  const conserved = invalidCanonicalFills.length === 0
    && duplicateCanonicalFillIds.size === 0
    && invalidAssignments.length === 0
    && underallocatedFillIds.length === 0
    && overallocatedFillIds.length === 0
    && unknownFillIds.length === 0
  const affectedRoundKeys = conserved
    ? Object.freeze([])
    : sortedFrozenStrings([
      ...(Array.isArray(roundKeys) ? roundKeys.map(allocationIdentity).filter(Boolean) : []),
      ...contributionRoundKeys,
    ])
  const canonicalQuantityAtoms = [...canonicalByIdentity.values()]
    .reduce((total, atoms) => total + atoms, 0n)
  const assignedQuantityAtoms = [...assignedByIdentity.values()]
    .reduce((total, atoms) => total + atoms, 0n)

  return Object.freeze({
    conserved,
    canonicalFillCount: canonicalByIdentity.size,
    assignedFillCount: assignedByIdentity.size,
    contributionCount: Array.isArray(contributions) ? contributions.length : 0,
    canonicalQuantityAtoms: canonicalQuantityAtoms.toString(),
    assignedQuantityAtoms: assignedQuantityAtoms.toString(),
    duplicateCanonicalFillIds: sortedFrozenStrings(duplicateCanonicalFillIds),
    missingFillIds: sortedFrozenStrings(missingFillIds),
    underallocatedFillIds: sortedFrozenStrings(underallocatedFillIds),
    overallocatedFillIds: sortedFrozenStrings(overallocatedFillIds),
    unknownFillIds: sortedFrozenStrings(unknownFillIds),
    affectedFillIds,
    affectedRoundKeys,
    // Normal success stays compact; only failures retain per-fill diagnostics.
    affectedAtomsByFill: Object.freeze(affectedFillIds.map(identity => Object.freeze({
      identity,
      canonicalQuantityAtoms: canonicalByIdentity.get(identity)?.toString() ?? null,
      assignedQuantityAtoms: assignedByIdentity.get(identity)?.toString() ?? null,
    }))),
    invalidCanonicalFills: Object.freeze(invalidCanonicalFills),
    invalidAssignments: Object.freeze(invalidAssignments),
  })
}

// Money, not size: a missing fee or PnL is nothing rather than a reason to drop
// the fill, because the fill happened either way.
const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const isBuy = fill => String(fill?.side).toUpperCase() === 'BUY'

const symbolOf = fill => (typeof fill?.symbol === 'string' ? fill.symbol.toUpperCase() : '')

const settlementAssetOf = fill => normalizeFuturesTradeHistoryAsset(fill?.marginAsset)

// One-way accounts report `BOTH`; a hedge account names the leg the fill belongs
// to, and its two legs are two positions on one contract.
const legOf = (fill) => {
  const leg = String(fill?.positionSide ?? 'BOTH').toUpperCase()
  return POSITION_LEGS.has(leg) ? leg : null
}

export const futuresTradePositionKey = (symbol, leg = 'BOTH') => {
  const normalizedSymbol = String(symbol ?? '').trim().toUpperCase()
  const normalizedLeg = String(leg ?? '').trim().toUpperCase()
  return normalizedSymbol !== '' && POSITION_LEGS.has(normalizedLeg)
    ? `${normalizedSymbol}:${normalizedLeg}`
    : null
}

const rawFillIdentity = fill => identityText(fill?.id)

const fallbackFillIdentity = (fill, ordinal) => {
  const order = identityText(fill?.orderId)
  const time = Number.isSafeInteger(Number(fill?.time)) ? Number(fill.time) : 0
  return `fallback:${order ?? 'order'}:${time}:${ordinal}`
}

const describeFillIdentity = (fill, positionKey, ordinal) => {
  const trade = rawFillIdentity(fill)
  return Object.freeze({
    value: `${positionKey}:${trade === null ? fallbackFillIdentity(fill, ordinal) : `trade:${trade}`}`,
    trade,
    reliable: trade !== null,
  })
}

const canonicalFillEntry = (fill, ordinal) => {
  const symbol = symbolOf(fill)
  const leg = legOf(fill)
  const positionKey = futuresTradePositionKey(symbol, leg)
  const atoms = toAtoms(fill?.quantity)
  const priceRatio = decimalRatio(fill?.price)
  const price = Number(fill?.price)
  const time = finiteTime(fill?.time)
  const side = String(fill?.side ?? '').toUpperCase()
  if (positionKey === null || atoms === null || atoms <= 0n
    || decimalPlaces(fill?.quantity) > ATOM_DIGITS
    || priceRatio === null || !Number.isFinite(price) || price <= 0
    || time === null || !Number.isSafeInteger(time) || time < 0
    || (side !== 'BUY' && side !== 'SELL')) return null
  const identity = describeFillIdentity(fill, positionKey, ordinal)
  const realized = decimalRatio(fill?.realizedPnl)
  const commission = decimalRatio(fill?.commission)
  const commissionAmount = Number(fill?.commission)
  const commissionAsset = normalizeFuturesTradeHistoryAsset(fill?.commissionAsset)
  const commissionAssetPresent = fill?.commissionAsset !== null
    && fill?.commissionAsset !== undefined
    && !(typeof fill.commissionAsset === 'string' && fill.commissionAsset.trim() === '')
  const commissionAssetMalformed = commissionAssetPresent && commissionAsset === null
  const settlementAsset = settlementAssetOf(fill)
  return Object.freeze({
    fill,
    ordinal,
    symbol,
    leg,
    positionKey,
    atoms,
    price,
    priceRatio,
    time,
    identity,
    settlementAsset,
    commissionAsset,
    tradeComplete: identity.reliable
      && realized !== null
      && settlementAsset !== null
      && decimalPlaces(fill?.quantity) <= ATOM_DIGITS,
    commissionComplete: commission !== null
      && commissionAmount >= 0
      && !commissionAssetMalformed
      && (commissionAmount === 0 || commissionAsset !== null),
  })
}

const ratiosEqual = (left, right) => left.numerator === right.numerator
  && left.denominator === right.denominator

const presentRatiosConflict = (left, right) => left !== null
  && right !== null
  && !ratiosEqual(left, right)

const hasNonBlankDuplicateEvidence = value => value !== null
  && value !== undefined
  && !(typeof value === 'string' && value.trim() === '')

const malformedPresentRatio = value => hasNonBlankDuplicateEvidence(value)
  && decimalRatio(value) === null

const malformedPresentAsset = (value, normalized) => hasNonBlankDuplicateEvidence(value)
  && normalized === null

const canonicalFillEntriesConflict = (left, right) => (
  left.positionKey !== right.positionKey
  || left.atoms !== right.atoms
  || !ratiosEqual(left.priceRatio, right.priceRatio)
  || left.time !== right.time
  || isBuy(left.fill) !== isBuy(right.fill)
  || presentRatiosConflict(
    decimalRatio(left.fill?.realizedPnl),
    decimalRatio(right.fill?.realizedPnl),
  )
  || presentRatiosConflict(
    decimalRatio(left.fill?.commission),
    decimalRatio(right.fill?.commission),
  )
  // Sparse means absent. A present value that failed the bounded canonical
  // parser is contradictory evidence, not permission to borrow the other
  // delivery's money and silently restore exact Closed NET.
  || malformedPresentRatio(left.fill?.realizedPnl)
  || malformedPresentRatio(right.fill?.realizedPnl)
  || malformedPresentRatio(left.fill?.commission)
  || malformedPresentRatio(right.fill?.commission)
  || malformedPresentAsset(left.fill?.marginAsset, left.settlementAsset)
  || malformedPresentAsset(right.fill?.marginAsset, right.settlementAsset)
  || malformedPresentAsset(left.fill?.commissionAsset, left.commissionAsset)
  || malformedPresentAsset(right.fill?.commissionAsset, right.commissionAsset)
  || (left.settlementAsset !== null
    && right.settlementAsset !== null
    && left.settlementAsset !== right.settlementAsset)
  || (left.commissionAsset !== null
    && right.commissionAsset !== null
    && left.commissionAsset !== right.commissionAsset)
)

const mergeCanonicalFillEntries = (left, right) => canonicalFillEntry({
  ...left.fill,
  ...right.fill,
  id: right.identity.trade,
  symbol: right.symbol,
  positionSide: right.leg,
  side: isBuy(right.fill) ? 'BUY' : 'SELL',
  quantity: right.fill.quantity,
  price: right.fill.price,
  time: right.time,
  realizedPnl: decimalRatio(right.fill?.realizedPnl) === null
    ? left.fill.realizedPnl
    : right.fill.realizedPnl,
  commission: decimalRatio(right.fill?.commission) === null
    ? left.fill.commission
    : right.fill.commission,
  commissionAsset: right.commissionAsset ?? left.commissionAsset,
  marginAsset: right.settlementAsset ?? left.settlementAsset,
}, Math.min(left.ordinal, right.ordinal))

const compareFillEntries = (left, right) => {
  const time = left.time - right.time
  if (time !== 0) return time
  const trade = compareIntegerIdentity(left.identity.trade, right.identity.trade)
  if (trade !== 0) return trade
  return left.ordinal - right.ordinal
}

// `closing` says this round begins by closing a position opened before this
// window of fills, whose entry price is therefore not in the data. Its leg is the
// one being closed, not the side of the fill — a BUY that closes closed a short.
//
// `fromFlat` records whether the walk actually saw this round start from no
// position at all. The first round of a contract did not — the window of fills
// begins wherever the read reached, and the operator may already have been in
// the trade — and neither did one that follows a round closing a position older
// than the window.
const openRound = (entry, buy, closing, fromFlat, settlementDigits) => ({
  symbol: entry.symbol,
  positionKey: entry.positionKey,
  // The position leg is part of the identity. A trade id is only unique inside
  // one contract, and the same contract can carry two independent hedge legs.
  key: `${entry.identity.value}:round`,
  positionSide: entry.leg === 'BOTH'
    ? (closing === buy ? 'SHORT' : 'LONG')
    : entry.leg,
  openTime: entry.time,
  closeTime: entry.time,
  entryAtoms: 0n,
  entryNotional: 0,
  // What the units still held were entered at, kept the way the exchange keeps
  // it: adding moves the average, closing does not move it at all. This is not
  // what the round reports — that is the average over everything it ever
  // entered, and it is the figure that makes exit minus entry times size come
  // to the realized PnL of the whole round. But it is the only average a
  // single fill's realized PnL can be checked against, because that is what
  // the exchange settled it against.
  heldAtoms: 0n,
  heldEntry: 0,
  heldEntryRatio: null,
  exitAtoms: 0n,
  exitNotional: 0,
  realizedPnl: 0,
  realizedPnlRatio: ratio(0n),
  // Per asset, because Binance charges commission in BNB whenever the account
  // holds it — that is the default, since it discounts the fee for doing so.
  // Summed as one number, a BNB quantity was subtracted from a USDT result: on a
  // 1 120 USDT round paying 0.0085 BNB the row reported a fee of `0.0085` and a
  // net `0.01` below the gross, when the fee actually cost about five USDT. Not
  // a rounding error — a quantity of the wrong thing.
  feeByAsset: new Map(),
  feeRatioByAsset: new Map(),
  // Realized PnL is money only together with the asset Binance says it settled
  // in. Every fill in one round must agree; a missing/conflicting field keeps
  // the round unresolved until REST replaces the stream/legacy projection.
  settlementAsset: entry.settlementAsset,
  settlementAssetComplete: entry.settlementAsset !== null,
  fillShares: new Map(),
  tradeCoverageComplete: true,
  commissionCoverageComplete: true,
  fills: 0,
  partial: closing,
  fromFlat,
  leg: entry.leg,
  settlementDigits: boundedSettlementDigits(settlementDigits),
  // A zero-PnL first fill can be an opening or a break-even close when the
  // bounded read did not witness flat. Keep that uncertainty only until the
  // first reducing fill supplies evidence; it must never leak across a leg.
  ambiguousWindowEdge: entry.leg === 'BOTH'
    && !closing
    && !fromFlat
    && toNumber(entry.fill?.realizedPnl) === 0,
  edgePhase: null,
  aggregateEntryImplied: false,
})

// Whether the fill a round is about to open on is closing a position opened
// before this window. Realized PnL says so whenever there is any: an opening fill
// realizes nothing.
//
// Nothing is the one answer it cannot settle. A close at exactly the position's
// own average entry realizes nothing either, and at a window edge — where the
// position's opening fills are not in hand to size it — the two are the same row
// of data. Read as an opening fill it invents a position in the opposite
// direction; every fill after it on that side then reads as adding to the
// invention, an increase carries no realized PnL, and the real close leaves the
// review taking its profit with it.
//
// The fills that follow settle what the fill itself cannot. Inside a run on one
// side the position only moves one way, so a later fill in that run realizing
// anything at all proves the run is reducing a position rather than building one
// — and a position being reduced that the walk never saw opened was opened before
// this window. The run ends at the first fill on the other side, or on another
// position leg: in a hedge account two sells in a row can be one position opening
// and another closing, and that is a different reading of the same two rows.
const opensByClosing = (fills, from, fromFlat) => {
  const opener = fills[from].fill
  if (toNumber(opener?.realizedPnl) !== 0) return true
  // The walk has seen this contract flat, so there is no older position left to
  // close and no ambiguity to settle.
  if (fromFlat) return false
  const buy = isBuy(opener)
  const leg = legOf(opener)
  for (let index = from + 1; index < fills.length; index += 1) {
    const next = fills[index].fill
    if (isBuy(next) !== buy || legOf(next) !== leg) return false
    if (toNumber(next?.realizedPnl) !== 0) return true
  }
  return false
}

// A reducing fill larger than the round is holding has two readings: the
// position flipped, or it was bigger than this window of fills shows and the
// excess is closing what was open before the window began. The exchange settles
// it — realized PnL is reported per fill and against the position's own entry,
// so a flip realizes exactly what closing the part the walk can see would
// realize. Anything else means more was closed than the walk knows about.
const flipIsConsistent = (round, { fill, held, priceRatio }) => {
  const entryPrice = round.heldEntryRatio
  const realizedPnl = decimalRatio(fill?.realizedPnl)
  if (held <= 0n || entryPrice === null || priceRatio === null || realizedPnl === null) return false
  const priceMove = round.positionSide === 'SHORT'
    ? subtractRatios(entryPrice, priceRatio)
    : subtractRatios(priceRatio, entryPrice)
  const expectedPnl = multiplyRatios(priceMove, quantityRatio(held))
  // The bound is one atom of the settlement asset, independent of notional. A
  // 0.5 USDT disagreement on a 100.5 USDT close is therefore evidence, not
  // "rounding" merely because it is below one percent of the trade.
  return ratiosWithin(
    expectedPnl,
    realizedPnl,
    settlementQuantum(round.settlementDigits),
  )
}

// The tentative round treated the window-edge sells as a short entry (or buys
// as a long entry). Later evidence says they were instead exits from the real,
// older position. Move their already-counted quantity and notional across in
// place: fills and fees stay on the same round and are therefore counted once.
const restartAmbiguousWindowEdgeRound = (round) => {
  round.positionSide = round.positionSide === 'SHORT' ? 'LONG' : 'SHORT'
  round.exitAtoms += round.entryAtoms
  round.exitNotional += round.entryNotional
  round.entryAtoms = 0n
  round.entryNotional = 0
  round.heldAtoms = 0n
  round.heldEntry = 0
  round.heldEntryRatio = null
  round.partial = true
  round.ambiguousWindowEdge = false
  round.edgePhase = 'adding-after-edge-close'
  round.aggregateEntryImplied = true
}

const applyFill = (round, {
  fill,
  atoms,
  price,
  priceRatio,
  share,
  increasing,
  identity,
  tradeComplete,
  commissionComplete,
  settlementAsset,
  commissionAsset,
}) => {
  if (settlementAsset === null) {
    round.settlementAssetComplete = false
  } else if (round.settlementAsset === null) {
    round.settlementAsset = settlementAsset
    round.settlementAssetComplete = false
  } else if (round.settlementAsset !== settlementAsset) {
    round.settlementAssetComplete = false
  }
  const size = Number(fromAtoms(atoms))
  if (increasing) {
    round.entryAtoms += atoms
    round.entryNotional += size * price
    // Averaged against what is still held, not against everything ever entered.
    // A position scaled out of and back into drifts between the two, and the
    // check above compares a single fill's realized PnL — which the exchange
    // settled against this one — so it has to use this one.
    const heldQuantity = quantityRatio(round.heldAtoms)
    const addedQuantity = quantityRatio(atoms)
    const heldCost = round.heldAtoms === 0n || round.heldEntryRatio === null
      ? ratio(0n)
      : multiplyRatios(round.heldEntryRatio, heldQuantity)
    const addedCost = multiplyRatios(priceRatio, addedQuantity)
    const average = divideRatios(
      addRatios(heldCost, addedCost),
      quantityRatio(round.heldAtoms + atoms),
    )
    round.heldEntryRatio = average
    round.heldEntry = ratioAsNumber(average)
    round.heldAtoms += atoms
  } else {
    round.exitAtoms += atoms
    round.exitNotional += size * price
    // The whole of a fill's realized PnL belongs to the part of it that reduced
    // the position; a fill that closes one position and opens the opposite one
    // realized all of it on the way out.
    round.realizedPnl += toNumber(fill.realizedPnl)
    const realized = decimalRatio(fill.realizedPnl)
    if (realized !== null) {
      round.realizedPnlRatio = addRatios(round.realizedPnlRatio, realized)
    }
    // Only the quantity is given back. `heldEntry` is deliberately left where it
    // was: with nothing held it describes nothing, and the next entry above
    // multiplies it by a `heldSize` of zero, so the stale figure cannot reach an
    // average. Clearing it would read as though something depended on it.
    round.heldAtoms = round.heldAtoms > atoms ? round.heldAtoms - atoms : 0n
  }
  const priorContribution = round.fillShares.get(identity.value) ?? null
  const priorShare = priorContribution?.share ?? 0
  round.fillShares.set(identity.value, Object.freeze({
    identity: identity.value,
    tradeId: identity.trade,
    reliable: identity.reliable,
    share: priorShare + share,
    quantityAtoms: (priorContribution?.quantityAtoms ?? 0n) + atoms,
  }))
  round.tradeCoverageComplete = round.tradeCoverageComplete
    && tradeComplete
    && round.settlementAssetComplete
  round.commissionCoverageComplete = round.commissionCoverageComplete && commissionComplete
  // A fee is charged on the whole fill, so a split fill splits its fee. Kept
  // under the asset it was charged in: the desk holds no rate to convert BNB at,
  // and a converted guess would be printed beside money.
  const commission = toNumber(fill.commission) * share
  if (commission !== 0) {
    round.feeByAsset.set(
      commissionAsset,
      (round.feeByAsset.get(commissionAsset) ?? 0) + commission,
    )
  }
  const exactCommission = decimalRatio(fill.commission)
  const fillAtoms = toAtoms(fill.quantity)
  if (exactCommission !== null && fillAtoms !== null && fillAtoms > 0n) {
    const exactShare = ratio(atoms, fillAtoms)
    const portion = multiplyRatios(exactCommission, exactShare)
    round.feeRatioByAsset.set(
      commissionAsset,
      addRatios(round.feeRatioByAsset.get(commissionAsset) ?? ratio(0n), portion),
    )
  }
  round.closeTime = toNumber(fill.time)
  round.fills += 1
}

// The entry price of a position whose opening fills are older than this window is
// not lost — the exchange's own realized PnL states it. A long realized
// (exit − entry) × size, a short realized (entry − exit) × size, and realized PnL
// is reported before commission, so inverting it is arithmetic rather than a
// guess. A row that showed `—` where the entry belongs reads as a broken record of
// a position that was in fact entered at a knowable price.
const impliedEntryPrice = ({ positionSide, exitPrice, realizedPnl, quantity }) => {
  if (exitPrice === null || !(quantity > 0)) return null
  const perUnit = realizedPnl / quantity
  const entry = positionSide === 'SHORT' ? exitPrice + perUnit : exitPrice - perUnit
  return Number.isFinite(entry) && entry > 0 ? entry : null
}

// The fill fold owns no funding or insurance money. These compatibility fields
// therefore remain explicitly unproven; the canonical wallet ledger reconciles
// income once, outside individual round construction.
const NO_ROUND_INCOME = Object.freeze({
  funding: null,
  insuranceClear: null,
  shared: false,
  // Nothing has been read, so nothing is covered. A round built without the
  // income record is missing whatever funding it was charged, and reading that
  // as "complete" would present the trade's own arithmetic as the whole of what
  // the round did to the wallet.
  complete: false,
})

const finishRound = (round, open) => {
  const settlementAsset = round.settlementAsset
  // A fill that names no commission asset is taken to have paid in the asset the
  // contract settles in, which is what a USDⓈ-M contract does unless the account
  // opted into BNB.
  const settlementFee = settlementAsset === null
    ? 0
    : (round.feeByAsset.get(settlementAsset) ?? 0)
      + (round.feeByAsset.get(null) ?? 0)
  const realizedPnlExact = terminatingDecimalText(round.realizedPnlRatio)
  const exactFees = new Map([...round.feeRatioByAsset.entries()].map(([asset, amount]) => [
    asset,
    terminatingDecimalText(amount),
  ]))
  const commissionExact = [...exactFees.values()].every(amount => amount !== null)
  const settlementFeeExact = settlementAsset === null
    ? null
    : terminatingDecimalText(addRatios(
      round.feeRatioByAsset.get(settlementAsset) ?? ratio(0n),
      round.feeRatioByAsset.get(null) ?? ratio(0n),
    ))
  const income = NO_ROUND_INCOME
  const entryQuantity = Number(fromAtoms(round.entryAtoms))
  const exitQuantity = Number(fromAtoms(round.exitAtoms))
  // An open restarted edge round is the position it is holding: the size still
  // held of what it added, at those adds' own average, both read straight from
  // the fills. The implied entry below recovers the exited pre-window units —
  // the wrong units for a live row — and entryAtoms counts adds already taken
  // back by the re-close.
  const holdingOpenPosition = open && round.heldAtoms > 0n
  // An open round is the size it is holding; a closed one is the size it closed.
  const quantityAtoms = holdingOpenPosition
    ? round.heldAtoms
    : round.exitAtoms === 0n ? round.entryAtoms : round.exitAtoms
  const quantity = Number(fromAtoms(quantityAtoms))
  const exitPrice = exitQuantity > 0 ? round.exitNotional / exitQuantity : null
  const enteredHere = entryQuantity > 0
  const entryImplied = !holdingOpenPosition && (round.aggregateEntryImplied || !enteredHere)
  const entryPrice = holdingOpenPosition
    ? round.heldEntry
    : entryImplied
      ? impliedEntryPrice({
        positionSide: round.positionSide,
        exitPrice,
        realizedPnl: round.realizedPnl,
        quantity: exitQuantity,
      })
      : round.entryNotional / entryQuantity
  const fillContributions = Object.freeze([...round.fillShares.values()]
    .map(contribution => Object.freeze({
      ...contribution,
      quantityAtoms: contribution.quantityAtoms.toString(),
    })))
  const fillIdentities = Object.freeze(fillContributions.map(entry => entry.identity))
  const tradeIds = Object.freeze([...new Set(fillContributions
    .map(entry => entry.tradeId)
    .filter(entry => entry !== null))])
  const identifiedFills = fillContributions.filter(entry => entry.reliable).length
  const tradeCoverage = Object.freeze({
    complete: round.tradeCoverageComplete,
    status: round.tradeCoverageComplete ? 'complete' : 'partial',
    fills: fillContributions.length,
    identified: identifiedFills,
  })
  const commissionCoverageComplete = round.commissionCoverageComplete && commissionExact
  const commissionCoverage = Object.freeze({
    complete: commissionCoverageComplete,
    status: commissionCoverageComplete ? 'complete' : 'partial',
    fills: fillContributions.length,
  })
  return Object.freeze({
    key: round.key,
    symbol: round.symbol,
    positionKey: round.positionKey,
    leg: round.leg,
    positionSide: round.positionSide,
    openTime: round.openTime,
    closeTime: round.closeTime,
    quantity: fromAtoms(quantityAtoms),
    // What the position was worth, in the currency it settles in. A contract
    // count is only a size once you also know the price of the contract, and a
    // desk that sizes every order in USDT cannot compare 237 518 BMT against
    // 5 210 BEAT without doing that arithmetic by hand. Valued at the entry: the
    // exit is the entry plus the realized PnL, which the row states beside it.
    notional: entryPrice === null ? null : quantity * entryPrice,
    entryPrice,
    // Stated so the surface can say where the entry came from: read from the
    // fills, or recovered from what the position realized.
    entryImplied,
    exitPrice,
    realizedPnl: round.realizedPnl,
    realizedPnlExact,
    settlementAsset,
    // The commission charged in the asset the round settles in. A fee charged in
    // anything else is below, in its own asset, and is deliberately not folded
    // into this one.
    fee: settlementFee,
    feeExact: settlementFeeExact,
    // Every asset the round was charged in, the settlement asset included, so a
    // surface can state a BNB fee as BNB instead of as a number with no unit.
    feesByAsset: Object.freeze([...round.feeByAsset.entries()]
      .filter(([, amount]) => amount !== 0)
      .map(([asset, amount]) => Object.freeze({
        asset: asset ?? settlementAsset,
        amount,
        amountExact: exactFees.get(asset),
      }))
      .sort((left, right) => (left.asset < right.asset ? -1 : 1))),
    // What the round moved in the wallet besides the trade itself: funding paid
    // or received while it was held, and insurance clearance if it was
    // part-liquidated. Both come from the exchange's income record, where an
    // outflow is *already negative* — so they are added, while the commission
    // above comes from the trade record as an unsigned magnitude and is
    // subtracted. Mixing the two conventions returns a fee to the operator as
    // profit, which is why each is named for the record it came from.
    funding: income.funding,
    insuranceClear: income.insuranceClear,
    // Funding is charged against a contract and names no position leg, so where
    // both legs of one contract were open across a charge the desk states it as
    // the contract's rather than dividing it by a rule the exchange never
    // applied.
    fundingShared: income.shared,
    // Whether the income read reaches back to this round's open. Where it does
    // not, the result below is missing funding nobody read, and the row says so
    // instead of presenting an incomplete total as a complete one.
    fundingComplete: income.complete,
    // The exchange reports realized PnL before its own commission and does not
    // report funding on a fill at all, so realized PnL alone is not what the
    // round did to the wallet. This is.
    netPnl: round.realizedPnl
      - settlementFee
      + (income.funding ?? 0)
      + (income.insuranceClear ?? 0),
    fills: round.fills,
    fillIdentities,
    // Raw exchange ids are the bridge to income rows carrying `tradeId`.
    // `fillIds` is the compatibility name already consumed by the wallet ledger.
    fillIds: tradeIds,
    tradeIds,
    fillContributions,
    tradeCoverage,
    commissionCoverage,
    flatBoundaryProven: round.fromFlat,
    open,
    partial: round.partial,
  })
}

// One canonical position key's fills, in the order they happened. `BOTH` keeps
// signed one-way exposure; an explicit LONG or SHORT key never sees the other
// hedge leg and therefore cannot consume it.
const foldContractFills = (fills, {
  leftBoundaryProven = false,
  settlementDigits = DEFAULT_SETTLEMENT_DIGITS,
} = {}) => {
  const rounds = []
  let round = null
  let running = 0n
  // The walk has not seen a flat position yet: the contract's first round may
  // have been open before these fills begin.
  let openedFromFlat = leftBoundaryProven === true
  for (let index = 0; index < fills.length; index += 1) {
    const entry = fills[index]
    const buy = isBuy(entry.fill)
    let remaining = entry.atoms
    while (remaining > 0n) {
      if (round === null) {
        // Only a whole fill can be closing. The leftover of one that flipped the
        // position is known to be opening, and its fill's realized PnL was made
        // on the way out of the position it just closed.
        const whole = remaining === entry.atoms
        const explicitHedgeReduction = entry.leg === 'LONG'
          ? !buy
          : entry.leg === 'SHORT' ? buy : null
        round = openRound(entry, buy,
          whole && (explicitHedgeReduction ?? opensByClosing(fills, index, openedFromFlat)),
          openedFromFlat,
          settlementDigits)
        openedFromFlat = false
        running = 0n
      }
      let increasing = buy === (round.positionSide === 'LONG')
      const held = running < 0n ? -running : running
      if (round.ambiguousWindowEdge) {
        if (legOf(entry.fill) !== round.leg) {
          // A hedge leg is independent evidence about another position.
          round.ambiguousWindowEdge = false
        } else if (!increasing) {
          const reducing = remaining < held ? remaining : held
          const disproved = toNumber(entry.fill.realizedPnl) === 0
            && reducing > 0n
            && !flipIsConsistent(round, {
              fill: entry.fill,
              held: reducing,
              priceRatio: entry.priceRatio,
            })
          if (disproved) {
            restartAmbiguousWindowEdgeRound(round)
            running = 0n
            increasing = true
          } else {
            // The first reduction agreed with the tentative position (including
            // a genuine break-even reduction), so this was a real opening.
            round.ambiguousWindowEdge = false
          }
        }
      }
      // A round that began by closing a position opened before this window has no
      // size of its own to run down, so it ends where its run of closing fills
      // ends rather than swallowing the next position that opens. Unless it is
      // a restarted edge round still holding some of what it added: that
      // position is live, and more entry is more of it. An increase carrying
      // realized PnL overrules the holding — only a reduction realizes
      // anything, so the fill is proof this round's direction reading is
      // wrong, and it is read on its own evidence instead. Absorbed anyway, it
      // was counted as entry, its PnL was destroyed, and the whole window
      // could collapse into one open round the review then filtered out.
      if (round.partial && increasing
        && (toNumber(entry.fill.realizedPnl) !== 0
          || (round.edgePhase !== 'adding-after-edge-close' && round.heldAtoms === 0n))) {
        rounds.push(finishRound(round, false))
        round = null
        continue
      }
      // The re-close exists to take back what the restarted round added, and
      // whatever of the older position the window can still see. Once nothing
      // it added is held, a further reducing fill that realizes nothing is
      // indistinguishable from a new position opening, so it is not absorbed
      // on faith: the round ends and the fill is read on its own evidence.
      // Absorbed anyway, a genuinely new short was folded into a closed long
      // as extra exited contracts. A reducing fill that realizes anything is
      // the opposite proof — a new position's opener realizes nothing — so it
      // can only be more of the old close, and it stays in the round. The cost
      // of this split is deliberate and known: a continuation close at exactly
      // break-even still reads as a new position opening, and when nothing
      // later disproves it, the review carries an open round over a position
      // that is in fact flat. The data cannot tell those two apart; the fills
      // that follow usually can.
      if (!increasing && round.edgePhase === 'reclosing' && round.heldAtoms === 0n
        && toNumber(entry.fill.realizedPnl) === 0) {
        rounds.push(finishRound(round, false))
        round = null
        continue
      }
      // The position was open before this window began: what looked like a flip
      // is the rest of it being closed. Absorb the whole fill instead, and let
      // the entry come from the realized PnL — which states the position's true
      // average entry, where the fills in hand only state part of it. Read as a
      // flip, this invented a position in the opposite direction, priced at both
      // ends, and filed it in the closed-position review beside real ones.
      if (!increasing && !round.partial && !round.fromFlat && remaining > held
        && !flipIsConsistent(round, {
          fill: entry.fill,
          held,
          priceRatio: entry.priceRatio,
        })) {
        round.partial = true
        round.entryAtoms = 0n
        round.entryNotional = 0
      }
      if (!increasing && round.edgePhase === 'adding-after-edge-close') {
        round.edgePhase = 'reclosing'
      }
      // Reducing more than the position holds closes it and opens the opposite
      // one with what is left over.
      const take = increasing || round.partial || remaining <= held ? remaining : held
      applyFill(round, {
        fill: entry.fill,
        atoms: take,
        price: entry.price,
        priceRatio: entry.priceRatio,
        share: Number(take) / Number(entry.atoms),
        increasing,
        identity: entry.identity,
        tradeComplete: entry.tradeComplete,
        commissionComplete: entry.commissionComplete,
        settlementAsset: entry.settlementAsset,
        commissionAsset: entry.commissionAsset,
      })
      remaining -= take
      if (!round.partial) {
        running += buy ? take : -take
        if (running === 0n) {
          rounds.push(finishRound(round, false))
          round = null
          // The walk has now seen the position reach flat, so whatever opens
          // next is a position it can size — and a later fill that reduces past
          // it really did flip.
          openedFromFlat = true
        }
      }
    }
  }
  if (round !== null) {
    // A restarted edge round holding any of what it added is a live position:
    // published closed, it filed a phantom closed round in the review while
    // the operator was still in the trade, and the added size was held
    // nowhere. `heldAtoms` is exactly that size — only entries raise it and
    // only the restart path leaves `partial` set with entries behind it.
    const holdingRestartedAdds = round.edgePhase !== null && round.heldAtoms > 0n
    rounds.push(finishRound(round, holdingRestartedAdds || (!round.partial && running !== 0n)))
  }
  const fillConservation = auditFuturesFillAllocation({
    canonicalFills: fills.map(entry => ({
      identity: entry.identity.value,
      quantityAtoms: entry.atoms,
    })),
    contributions: rounds.flatMap(result => result.fillContributions.map(contribution => ({
      identity: contribution.identity,
      quantityAtoms: contribution.quantityAtoms,
      roundKey: result.key,
    }))),
    roundKeys: rounds.map(result => result.key),
  })
  return Object.freeze({
    rounds: Object.freeze(rounds),
    fillConservation,
  })
}

// Newest first, the way every other history table in the desk is read. A round
// that is still open sorts by its latest fill, so the position just worked on is
// the one at the top whichever contract it is on.
const newestFirst = (left, right) => (right.closeTime - left.closeTime)
  || (right.openTime - left.openTime)
  || (left.positionKey < right.positionKey ? -1 : left.positionKey > right.positionKey ? 1 : 0)
  || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)


const coverageRecordOf = (coverage, positionKey) => {
  if (coverage instanceof Map) return coverage.get(positionKey) ?? null
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) return null
  return coverage[positionKey] ?? null
}

const finiteTime = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const signedAtoms = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? (String(value).includes('e') ? value.toFixed(ATOM_DIGITS) : String(value))
    : value
  if (typeof text !== 'string') return null
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  if (decimalPlaces(unsigned) > ATOM_DIGITS) return null
  const atoms = toAtoms(unsigned)
  return atoms === null ? null : negative ? -atoms : atoms
}

const sourceFlatBoundaryIsProven = (source, coveredFrom) => {
  if (source?.flatBoundary === true) return true
  if (typeof source?.flatBoundary !== 'number'
    && typeof source?.flatBoundary !== 'string') return false
  const boundary = finiteTime(source?.flatBoundary)
  return boundary !== null && coveredFrom !== null && boundary <= coveredFrom
}

const positionCoverageOf = ({
  coverage,
  positionKey,
  entries,
  symbolFillCount,
  generation,
  pageLimit,
}) => {
  const source = coverageRecordOf(coverage, positionKey)
  const versionCompatible = source?.version === FUTURES_TRADE_ROUND_INDEX_VERSION
  const times = entries.map(entry => finiteTime(entry.fill?.time)).filter(time => time !== null)
  const observedFrom = times.length === 0 ? null : Math.min(...times)
  const observedTo = times.length === 0 ? null : Math.max(...times)
  const sourceFrom = versionCompatible ? finiteTime(source?.coveredFrom) : null
  const sourceTo = versionCompatible ? finiteTime(source?.coveredTo) : null
  // A stream fill is evidence for that fill, not for every sibling between the
  // last REST cursor and it. Compatible source bounds therefore remain the
  // authority; observed min/max are only a legacy fallback when no v2 bound was
  // supplied at all.
  const coveredFrom = sourceFrom ?? observedFrom
  const coveredTo = sourceTo ?? observedTo
  const normalizedPageLimit = Number.isSafeInteger(pageLimit) && pageLimit > 0
    ? pageLimit
    : DEFAULT_HISTORY_PAGE_LIMIT
  const statedPageLimited = versionCompatible && typeof source?.pageLimited === 'boolean'
    ? source.pageLimited
    : null
  const generationMatches = generation !== null && generation !== undefined
    && source?.generation === generation
  return Object.freeze({
    version: FUTURES_TRADE_ROUND_INDEX_VERSION,
    positionKey,
    coveredFrom,
    coveredTo,
    // A boundary belongs to the exact history generation that produced it.
    // Reusing it after the held fills advanced can qualify a round whose opener
    // was never actually observed in the current basis.
    flatBoundary: versionCompatible && generationMatches
      && sourceFlatBoundaryIsProven(source, coveredFrom),
    // An accumulated, successfully backfilled store can legitimately contain
    // far more than one endpoint page. Infer truncation from raw count only
    // until a compatible coverage record explicitly states the endpoint result.
    pageLimited: statedPageLimited ?? symbolFillCount >= normalizedPageLimit,
    retentionLimited: versionCompatible && source?.retentionLimited === true,
    continuityComplete: versionCompatible && source?.continuityComplete === true,
    terminalReconciled: generationMatches && typeof source?.terminalReconciled === 'boolean'
      ? source.terminalReconciled
      : null,
    generation: generation ?? null,
    sourceVersionCompatible: versionCompatible,
    sourceGenerationCompatible: generationMatches,
  })
}

const snapshotIndexOf = (positions) => {
  if (!Array.isArray(positions)) return null
  const snapshots = new Map()
  for (const position of positions) {
    const leg = legOf(position)
    const positionKey = futuresTradePositionKey(position?.symbol, leg)
    const quantity = signedAtoms(position?.quantity ?? position?.positionAmt)
    if (positionKey === null) continue
    const previous = snapshots.get(positionKey) ?? null
    // A complete account snapshot has one row per canonical key. Choosing a
    // duplicate by delivery order (or erasing a malformed present quantity as
    // though the key were absent) can turn contradictory evidence into an
    // authoritative terminal zero. Retain one bounded invalid sentinel instead
    // so both permutations fail closed for this key.
    if (quantity === null || previous !== null) {
      snapshots.set(positionKey, Object.freeze({
        position: previous?.position ?? position,
        leg,
        quantity: null,
        invalid: true,
      }))
      continue
    }
    snapshots.set(positionKey, Object.freeze({
      position,
      leg,
      quantity,
      invalid: false,
    }))
  }
  return snapshots
}

const terminalExposureOf = (rounds, leg) => {
  const open = rounds.find(round => round.open === true) ?? null
  if (open === null) return Object.freeze({ quantity: 0n, entryPrice: null, round: null })
  const quantity = signedAtoms(open.quantity)
  if (quantity === null) return Object.freeze({ quantity: null, entryPrice: null, round: open })
  const signed = leg === 'BOTH' && open.positionSide === 'SHORT' ? -quantity : quantity
  return Object.freeze({ quantity: signed, entryPrice: derivedNumberRatio(open.entryPrice), round: open })
}

const terminalMatchesSnapshot = (terminal, snapshot, leg, settlementDigits) => {
  if (terminal.quantity === null) return false
  let expected = 0n
  if (snapshot !== null) {
    if (leg === 'BOTH') expected = snapshot.quantity
    else if (leg === 'LONG' && snapshot.quantity >= 0n) expected = snapshot.quantity
    else if (leg === 'SHORT' && snapshot.quantity <= 0n) expected = -snapshot.quantity
    else return false
  }
  if (terminal.quantity !== expected) return false
  if (expected === 0n) return true
  const reportedEntry = decimalRatio(snapshot?.position?.entryPrice)
  return terminal.entryPrice !== null && reportedEntry !== null
    && ratiosWithin(terminal.entryPrice, reportedEntry, settlementQuantum(settlementDigits))
}

const roundReasons = (round, coverage) => {
  const reasons = []
  if (coverage.fillConservationComplete !== true) reasons.push('fill-conservation-failed')
  if (round.flatBoundaryProven !== true || round.partial === true) {
    reasons.push('left-boundary-unproven')
    if (coverage.pageLimited === true) reasons.push('history-page-limited')
    if (coverage.retentionLimited === true) reasons.push('history-retention-limited')
    if (coverage.sourceVersionCompatible !== true) reasons.push('coverage-version-unproven')
    else if (coverage.sourceGenerationCompatible !== true) {
      reasons.push('coverage-generation-unproven')
    }
  }
  if (round.tradeCoverage.complete !== true) reasons.push('trade-coverage-incomplete')
  if (coverage.continuityComplete !== true) reasons.push('history-continuity-unproven')
  const roundFrom = finiteTime(round.openTime)
  const roundTo = finiteTime(round.closeTime)
  if (coverage.coveredFrom === null || roundFrom === null
    || coverage.coveredFrom > roundFrom) reasons.push('trade-oldest-edge-unproven')
  if (coverage.coveredTo === null || roundTo === null
    || coverage.coveredTo < roundTo) reasons.push('trade-newest-edge-unproven')
  if (round.commissionCoverage.complete !== true) reasons.push('commission-coverage-incomplete')
  if (round.open === true && coverage.terminalReconciled !== true) {
    reasons.push(coverage.terminalReconciled === false
      ? 'terminal-snapshot-mismatch'
      : 'terminal-snapshot-unreconciled')
  }
  return Object.freeze([...new Set(reasons)])
}

const qualifyRound = (round, positionCoverage) => {
  const coverage = Object.freeze({
    ...positionCoverage,
    // This boundary is the one immediately before this round, not merely a flat
    // point found somewhere else in the same bounded window.
    flatBoundary: round.flatBoundaryProven === true,
  })
  const unresolvedReasons = roundReasons(round, coverage)
  return Object.freeze({
    ...round,
    coverage,
    resolved: unresolvedReasons.length === 0,
    unresolvedReasons,
    // This index deliberately owns fills only. Funding and other income are
    // reconciled by the wallet-ledger change, never copied here by time overlap.
    incomeCoverage: 'not-attached',
    fillNetPnl: round.netPnl,
  })
}

const unresolvedRoundSegment = round => Object.freeze({
  key: `unresolved:${round.key}`,
  positionKey: round.positionKey,
  symbol: round.symbol,
  leg: round.leg,
  coveredFrom: round.openTime,
  coveredTo: round.closeTime,
  open: round.open,
  fillIdentities: round.fillIdentities,
  fillIds: round.fillIds,
  tradeIds: round.tradeIds,
  fillContributions: round.fillContributions,
  tradeCoverage: round.tradeCoverage,
  commissionCoverage: round.commissionCoverage,
  coverage: round.coverage,
  reasons: round.unresolvedReasons,
})

const invalidFillSegment = (fill, ordinal) => {
  const symbol = symbolOf(fill) || null
  const leg = legOf(fill)
  const positionKey = futuresTradePositionKey(symbol, leg)
  const trade = rawFillIdentity(fill)
  const time = finiteTime(fill?.time)
  return Object.freeze({
    key: `unresolved:${positionKey ?? 'INVALID'}:${trade ?? ordinal}`,
    positionKey,
    symbol,
    leg,
    coveredFrom: time,
    coveredTo: time,
    open: null,
    fillIdentities: Object.freeze(trade === null ? [] : [
      `${positionKey ?? 'INVALID'}:trade:${trade}`,
    ]),
    fillIds: Object.freeze(trade === null ? [] : [trade]),
    tradeIds: Object.freeze(trade === null ? [] : [trade]),
    fillContributions: Object.freeze([]),
    tradeCoverage: Object.freeze({ complete: false, status: 'partial', fills: 1, identified: trade === null ? 0 : 1 }),
    commissionCoverage: Object.freeze({ complete: false, status: 'partial', fills: 1 }),
    coverage: null,
    reasons: Object.freeze(['invalid-fill']),
  })
}

const conflictingFillSegment = (fill, ordinal) => Object.freeze({
  ...invalidFillSegment(fill, ordinal),
  reasons: Object.freeze(['conflicting-fill-identity']),
})

const hasPartialEvidence = value => value !== null
  && value !== undefined
  && !(typeof value === 'string' && value.trim() === '')

// A rich REST copy may legitimately replace a sparse stream projection, but a
// malformed projection is not a blank cheque: every field it did carry still
// has to agree. Otherwise the valid copy would hide contradictory evidence just
// because another field on the same object was absent or unreadable.
const partialFillConflictsWithCanonical = (fill, canonical) => {
  if (hasPartialEvidence(fill?.positionSide) && legOf(fill) !== canonical.leg) return true

  if (hasPartialEvidence(fill?.side)) {
    const side = String(fill.side).trim().toUpperCase()
    if ((side !== 'BUY' && side !== 'SELL') || (side === 'BUY') !== isBuy(canonical.fill)) {
      return true
    }
  }

  if (hasPartialEvidence(fill?.quantity)) {
    const atoms = toAtoms(fill.quantity)
    if (atoms === null || atoms <= 0n || decimalPlaces(fill.quantity) > ATOM_DIGITS
      || atoms !== canonical.atoms) return true
  }

  if (hasPartialEvidence(fill?.price)) {
    const price = decimalRatio(fill.price)
    if (price === null || price.numerator <= 0n || !ratiosEqual(price, canonical.priceRatio)) {
      return true
    }
  }

  if (hasPartialEvidence(fill?.time)) {
    const time = finiteTime(fill.time)
    if (!Number.isSafeInteger(time) || time < 0 || time !== canonical.time) return true
  }

  for (const field of ['realizedPnl', 'commission']) {
    if (!hasPartialEvidence(fill?.[field])) continue
    const amount = decimalRatio(fill[field])
    const expected = decimalRatio(canonical.fill?.[field])
    if (amount === null || expected === null || !ratiosEqual(amount, expected)) return true
  }

  if (hasPartialEvidence(fill?.marginAsset)
    && settlementAssetOf(fill) !== canonical.settlementAsset) return true

  if (hasPartialEvidence(fill?.commissionAsset)) {
    const asset = typeof fill.commissionAsset === 'string'
      ? fill.commissionAsset.trim().toUpperCase()
      : null
    if (asset === null || asset === '' || asset !== canonical.commissionAsset) return true
  }

  return false
}

/**
 * Canonical, coverage-aware derivation of Futures position rounds.
 *
 * Income is intentionally absent from this API. It returns fill-owned facts and
 * an explicit unresolved lane; the canonical wallet ledger owns all income
 * reconciliation without copying time-overlapping rows into individual rounds.
 */
export const buildFuturesTradeRoundIndex = (trades, {
  coverage = {},
  positions = null,
  // Whether `positions` is the account's complete open-position set, so that a
  // key absent from it is authoritative evidence of a flat position — not
  // merely a snapshot that has not arrived yet. Only a complete snapshot may
  // anchor a chain's left boundary backward from its terminal state.
  snapshotComplete = false,
  generation = null,
  pageLimit = DEFAULT_HISTORY_PAGE_LIMIT,
  settlementDigits = DEFAULT_SETTLEMENT_DIGITS,
} = {}) => {
  const byPosition = new Map()
  const symbolFillCounts = new Map()
  const unresolved = []
  const invalidEvidence = []
  const canonicalEntries = new Map()
  const conflictingCanonicalEntries = new Map()
  const fallbackEntries = []
  for (const [ordinal, fill] of (Array.isArray(trades) ? trades : []).entries()) {
    const entry = canonicalFillEntry(fill, ordinal)
    if (entry === null) {
      const segment = invalidFillSegment(fill, ordinal)
      invalidEvidence.push(Object.freeze({
        segment,
        fill,
        ordinal,
        canonicalIdentity: segment.positionKey !== null && segment.tradeIds.length === 1
          ? `${segment.symbol}:trade:${segment.tradeIds[0]}`
          : null,
      }))
      continue
    }
    if (entry.identity.reliable) {
      // One Binance trade id is canonical within a contract. Compatible REST
      // evidence enriches a sparse stream projection; conflicting present
      // evidence poisons the key instead of making input order choose its PnL.
      const canonicalIdentity = `${entry.symbol}:trade:${entry.identity.trade}`
      if (conflictingCanonicalEntries.has(canonicalIdentity)) {
        const compromised = conflictingCanonicalEntries.get(canonicalIdentity)
        if (!compromised.has(entry.positionKey)) {
          compromised.add(entry.positionKey)
          invalidEvidence.push(Object.freeze({
            segment: conflictingFillSegment(fill, ordinal),
            fill,
            ordinal,
            canonicalIdentity: null,
          }))
        }
        continue
      }
      const previous = canonicalEntries.get(canonicalIdentity) ?? null
      if (previous === null) {
        canonicalEntries.set(canonicalIdentity, entry)
      } else if (canonicalFillEntriesConflict(previous, entry)) {
        canonicalEntries.delete(canonicalIdentity)
        const compromised = new Set([previous.positionKey, entry.positionKey])
        conflictingCanonicalEntries.set(canonicalIdentity, compromised)
        const conflicting = previous.positionKey === entry.positionKey
          ? [entry]
          : [previous, entry]
        for (const candidate of conflicting) {
          invalidEvidence.push(Object.freeze({
            segment: conflictingFillSegment(candidate.fill, candidate.ordinal),
            fill: candidate.fill,
            ordinal: candidate.ordinal,
            canonicalIdentity: null,
          }))
        }
      } else {
        canonicalEntries.set(canonicalIdentity, mergeCanonicalFillEntries(previous, entry))
      }
    } else {
      // An ordinal is deliberately part of an unreliable fallback identity, so
      // two fills with no exchange id cannot be guessed to be duplicates.
      fallbackEntries.push(entry)
    }
  }
  const retainedInvalidEvidence = invalidEvidence.flatMap((evidence) => {
    if (evidence.canonicalIdentity === null) return [evidence]
    const canonical = canonicalEntries.get(evidence.canonicalIdentity) ?? null
    if (canonical === null) return [evidence]
    if (!partialFillConflictsWithCanonical(evidence.fill, canonical)) return []
    return [Object.freeze({
      ...evidence,
      segment: conflictingFillSegment(evidence.fill, evidence.ordinal),
      canonicalIdentity: null,
    })]
  })
  unresolved.push(...retainedInvalidEvidence.map(evidence => evidence.segment))
  const unknownInvalidOwner = retainedInvalidEvidence.some(evidence => (
    evidence.segment.positionKey === null
  ))
  const compromisedPositionKeys = new Set(retainedInvalidEvidence
    .map(evidence => evidence.segment.positionKey)
    .filter(positionKey => positionKey !== null))
  for (const entry of [...canonicalEntries.values(), ...fallbackEntries]) {
    symbolFillCounts.set(entry.symbol, (symbolFillCounts.get(entry.symbol) ?? 0) + 1)
    if (!byPosition.has(entry.positionKey)) byPosition.set(entry.positionKey, [])
    byPosition.get(entry.positionKey).push(entry)
  }

  const snapshots = snapshotIndexOf(positions)
  const candidates = []
  const positionResults = new Map()
  const fillConservationResults = new Map()
  const digits = boundedSettlementDigits(settlementDigits)
  for (const [positionKey, entries] of byPosition) {
    entries.sort(compareFillEntries)
    const { symbol, leg } = entries[0]
    let positionCoverage = positionCoverageOf({
      coverage,
      positionKey,
      entries,
      symbolFillCount: symbolFillCounts.get(symbol) ?? entries.length,
      generation,
      pageLimit,
    })
    if (unknownInvalidOwner || compromisedPositionKeys.has(positionKey)) {
      positionCoverage = Object.freeze({
        ...positionCoverage,
        continuityComplete: false,
      })
    }
    const snapshot = snapshots === null ? null : snapshots.get(positionKey) ?? null
    let foldResult = foldContractFills(entries, {
      leftBoundaryProven: positionCoverage.flatBoundary,
      settlementDigits: digits,
    })
    // The left boundary can also be proven backward, from the right. If a fold
    // that assumes the chain began flat conserves every fill, never has to read
    // a round as continuing something older (no partial rounds, every round
    // from flat — the fold itself rejects the assumption when an opening fill
    // realizes PnL), and lands exactly on the authoritative account snapshot,
    // then the assumption is arithmetic rather than faith: the sum of held
    // fills equals the present position only when the position before them was
    // zero. Missing older fills would shift the terminal by exactly their net.
    // Only a complete snapshot may say "absent means flat", and a coverage
    // record that already proved the boundary forward needs no trial.
    if (snapshotComplete && snapshots !== null && positionCoverage.flatBoundary !== true) {
      const trial = foldContractFills(entries, {
        leftBoundaryProven: true,
        settlementDigits: digits,
      })
      const anchored = trial.fillConservation.conserved === true
        && trial.rounds.every(round => (
          round.flatBoundaryProven === true && round.partial !== true
        ))
        && terminalMatchesSnapshot(terminalExposureOf(trial.rounds, leg), snapshot, leg, digits)
      if (anchored) {
        foldResult = trial
        positionCoverage = Object.freeze({
          ...positionCoverage,
          leftBoundaryAnchor: 'terminal-snapshot',
        })
      }
    }
    const folded = foldResult.rounds
    const fillConservation = foldResult.fillConservation
    fillConservationResults.set(positionKey, fillConservation)
    positionCoverage = Object.freeze({
      ...positionCoverage,
      fillConservationComplete: fillConservation.conserved,
    })
    const terminal = terminalExposureOf(folded, leg)
    if (snapshots !== null) {
      positionCoverage = Object.freeze({
        ...positionCoverage,
        terminalReconciled: terminalMatchesSnapshot(terminal, snapshot, leg, digits),
      })
    }
    const qualified = Object.freeze(folded.map(round => qualifyRound(round, positionCoverage)))
    candidates.push(...qualified)
    const unresolvedForPosition = qualified
      .filter(round => !round.resolved)
      .map(unresolvedRoundSegment)
    // A fill basis ending flat while the authoritative snapshot is non-flat is
    // a missing terminal segment, not evidence that the new position has zero
    // PnL. There is no open round to carry the mismatch, so expose a dedicated
    // acquisition target and keep exact money absent from it.
    if (positionCoverage.terminalReconciled === false && terminal.round === null) {
      unresolvedForPosition.push(Object.freeze({
        key: `unresolved:${positionKey}:terminal-fill-gap`,
        positionKey,
        symbol,
        leg,
        coveredFrom: positionCoverage.coveredTo,
        coveredTo: null,
        open: snapshot !== null && snapshot.quantity !== 0n,
        fillIdentities: Object.freeze([]),
        fillIds: Object.freeze([]),
        tradeIds: Object.freeze([]),
        fillContributions: Object.freeze([]),
        tradeCoverage: Object.freeze({ complete: false, status: 'partial', fills: 0, identified: 0 }),
        commissionCoverage: Object.freeze({ complete: false, status: 'partial', fills: 0 }),
        coverage: positionCoverage,
        reasons: Object.freeze(['terminal-snapshot-mismatch', 'terminal-fill-gap']),
      }))
    }
    unresolved.push(...unresolvedForPosition)
    positionResults.set(positionKey, Object.freeze({
      version: FUTURES_TRADE_ROUND_INDEX_VERSION,
      positionKey,
      symbol,
      leg,
      coverage: positionCoverage,
      fillConservation,
      terminal: Object.freeze({
        quantity: terminal.quantity === null ? null : fromAtoms(absoluteBigInt(terminal.quantity)),
        side: terminal.quantity === null || terminal.quantity === 0n
          ? null
          : leg === 'BOTH' ? (terminal.quantity < 0n ? 'SHORT' : 'LONG') : leg,
        entryPrice: terminal.entryPrice === null ? null : ratioAsNumber(terminal.entryPrice),
        reconciled: positionCoverage.terminalReconciled,
      }),
      roundKeys: Object.freeze(qualified.filter(round => round.resolved).map(round => round.key)),
      unresolvedKeys: Object.freeze(unresolvedForPosition.map(segment => segment.key)),
    }))
  }

  // An authoritative account snapshot can name an open position for which this
  // bounded fill basis has no key at all. It is an unresolved acquisition target,
  // not an empty or zero-PnL round.
  if (snapshots !== null) {
    for (const [positionKey, snapshot] of snapshots) {
      if (byPosition.has(positionKey) || snapshot.quantity === 0n) continue
      const symbol = symbolOf(snapshot.position)
      let missingCoverage = positionCoverageOf({
        coverage,
        positionKey,
        entries: [],
        symbolFillCount: symbolFillCounts.get(symbol) ?? 0,
        generation,
        pageLimit,
      })
      if (unknownInvalidOwner || compromisedPositionKeys.has(positionKey)) {
        missingCoverage = Object.freeze({
          ...missingCoverage,
          continuityComplete: false,
        })
      }
      missingCoverage = Object.freeze({
        ...missingCoverage,
        terminalReconciled: false,
      })
      const missingReasons = Object.freeze([
        'fill-basis-missing',
        'terminal-snapshot-mismatch',
        ...(missingCoverage.pageLimited === true ? ['history-page-limited'] : []),
        ...(missingCoverage.retentionLimited === true ? ['history-retention-limited'] : []),
        ...(missingCoverage.sourceVersionCompatible !== true
          ? ['coverage-version-unproven']
          : missingCoverage.sourceGenerationCompatible !== true
            ? ['coverage-generation-unproven']
            : []),
        ...(missingCoverage.continuityComplete !== true
          ? ['history-continuity-unproven']
          : []),
      ])
      const segment = Object.freeze({
        key: `unresolved:${positionKey}:fill-basis-missing`,
        positionKey,
        symbol,
        leg: snapshot.leg,
        coveredFrom: missingCoverage.coveredFrom,
        coveredTo: missingCoverage.coveredTo,
        open: true,
        fillIdentities: Object.freeze([]),
        fillIds: Object.freeze([]),
        tradeIds: Object.freeze([]),
        fillContributions: Object.freeze([]),
        tradeCoverage: Object.freeze({ complete: false, status: 'missing', fills: 0, identified: 0 }),
        commissionCoverage: Object.freeze({ complete: false, status: 'missing', fills: 0 }),
        coverage: missingCoverage,
        reasons: missingReasons,
      })
      unresolved.push(segment)
      positionResults.set(positionKey, Object.freeze({
        version: FUTURES_TRADE_ROUND_INDEX_VERSION,
        positionKey,
        symbol,
        leg: snapshot.leg,
        coverage: segment.coverage,
        terminal: Object.freeze({ quantity: null, side: null, entryPrice: null, reconciled: false }),
        roundKeys: Object.freeze([]),
        unresolvedKeys: Object.freeze([segment.key]),
      }))
    }
  }

  const legacyRounds = Object.freeze(candidates.sort(newestFirst))
  const rounds = Object.freeze(legacyRounds.filter(round => round.resolved))
  const conservationByPosition = [...fillConservationResults.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
  const affectedPositionKeys = Object.freeze(conservationByPosition
    .filter(([, audit]) => audit.conserved !== true)
    .map(([positionKey]) => positionKey))
  return Object.freeze({
    version: FUTURES_TRADE_ROUND_INDEX_VERSION,
    rounds,
    all: rounds,
    closed: Object.freeze(rounds.filter(round => round.open !== true)),
    open: Object.freeze(rounds.filter(round => round.open === true)),
    unresolved: Object.freeze(unresolved),
    byPosition: Object.freeze(Object.fromEntries(positionResults)),
    fillConservation: Object.freeze({
      conserved: affectedPositionKeys.length === 0,
      affectedPositionKeys,
      byPosition: Object.freeze(Object.fromEntries(conservationByPosition)),
    }),
    // Transitional only: existing callers keep their old candidate rows until
    // they migrate to `rounds` + `unresolved` in the following production tasks.
    legacyRounds,
  })
}

export const buildFuturesTradeRounds = (trades, options = {}) => {
  const usable = options !== null && typeof options === 'object' ? options : {}
  return buildFuturesTradeRoundIndex(trades, usable).legacyRounds
}

export default buildFuturesTradeRounds
