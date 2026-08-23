// One canonical, additive view of the money a Futures position moved.
//
// The exchange states fill money and account income through different records:
// realized PnL is signed, fill commission is an unsigned cost, while funding,
// insurance and rebates are already signed income. This module brings those
// records into one exact-decimal ledger and gives every entry one owner. It does
// not convert assets and it never copies a contract-level adjustment into every
// round whose timestamps happen to overlap it.

import {
  normalizeFuturesTradeHistoryAsset,
  normalizeFuturesTradeHistorySymbol,
  normalizeFuturesTradeHistoryTime,
} from './futuresTradeHistoryEvidence.js'

const DECIMAL_PATTERN = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
const MAX_DECIMAL_TEXT_LENGTH = 2048
const MAX_DECIMAL_DIGITS = 1024
const MAX_DECIMAL_SCALE = 1024
const MAX_DECIMAL_EXPONENT = 1024
const COVERAGE_COMPLETE = 'complete'
const COVERAGE_PARTIAL = 'partial'
const COVERAGE_SHARED = 'shared'
const COVERAGE_UNKNOWN = 'unknown'
const POSITION_LEGS = new Set(['BOTH', 'LONG', 'SHORT'])
const COVERAGE_FROM_TIME_KEYS = Object.freeze(['coveredFrom', 'from'])
const COVERAGE_TO_TIME_KEYS = Object.freeze(['coveredTo', 'to', 'readAt'])

const INCOME_LANES = Object.freeze(['funding', 'insurance', 'commissionCredit'])
const QUALIFICATION_LANE = Object.freeze({
  funding: 'FUNDING',
  insurance: 'INSURANCE',
  commissionCredit: 'COMMISSION_CREDIT',
})

export const FUTURES_WALLET_LEDGER_COMPONENTS = Object.freeze([
  'realized',
  'grossCommission',
  'commissionCredit',
  'funding',
  'insurance',
])

const freezeArray = values => Object.freeze([...values])

const normalizedText = (value) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

const normalizedSymbol = value => normalizeFuturesTradeHistorySymbol(value)

const normalizedAsset = value => normalizeFuturesTradeHistoryAsset(value)

const normalizedLeg = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 16) return null
  const normalized = value.trim().toUpperCase()
  return POSITION_LEGS.has(normalized) ? normalized : null
}

const finiteTime = value => normalizeFuturesTradeHistoryTime(value)

const rejectedCanonicalField = (raw, canonical) => (
  normalizedText(raw) !== null && canonical === null
)

const coverageTimeValue = (value, keys) => {
  let first
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) continue
    const time = finiteTime(value[key])
    if (time === null) return null
    if (first === undefined) {
      first = time
      continue
    }
    if (time !== first) return null
  }
  return first
}

const compactDecimal = (coefficient, initialScale) => {
  let scale = initialScale
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n
    scale -= 1
  }
  return { coefficient, scale }
}

const decimalOf = (value) => {
  if (typeof value === 'bigint') {
    const magnitude = value < 0n ? -value : value
    return String(magnitude).length <= MAX_DECIMAL_DIGITS
      ? { coefficient: value, scale: 0 }
      : null
  }
  const text = typeof value === 'number'
    ? (Number.isFinite(value) ? String(value) : null)
    : normalizedText(value)
  if (text === null || text.length > MAX_DECIMAL_TEXT_LENGTH) return null
  const match = DECIMAL_PATTERN.exec(text)
  if (match === null) return null
  const negative = match[1] === '-'
  const whole = match[2] ?? '0'
  const fraction = match[3] ?? match[4] ?? ''
  const exponent = Number(match[5] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0'
  let scale = fraction.length - exponent
  if (scale > MAX_DECIMAL_SCALE) return null
  const expansion = scale < 0 ? -scale : 0
  if (digits.length + expansion > MAX_DECIMAL_DIGITS) return null
  let coefficient = BigInt(digits)
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale)
    scale = 0
  }
  if (negative && coefficient !== 0n) coefficient = -coefficient
  return compactDecimal(coefficient, scale)
}

const decimalText = ({ coefficient, scale }) => {
  if (coefficient === 0n) return '0'
  const negative = coefficient < 0n
  const digits = String(negative ? -coefficient : coefficient).padStart(scale + 1, '0')
  const unsigned = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`
  return negative ? `-${unsigned}` : unsigned
}

const addDecimal = (left, right) => {
  if (left === null) return { ...right }
  if (right === null) return { ...left }
  const scale = Math.max(left.scale, right.scale)
  const leftCoefficient = left.coefficient * (10n ** BigInt(scale - left.scale))
  const rightCoefficient = right.coefficient * (10n ** BigInt(scale - right.scale))
  return compactDecimal(leftCoefficient + rightCoefficient, scale)
}

// Presentation projections sometimes need a component subtotal rather than a
// complete ledger bucket. Keep that arithmetic on the same bounded exact
// decimal implementation; returning null on one malformed value is safer than
// silently dropping money from a subtotal.
export const sumFuturesWalletDecimalAmounts = (values) => {
  if (!Array.isArray(values) || values.length === 0) return null
  let total = null
  for (const value of values) {
    const amount = decimalOf(value)
    if (amount === null) return null
    total = addDecimal(total, amount)
  }
  return total === null ? null : decimalText(total)
}

const negativeMagnitude = (value) => {
  const decimal = decimalOf(value)
  if (decimal === null) return null
  return {
    coefficient: decimal.coefficient === 0n
      ? 0n
      : -(decimal.coefficient < 0n ? -decimal.coefficient : decimal.coefficient),
    scale: decimal.scale,
  }
}

const decimalMap = (entries) => {
  const totals = new Map()
  for (const entry of entries) {
    const amount = decimalOf(entry.amount)
    if (amount === null) continue
    totals.set(entry.asset, addDecimal(totals.get(entry.asset) ?? null, amount))
  }
  return totals
}

const totalsFromMap = (totals, settlementAsset, { includeZeroAssets = false } = {}) => {
  const allTotals = [...totals.entries()]
  const nonZeroTotals = allTotals
    .filter(([, amount]) => amount.coefficient !== 0n)
  const settlementTotal = allTotals.find(([asset]) => asset === settlementAsset)
  const visibleTotals = includeZeroAssets
    ? allTotals
    : nonZeroTotals.length > 0
      ? nonZeroTotals
      : settlementTotal === undefined ? [] : [settlementTotal]
  return freezeArray(
    visibleTotals
      .map(([asset, amount]) => Object.freeze({ asset, amount: decimalText(amount) }))
      .sort((left, right) => {
        if (left.asset === settlementAsset) return -1
        if (right.asset === settlementAsset) return 1
        return left.asset < right.asset ? -1 : left.asset > right.asset ? 1 : 0
      }),
  )
}

const sameDecimalMaps = (left, right) => {
  const assets = new Set([...left.keys(), ...right.keys()])
  for (const asset of assets) {
    const leftAmount = left.get(asset) ?? decimalOf('0')
    const rightAmount = right.get(asset) ?? decimalOf('0')
    if (leftAmount.scale === rightAmount.scale
      && leftAmount.coefficient === rightAmount.coefficient) continue
    const scale = Math.max(leftAmount.scale, rightAmount.scale)
    const leftCoefficient = leftAmount.coefficient * (10n ** BigInt(scale - leftAmount.scale))
    const rightCoefficient = rightAmount.coefficient * (10n ** BigInt(scale - rightAmount.scale))
    if (leftCoefficient !== rightCoefficient) return false
  }
  return true
}

const coverageState = (value, { from = null, to = null } = {}) => {
  if (value === true) return COVERAGE_COMPLETE
  if (value === false) return COVERAGE_PARTIAL
  if (typeof value === 'string') {
    const state = value.trim().toLowerCase()
    if (state === COVERAGE_COMPLETE || state === 'covered' || state === 'resolved') {
      return COVERAGE_COMPLETE
    }
    if (state === COVERAGE_PARTIAL || state === 'incomplete' || state === 'truncated') {
      return COVERAGE_PARTIAL
    }
    if (state === 'idle' || state === 'loading' || state === 'stale'
      || state === 'error' || state === 'failed') return COVERAGE_PARTIAL
    if (state === COVERAGE_SHARED) return COVERAGE_SHARED
    return COVERAGE_UNKNOWN
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return COVERAGE_UNKNOWN
  }
  const stated = coverageState(value.state ?? value.status)
  if (stated === COVERAGE_PARTIAL || stated === COVERAGE_SHARED) return stated
  if (value.complete === false || value.pageLimited === true || value.retentionLimited === true) {
    return COVERAGE_PARTIAL
  }
  const coveredFrom = coverageTimeValue(value, COVERAGE_FROM_TIME_KEYS)
  const coveredTo = coverageTimeValue(value, COVERAGE_TO_TIME_KEYS)
  if (coveredFrom === null || coveredTo === null) return COVERAGE_PARTIAL
  if (from !== null && coveredFrom !== null && coveredFrom > from) return COVERAGE_PARTIAL
  if (to !== null && coveredTo !== null && coveredTo < to) return COVERAGE_PARTIAL
  if (value.complete === true || stated === COVERAGE_COMPLETE) return COVERAGE_COMPLETE
  return COVERAGE_UNKNOWN
}

const coverageReading = state => Object.freeze({
  state,
  complete: state === COVERAGE_COMPLETE,
})

const incomeCoverageValue = (incomeCoverage, symbol, lane) => {
  if (incomeCoverage === null || incomeCoverage === undefined) return null
  if (typeof incomeCoverage !== 'object' || Array.isArray(incomeCoverage)) return incomeCoverage
  const bySymbol = incomeCoverage.bySymbol ?? incomeCoverage.symbols
  const symbolCoverage = bySymbol !== null && typeof bySymbol === 'object'
    ? bySymbol[symbol]
    : null
  const scoped = symbolCoverage ?? incomeCoverage
  if (scoped === null || typeof scoped !== 'object' || Array.isArray(scoped)) return scoped
  const lanes = scoped.lanes ?? scoped.incomeCoverageByLane
  if (lanes !== null && typeof lanes === 'object' && lanes[lane] !== undefined) {
    return lanes[lane]
  }
  if (scoped[lane] !== undefined) return scoped[lane]
  return scoped
}

const explicitIncomeIdentity = (row, component) => {
  const explicit = normalizedText(row?.identity ?? row?.entryId ?? row?.key ?? row?.id)
  if (explicit !== null) {
    return {
      id: `income:${explicit}`,
      // The canonical resource always supplies a key. Only its transaction-key
      // form preserves an exchange identity; the row-key form is derived from
      // content and can deduplicate delivery without proving uniqueness.
      reliable: !explicit.startsWith('fsi:v2:row:'),
    }
  }
  const transaction = normalizedText(row?.tranId ?? row?.transactionId)
  if (transaction !== null) {
    const kind = normalizedText(row?.incomeType ?? component) ?? component
    return { id: `income:${kind}:${transaction}`, reliable: true }
  }
  return null
}

const encoded = value => encodeURIComponent(value ?? '')

const fallbackIncomeIdentity = ({ row, component, symbol, asset, amount, time, tradeId }) => ({
  id: `income:fallback:${[
    row?.incomeType ?? component,
    symbol,
    asset,
    amount,
    time,
    tradeId,
  ].map(value => encoded(String(value ?? ''))).join(':')}`,
  reliable: false,
})

const incomeComponent = (row) => {
  const type = normalizedText(row?.incomeType)?.toUpperCase() ?? null
  if (type === 'FUNDING_FEE') return 'funding'
  if (type === 'INSURANCE_CLEAR') return 'insurance'
  if (type === 'COMMISSION_REBATE'
    || type === 'REFERRAL_KICKBACK'
    || type === 'API_REBATE'
    || type === 'FEE_RETURN') return 'commissionCredit'
  if (type === 'REALIZED_PNL' || type === 'COMMISSION') return null
  const component = normalizedText(row?.component)?.replace(/[^a-z]/gi, '').toLowerCase()
  if (component === 'funding' || component === 'fundingfee') return 'funding'
  if (component === 'insurance' || component === 'insuranceclear') return 'insurance'
  if (component === 'commissioncredit' || component === 'rebate') return 'commissionCredit'
  if (component === 'commission' && row?.derivable !== true) return 'commissionCredit'
  return null
}

const incomeLane = component => (
  component === 'insurance' ? 'insurance'
    : component === 'commissionCredit' ? 'commissionCredit'
      : 'funding'
)

const roundIdentifier = (round, index, symbol, leg) => {
  const raw = normalizedText(round?.roundId ?? round?.key ?? round?.id)
  return {
    id: `${symbol ?? 'UNKNOWN'}:${leg ?? 'UNKNOWN'}:${raw ?? `round-${index}`}`,
    raw: raw ?? `round-${index}`,
    reliable: raw !== null && symbol !== null && leg !== null,
  }
}

const fillIdentities = round => freezeArray(
  [...new Set((Array.isArray(round?.fillIds)
    ? round.fillIds
    : Array.isArray(round?.tradeIds) ? round.tradeIds : [])
    .map(normalizedText)
    .filter(value => value !== null))],
)

const normalizeRounds = (rounds, invalidInputs, identityConflicts) => {
  const held = []
  const ownerIds = new Set()
  for (const [index, round] of (Array.isArray(rounds) ? rounds : []).entries()) {
    if (round === null || typeof round !== 'object') {
      invalidInputs.push(Object.freeze({ source: 'round', index, reason: 'INVALID_ROUND' }))
      continue
    }
    const rawSymbol = round.symbol
    const rawLeg = round.leg ?? round.positionSide
    const symbol = normalizedSymbol(rawSymbol)
    const leg = normalizedLeg(rawLeg)
    const symbolRejected = rejectedCanonicalField(rawSymbol, symbol)
    const legRejected = rejectedCanonicalField(rawLeg, leg)
    const identity = roundIdentifier(round, index, symbol, leg)
    let ownerId = identity.id
    let reliable = identity.reliable
    if (ownerIds.has(ownerId)) {
      identityConflicts.push(Object.freeze({ id: ownerId, source: 'round' }))
      ownerId = `${ownerId}#${index}`
      reliable = false
    }
    ownerIds.add(ownerId)
    const settlementAsset = normalizedAsset(round.settlementAsset)
    const settlementAssetRejected = rejectedCanonicalField(
      round.settlementAsset,
      settlementAsset,
    )
    const openTime = finiteTime(round.openTime)
    const closeTime = finiteTime(round.closeTime)
    const temporalEvidenceComplete = openTime !== null
      && closeTime !== null
      && openTime <= closeTime
    if (symbolRejected) {
      invalidInputs.push(Object.freeze({
        source: 'round', ownerId, reason: 'INVALID_ROUND_SYMBOL',
      }))
    }
    if (legRejected) {
      invalidInputs.push(Object.freeze({
        source: 'round', ownerId, reason: 'INVALID_ROUND_LEG',
      }))
    }
    if (settlementAsset === null) {
      invalidInputs.push(Object.freeze({
        source: 'round', ownerId,
        reason: settlementAssetRejected
          ? 'INVALID_SETTLEMENT_ASSET'
          : 'MISSING_SETTLEMENT_ASSET',
      }))
    }
    if (!temporalEvidenceComplete) {
      invalidInputs.push(Object.freeze({
        source: 'round', ownerId,
        reason: openTime === null || closeTime === null
          ? 'MISSING_ROUND_TIME'
          : 'INVALID_ROUND_INTERVAL',
      }))
    }
    held.push(Object.freeze({
      ownerId,
      roundId: identity.raw,
      symbol,
      leg,
      openTime,
      closeTime,
      open: round.open === true,
      fillIds: fillIdentities(round),
      tradeCoverage: round.tradeCoverage ?? round.coverage?.trade ?? null,
      commissionCoverage: round.commissionCoverage ?? round.coverage?.commission ?? null,
      incomeCoverageByLane: round.incomeCoverageByLane ?? round.coverage?.income ?? null,
      partial: round.partial === true || round.resolved === false
        || settlementAsset === null || !temporalEvidenceComplete,
      settlementAsset,
      realizedPnl: round.realizedPnlExact ?? round.realizedPnl,
      fee: round.feeExact ?? round.fee,
      feesByAsset: Array.isArray(round.feesByAsset) ? round.feesByAsset : null,
      identityReliable: reliable,
    }))
  }
  return held
}

const entrySignature = entry => JSON.stringify([
  entry.component,
  entry.amount,
  entry.asset,
  entry.symbol,
  entry.leg,
  entry.tradeId,
  entry.time,
  entry.coverageLane,
  entry.identityReliable,
])

const frozenEntry = entry => Object.freeze({
  id: entry.id,
  component: entry.component,
  amount: entry.amount,
  asset: entry.asset,
  source: entry.source,
  symbol: entry.symbol ?? null,
  leg: entry.leg ?? null,
  tradeId: entry.tradeId ?? null,
  time: entry.time ?? null,
  coverageLane: entry.coverageLane,
  identityReliable: entry.identityReliable === true,
})

const feeTotals = (round, invalidInputs) => {
  const totals = new Map()
  const fees = round.feesByAsset
  if (fees !== null) {
    for (const [index, fee] of fees.entries()) {
      const rawAsset = fee?.asset
      const assetMissing = rawAsset === null || rawAsset === undefined
        || (typeof rawAsset === 'string' && rawAsset.trim() === '')
      const asset = assetMissing ? round.settlementAsset : normalizedAsset(rawAsset)
      const amount = negativeMagnitude(fee?.amountExact ?? fee?.amount)
      if (asset === null || amount === null) {
        invalidInputs.push(Object.freeze({
          source: 'round', ownerId: round.ownerId, index,
          reason: asset === null
            ? assetMissing ? 'MISSING_COMMISSION_ASSET' : 'INVALID_COMMISSION_ASSET'
            : 'INVALID_COMMISSION',
        }))
        continue
      }
      totals.set(asset, addDecimal(totals.get(asset) ?? null, amount))
    }
    return totals
  }
  if (round.fee === null || round.fee === undefined) return totals
  if (round.settlementAsset === null) {
    invalidInputs.push(Object.freeze({
      source: 'round', ownerId: round.ownerId, reason: 'MISSING_COMMISSION_ASSET',
    }))
    return totals
  }
  const amount = negativeMagnitude(round.fee)
  if (amount === null) {
    invalidInputs.push(Object.freeze({
      source: 'round', ownerId: round.ownerId, reason: 'INVALID_COMMISSION',
    }))
    return totals
  }
  totals.set(round.settlementAsset, amount)
  return totals
}

const intervalEnd = round => (
  // `closeTime` on an open round is only its latest fill. Funding after that
  // fill still belongs to the live position, so an open interval has no upper
  // bound until the position snapshot proves it closed.
  round.open ? Number.POSITIVE_INFINITY : round.closeTime
)

const compareIntervalRecords = (left, right) => (
  left.round.openTime - right.round.openTime
  || left.end - right.end
  || left.round.ownerId.localeCompare(right.round.ownerId)
)

const finalizedIntervalGroup = (records) => {
  records.sort(compareIntervalRecords)
  const prefixMaximumEnd = []
  let maximum = Number.NEGATIVE_INFINITY
  for (const [index, record] of records.entries()) {
    maximum = Math.max(maximum, record.end)
    prefixMaximumEnd[index] = maximum
  }
  return Object.freeze({
    records: freezeArray(records),
    prefixMaximumEnd: freezeArray(prefixMaximumEnd),
  })
}

const roundIntervalIndex = (rounds) => {
  const bySymbol = new Map()
  const bySymbolLeg = new Map()
  const append = (groups, key, record) => {
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  for (const round of rounds) {
    const end = intervalEnd(round)
    if (round.symbol === null || round.leg === null || round.openTime === null
      || end === null || round.openTime > end) continue
    const record = Object.freeze({ round, end })
    append(bySymbol, round.symbol, record)
    append(bySymbolLeg, `${round.symbol}:${round.leg}`, record)
  }
  const finalize = groups => new Map(
    [...groups].map(([key, records]) => [key, finalizedIntervalGroup(records)]),
  )
  return Object.freeze({
    bySymbol: finalize(bySymbol),
    bySymbolLeg: finalize(bySymbolLeg),
  })
}

const intervalMatches = (entry, index) => {
  // A timestamp is not contract identity. Without a canonical symbol, scanning
  // every contract can assign malformed funding to whichever unrelated round is
  // the sole interval open at that instant.
  if (entry.time === null || entry.symbol === null) return []
  const group = entry.leg === null
    ? index.bySymbol.get(entry.symbol)
    : index.bySymbolLeg.get(`${entry.symbol}:${entry.leg}`)
  if (group === undefined) return []

  let low = 0
  let high = group.records.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (group.records[middle].round.openTime <= entry.time) low = middle + 1
    else high = middle
  }

  const matches = []
  for (let indexPosition = low - 1; indexPosition >= 0; indexPosition -= 1) {
    if (group.prefixMaximumEnd[indexPosition] < entry.time) break
    const record = group.records[indexPosition]
    if (record.end >= entry.time) matches.push(record.round)
  }
  // The reverse scan is only the lookup strategy. Return the index's stable
  // ascending order so ownership/audit output never depends on input ordering.
  return matches.reverse()
}

const intervalBoundaryIsAmbiguous = (entry, rounds) => rounds.some(round => (
  entry.time === round.openTime
  || (round.open !== true && entry.time === round.closeTime)
))

const roundScopePairKey = (symbol, leg) => JSON.stringify([symbol, leg])

const causalAffectedScope = entry => Object.freeze({
  symbol: entry.symbol,
  leg: entry.leg,
  openedAtOrBefore: entry.time,
})

const emptyRoundScopeSummary = () => ({
  closed: { earliestOpenTime: null, hasUnknownOpenTime: false },
  open: { earliestOpenTime: null, hasUnknownOpenTime: false },
})

const appendRoundScopeSummary = (summaries, key, round) => {
  if (!summaries.has(key)) summaries.set(key, emptyRoundScopeSummary())
  const state = round.open === true ? 'open' : 'closed'
  const reading = summaries.get(key)[state]
  if (round.openTime === null) {
    reading.hasUnknownOpenTime = true
    return
  }
  reading.earliestOpenTime = reading.earliestOpenTime === null
    ? round.openTime
    : Math.min(reading.earliestOpenTime, round.openTime)
}

const roundScopeSummaryIndex = (rounds) => {
  const account = emptyRoundScopeSummary()
  const byLeg = new Map()
  const bySymbol = new Map()
  const bySymbolLeg = new Map()
  for (const round of rounds) {
    const state = round.open === true ? 'open' : 'closed'
    const accountReading = account[state]
    if (round.openTime === null) accountReading.hasUnknownOpenTime = true
    else {
      accountReading.earliestOpenTime = accountReading.earliestOpenTime === null
        ? round.openTime
        : Math.min(accountReading.earliestOpenTime, round.openTime)
    }
    if (round.leg !== null) appendRoundScopeSummary(byLeg, round.leg, round)
    if (round.symbol !== null) appendRoundScopeSummary(bySymbol, round.symbol, round)
    if (round.symbol !== null && round.leg !== null) {
      appendRoundScopeSummary(
        bySymbolLeg,
        roundScopePairKey(round.symbol, round.leg),
        round,
      )
    }
  }
  return { account, byLeg, bySymbol, bySymbolLeg }
}

const summaryForAffectedScope = (index, scope) => {
  if (scope.symbol !== null && scope.leg !== null) {
    return index.bySymbolLeg.get(roundScopePairKey(scope.symbol, scope.leg)) ?? null
  }
  if (scope.symbol !== null) return index.bySymbol.get(scope.symbol) ?? null
  if (scope.leg !== null) return index.byLeg.get(scope.leg) ?? null
  return index.account
}

const affectedScopeReachesState = (index, scope, state) => {
  const reading = summaryForAffectedScope(index, scope)?.[state]
  if (reading === undefined) return false
  return reading.hasUnknownOpenTime
    || (reading.earliestOpenTime !== null
      && reading.earliestOpenTime <= scope.openedAtOrBefore)
}

const emptyCausalCutoffIndex = () => ({
  account: null,
  byLeg: new Map(),
  bySymbol: new Map(),
  bySymbolLeg: new Map(),
})

const retainNewestCutoff = (cutoffs, key, cutoff) => {
  cutoffs.set(key, Math.max(cutoffs.get(key) ?? Number.NEGATIVE_INFINITY, cutoff))
}

const recordAffectedScopeCutoff = (index, scope) => {
  const cutoff = scope.openedAtOrBefore
  if (scope.symbol !== null && scope.leg !== null) {
    retainNewestCutoff(index.bySymbolLeg, roundScopePairKey(scope.symbol, scope.leg), cutoff)
  } else if (scope.symbol !== null) retainNewestCutoff(index.bySymbol, scope.symbol, cutoff)
  else if (scope.leg !== null) retainNewestCutoff(index.byLeg, scope.leg, cutoff)
  else index.account = Math.max(index.account ?? Number.NEGATIVE_INFINITY, cutoff)
}

const roundReachesAffectedCutoff = (index, round) => {
  const candidates = [index.account]
  if (round.leg !== null) candidates.push(index.byLeg.get(round.leg) ?? null)
  if (round.symbol !== null) candidates.push(index.bySymbol.get(round.symbol) ?? null)
  if (round.symbol !== null && round.leg !== null) {
    candidates.push(index.bySymbolLeg.get(
      roundScopePairKey(round.symbol, round.leg),
    ) ?? null)
  }
  const applicable = candidates.filter(cutoff => cutoff !== null)
  if (applicable.length === 0) return false
  const newestCutoff = Math.max(...applicable)
  return round.openTime === null || round.openTime <= newestCutoff
}

const ownerBucket = (buckets, key, metadata) => {
  if (!buckets.has(key)) buckets.set(key, { ...metadata, entries: [] })
  return buckets.get(key)
}

const qualificationsFor = ({
  tradeCoverage,
  commissionCoverage,
  incomeCoverageByLane,
  assetCount,
  additive,
  identityReliable,
}) => {
  const qualifications = []
  if (!tradeCoverage.complete) qualifications.push('TRADE_COVERAGE_INCOMPLETE')
  if (!commissionCoverage.complete) qualifications.push('COMMISSION_COVERAGE_INCOMPLETE')
  for (const lane of INCOME_LANES) {
    const coverage = incomeCoverageByLane[lane]
    if (coverage.state === COVERAGE_SHARED) qualifications.push(`${QUALIFICATION_LANE[lane]}_SHARED`)
    else if (!coverage.complete) {
      qualifications.push(`${QUALIFICATION_LANE[lane]}_COVERAGE_INCOMPLETE`)
    }
  }
  if (assetCount > 1) qualifications.push('MULTI_ASSET')
  if (!additive) qualifications.push('OWNERSHIP_NOT_ADDITIVE')
  if (!identityReliable) qualifications.push('IDENTITY_UNRELIABLE')
  return freezeArray(qualifications)
}

const aggregateBucket = ({
  bucket,
  settlementAsset,
  additive,
  round = null,
  incomeCoverage = null,
  sharedLanes = null,
  affectedByUnreliableIdentity = false,
  conflictedEntryIds = null,
}) => {
  const entries = freezeArray(bucket.entries)
  const components = freezeArray([...new Set(entries.map(entry => entry.component))].sort())
  const visibleNet = totalsFromMap(decimalMap(entries), settlementAsset)
  if (round === null) {
    const identityReliable = entries.every(entry => entry.identityReliable)
    const identityConflict = entries.some(entry => conflictedEntryIds?.has(entry.id) === true)
    return Object.freeze({
      ...bucket,
      entries,
      entryIds: freezeArray(entries.map(entry => entry.id)),
      components,
      assets: freezeArray(visibleNet.map(total => total.asset)),
      visibleNet,
      walletNet: null,
      additive: additive && identityReliable && !identityConflict,
      identityReliable,
      identityConflict,
      qualifications: freezeArray([
        ...(identityConflict ? ['IDENTITY_CONFLICT'] : []),
        ...(identityReliable ? [] : ['IDENTITY_UNRELIABLE']),
      ]),
    })
  }
  const interval = { from: round.openTime, to: round.closeTime }
  const tradeState = round.partial
    ? COVERAGE_PARTIAL
    : coverageState(round.tradeCoverage, interval)
  const commissionState = round.partial
    ? COVERAGE_PARTIAL
    : coverageState(round.commissionCoverage, interval)
  const incomeStates = {}
  for (const lane of INCOME_LANES) {
    const direct = round.incomeCoverageByLane !== null
      && typeof round.incomeCoverageByLane === 'object'
      ? round.incomeCoverageByLane[lane]
      : undefined
    const source = direct ?? incomeCoverageValue(incomeCoverage, round.symbol, lane)
    incomeStates[lane] = sharedLanes?.has(lane)
      ? COVERAGE_SHARED
      : coverageState(source, interval)
  }
  const tradeCoverage = coverageReading(tradeState)
  const commissionCoverage = coverageReading(commissionState)
  const incomeCoverageByLane = Object.freeze(Object.fromEntries(
    INCOME_LANES.map(lane => [lane, coverageReading(incomeStates[lane])]),
  ))
  const complete = tradeCoverage.complete
    && commissionCoverage.complete
    && INCOME_LANES.every(lane => incomeCoverageByLane[lane].complete)
  const identityReliable = round.identityReliable
    && entries.every(entry => entry.identityReliable)
    && !affectedByUnreliableIdentity
  const bucketAdditive = additive && identityReliable
  const qualifications = qualificationsFor({
    tradeCoverage,
    commissionCoverage,
    incomeCoverageByLane,
    assetCount: visibleNet.length,
    additive: bucketAdditive,
    identityReliable,
  })
  const walletNet = complete && bucketAdditive && visibleNet.length === 1
    ? visibleNet[0]
    : null
  return Object.freeze({
    ...bucket,
    entries,
    entryIds: freezeArray(entries.map(entry => entry.id)),
    components,
    assets: freezeArray(visibleNet.map(total => total.asset)),
    visibleNet,
    walletNet,
    additive: bucketAdditive,
    identityReliable,
    tradeCoverage,
    commissionCoverage,
    incomeCoverageByLane,
    qualifications,
  })
}

/**
 * Reconciles closed/open round money and underivable income into one additive
 * ledger. All returned amounts are canonical signed decimal strings.
 *
 * `rounds` are expected to carry stable `{symbol, leg|positionSide, key}`
 * identity, `fillIds`, exact `realizedPnl`, per-asset fees, and independent
 * trade/commission coverage. `incomeCoverage` may be one account-wide window or
 * `{bySymbol: {SYMBOL: {lanes: {funding, insurance, commissionCredit}}}}`.
 */
export const reconcileFuturesWalletLedger = ({
  rounds = [],
  income = [],
  incomeCoverage = null,
  settlementAsset = 'USDT',
} = {}) => {
  const normalizedSettlementAsset = normalizedAsset(settlementAsset) ?? 'USDT'
  const invalidInputs = []
  const identityConflicts = []
  const duplicateCounts = new Map()
  const conflictingEntriesById = new Map()
  const unreliableIdentityIds = new Set()
  const canonicalById = new Map()
  const canonicalEntries = []
  const canonicalIndexById = new Map()
  const normalizedRounds = normalizeRounds(rounds, invalidInputs, identityConflicts)
  const intervals = roundIntervalIndex(normalizedRounds)
  const scopeSummaries = roundScopeSummaryIndex(normalizedRounds)

  const addCanonical = (candidate) => {
    const entry = frozenEntry(candidate)
    const existing = canonicalById.get(entry.id)
    if (existing !== undefined) {
      duplicateCounts.set(entry.id, (duplicateCounts.get(entry.id) ?? 0) + 1)
      const existingSignature = entrySignature(existing)
      const candidateSignature = entrySignature(entry)
      if (existingSignature !== candidateSignature) {
        if (!conflictingEntriesById.has(entry.id)) {
          identityConflicts.push(Object.freeze({ id: entry.id, source: entry.source }))
          conflictingEntriesById.set(entry.id, new Map([
            [existingSignature, existing],
          ]))
        }
        // Conflict evidence is a set of distinct payloads, not a delivery log.
        // Repeated stream/bootstrap copies of the same rejected payload must not
        // change audit cardinality or retain another lane-sized object graph.
        const distinctEntries = conflictingEntriesById.get(entry.id)
        if (!distinctEntries.has(candidateSignature)) {
          distinctEntries.set(candidateSignature, entry)
        }
        // A conflicting exchange identity cannot become exact, but its visible
        // evidence must still be stable. Keep the lexicographically smallest
        // complete tuple instead of whichever payload happened to arrive first.
        if (candidateSignature < existingSignature) {
          canonicalById.set(entry.id, entry)
          canonicalEntries[canonicalIndexById.get(entry.id)] = entry
        }
        if (!entry.identityReliable) unreliableIdentityIds.add(entry.id)
      }
      return null
    }
    canonicalById.set(entry.id, entry)
    canonicalIndexById.set(entry.id, canonicalEntries.length)
    canonicalEntries.push(entry)
    if (!entry.identityReliable) unreliableIdentityIds.add(entry.id)
    return entry
  }

  const directRoundOwners = new Map()
  for (const round of normalizedRounds) {
    const realized = decimalOf(round.realizedPnl)
    if (realized !== null && round.settlementAsset !== null) {
      const entry = addCanonical({
        id: `round:${round.ownerId}:realized:${round.settlementAsset}`,
        component: 'realized',
        amount: decimalText(realized),
        asset: round.settlementAsset,
        source: 'round',
        symbol: round.symbol,
        leg: round.leg,
        tradeId: null,
        time: round.closeTime,
        coverageLane: 'trade',
        identityReliable: round.identityReliable,
      })
      if (entry !== null) directRoundOwners.set(entry.id, round.ownerId)
    } else if (realized === null
      && round.realizedPnl !== null
      && round.realizedPnl !== undefined) {
      invalidInputs.push(Object.freeze({
        source: 'round', ownerId: round.ownerId, reason: 'INVALID_REALIZED_PNL',
      }))
    }
    for (const [asset, amount] of feeTotals(round, invalidInputs)) {
      const entry = addCanonical({
        id: `round:${round.ownerId}:grossCommission:${asset}`,
        component: 'grossCommission',
        amount: decimalText(amount),
        asset,
        source: 'round',
        symbol: round.symbol,
        leg: round.leg,
        tradeId: null,
        time: round.closeTime,
        coverageLane: 'commission',
        identityReliable: round.identityReliable,
      })
      if (entry !== null) directRoundOwners.set(entry.id, round.ownerId)
    }
  }

  const skippedIncome = []
  for (const [index, row] of (Array.isArray(income) ? income : []).entries()) {
    const component = incomeComponent(row)
    if (component === null) {
      skippedIncome.push(Object.freeze({ index, reason: 'DERIVABLE_OR_UNSUPPORTED' }))
      continue
    }
    const rawSymbol = row?.symbol
    const rawLeg = row?.leg ?? row?.positionSide
    const symbol = normalizedSymbol(rawSymbol)
    const leg = normalizedLeg(rawLeg)
    const symbolRejected = rejectedCanonicalField(rawSymbol, symbol)
    const legRejected = rejectedCanonicalField(rawLeg, leg)
    const time = finiteTime(row?.time)
    const amountValue = row?.amount ?? row?.income
    const amount = decimalOf(amountValue)
    const asset = normalizedAsset(row?.asset)
    const assetRejected = rejectedCanonicalField(row?.asset, asset)
    const tradeId = normalizedText(row?.tradeId)
    if (symbolRejected) {
      invalidInputs.push(Object.freeze({
        source: 'income', index, component, symbol, leg, tradeId, time,
        reason: 'INVALID_INCOME_SYMBOL',
      }))
    }
    if (legRejected) {
      invalidInputs.push(Object.freeze({
        source: 'income', index, component, symbol, leg, tradeId, time,
        reason: 'INVALID_INCOME_LEG',
      }))
    }
    if (time === null || amount === null || asset === null) {
      invalidInputs.push(Object.freeze({
        source: 'income', index, component, symbol, leg, tradeId, time,
        reason: time === null
          ? 'INVALID_TIME'
          : amount === null
            ? 'INVALID_AMOUNT'
            : assetRejected ? 'INVALID_INCOME_ASSET' : 'MISSING_INCOME_ASSET',
      }))
      continue
    }
    const amountText = decimalText(amount)
    const identity = explicitIncomeIdentity(row, component)
      ?? fallbackIncomeIdentity({ row, component, symbol, asset, amount: amountText, time, tradeId })
    addCanonical({
      id: identity.id,
      component,
      amount: amountText,
      asset,
      source: 'income',
      symbol,
      leg,
      tradeId,
      time,
      coverageLane: incomeLane(component),
      identityReliable: identity.reliable && !symbolRejected && !legRejected,
    })
  }
  const incomeEntries = canonicalEntries.filter(entry => entry.source === 'income')

  const roundsByOwner = new Map(normalizedRounds.map(round => [round.ownerId, round]))
  const roundsByFill = new Map()
  for (const round of normalizedRounds) {
    for (const fillId of round.fillIds) {
      if (round.symbol === null) continue
      const fillKey = `${round.symbol}:${fillId}`
      if (!roundsByFill.has(fillKey)) roundsByFill.set(fillKey, new Set())
      roundsByFill.get(fillKey).add(round.ownerId)
    }
  }
  const evidenceBackedRoundOwnerIds = (entry) => {
    const ownerIds = new Set()
    if (entry.component === 'commissionCredit'
      && entry.symbol !== null
      && entry.tradeId !== null) {
      for (const ownerId of roundsByFill.get(`${entry.symbol}:${entry.tradeId}`) ?? []) {
        ownerIds.add(ownerId)
      }
    }
    for (const round of intervalMatches(entry, intervals)) ownerIds.add(round.ownerId)
    return ownerIds
  }

  const roundOwned = new Map()
  const legOwned = new Map()
  const contractShared = new Map()
  const accountShared = new Map()
  const assignments = []
  const assignedIds = new Set()
  const roundSharedLanes = new Map(normalizedRounds.map(round => [round.ownerId, new Set()]))
  const accountWidePositionSharedLanes = new Set()
  const roundsAffectedByUnreliableIdentity = new Set()
  const broadSharedCutoffsByLane = new Map(
    INCOME_LANES.map(lane => [lane, emptyCausalCutoffIndex()]),
  )
  const broadUnreliableCutoffs = emptyCausalCutoffIndex()
  const existingOwnerIds = ownerIds => freezeArray([...new Set(ownerIds)]
    .filter(candidate => roundsByOwner.has(candidate))
    .sort())

  const assign = (
    entry,
    kind,
    ownerId,
    matchedRoundIds = [],
    affectedRoundIds = matchedRoundIds,
    { affectedScope = null, presentationScope: requestedPresentationScope } = {},
  ) => {
    if (assignedIds.has(entry.id)) {
      identityConflicts.push(Object.freeze({ id: entry.id, source: 'ownership' }))
      return
    }
    assignedIds.add(entry.id)
    let bucket
    if (kind === 'roundOwned') {
      const round = roundsByOwner.get(ownerId)
      bucket = ownerBucket(roundOwned, ownerId, {
        ownerId,
        roundId: round?.roundId ?? ownerId,
        symbol: round?.symbol ?? entry.symbol,
        leg: round?.leg ?? entry.leg,
      })
    } else if (kind === 'legOwned') {
      bucket = ownerBucket(legOwned, ownerId, {
        ownerId,
        symbol: entry.symbol,
        leg: entry.leg,
      })
    } else if (kind === 'contractShared') {
      bucket = ownerBucket(contractShared, ownerId, { ownerId, symbol: entry.symbol })
    } else {
      bucket = ownerBucket(accountShared, ownerId, { ownerId })
    }
    bucket.entries.push(entry)
    const explicitMatches = existingOwnerIds(matchedRoundIds)
    const explicitAffected = existingOwnerIds(affectedRoundIds)
    if (kind === 'roundOwned') {
      assignments.push(Object.freeze({
        entryId: entry.id,
        kind,
        ownerId,
        matchedRoundIds: explicitMatches,
        affectedRoundIds: explicitAffected,
      }))
      return
    }
    const matched = explicitMatches.map(ownerId => roundsByOwner.get(ownerId)).filter(Boolean)
    const affected = explicitAffected.map(ownerId => roundsByOwner.get(ownerId)).filter(Boolean)
    // Preserve only round matches backed by the entry's fill/interval evidence.
    // An empty match set remains account-global and must not be rewritten later
    // into an arbitrary open or closed presentation scope by symbol or leg.
    const matches = freezeArray(matched.map(round => round.ownerId))
    const affectedIds = freezeArray(affected.map(round => round.ownerId))
    const presentationScope = requestedPresentationScope ?? (
      affected.some(round => round.open !== true)
        ? 'closed'
        : affected.some(round => round.open === true)
          ? 'open'
          : entry.component === 'commissionCredit' ? 'closed' : null
    )
    assignments.push(Object.freeze({
      entryId: entry.id,
      kind,
      ownerId,
      matchedRoundIds: matches,
      affectedRoundIds: affectedIds,
      affectedScope,
      presentationScope,
    }))
    for (const round of affected) {
      roundSharedLanes.get(round.ownerId)?.add(entry.coverageLane)
      if (!entry.identityReliable) roundsAffectedByUnreliableIdentity.add(round.ownerId)
    }
  }

  for (const [entryId, ownerId] of directRoundOwners) {
    assign(canonicalById.get(entryId), 'roundOwned', ownerId, [ownerId])
  }

  for (const entry of incomeEntries) {
    if (entry.component === 'commissionCredit'
      && entry.symbol !== null
      && entry.tradeId !== null) {
      const owners = [...(roundsByFill.get(`${entry.symbol}:${entry.tradeId}`) ?? [])]
      if (owners.length === 1) {
        assign(entry, 'roundOwned', owners[0], owners)
        continue
      }
      if (owners.length > 1) {
        const ownerLegs = [...new Set(owners
          .map(ownerId => roundsByOwner.get(ownerId)?.leg)
          .filter(Boolean))]
        if (ownerLegs.length === 1) {
          assign(entry, 'legOwned', `${entry.symbol}:${ownerLegs[0]}`, owners)
        } else {
          assign(entry, 'contractShared', entry.symbol, owners)
        }
        continue
      }
    }
    const matches = intervalMatches(entry, intervals).map(round => round.ownerId)
    if (entry.component === 'funding' || entry.component === 'insurance') {
      const matchedRounds = matches.map(ownerId => roundsByOwner.get(ownerId)).filter(Boolean)
      if (matches.length === 1 && !intervalBoundaryIsAmbiguous(entry, matchedRounds)) {
        assign(entry, 'roundOwned', matches[0], matches)
      } else if (entry.symbol !== null) {
        assign(entry, 'contractShared', entry.symbol, matches)
      } else {
        // This path is defense in depth for direct ledger callers. Canonical
        // resources reject position-scoped income without a symbol, but if one
        // bypasses that boundary its money must remain account-global and no
        // contract may claim exact Net while the affected contract is unknown.
        accountWidePositionSharedLanes.add(entry.coverageLane)
        assign(entry, 'accountShared', 'account', matches)
      }
      continue
    }
    // A rebate's posting timestamp is not its fill identity. In particular, a
    // delayed closing-fill credit can arrive after the next round has opened;
    // assigning it from overlap alone makes the old Closed NET falsely exact.
    const affectedScope = causalAffectedScope(entry)
    recordAffectedScopeCutoff(
      broadSharedCutoffsByLane.get(entry.coverageLane),
      affectedScope,
    )
    if (!entry.identityReliable) {
      recordAffectedScopeCutoff(broadUnreliableCutoffs, affectedScope)
    }
    const presentationScope = affectedScopeReachesState(
      scopeSummaries,
      affectedScope,
      'closed',
    )
      ? 'closed'
      : affectedScopeReachesState(scopeSummaries, affectedScope, 'open')
        ? 'open'
        : 'closed'
    if (entry.symbol !== null && entry.leg !== null) {
      assign(entry, 'legOwned', `${entry.symbol}:${entry.leg}`, [], [], {
        affectedScope,
        presentationScope,
      })
    } else if (entry.symbol !== null) {
      assign(entry, 'contractShared', entry.symbol, [], [], {
        affectedScope,
        presentationScope,
      })
    } else {
      assign(entry, 'accountShared', 'account', [], [], {
        affectedScope,
        presentationScope,
      })
    }
  }

  // Broad credits retain one compact causal cutoff per scope/lane. Applying
  // those cutoffs here makes qualification O(rounds * lanes + credits) and
  // avoids a credit-by-round assignment graph in React state.
  for (const round of normalizedRounds) {
    for (const lane of INCOME_LANES) {
      if (roundReachesAffectedCutoff(broadSharedCutoffsByLane.get(lane), round)) {
        roundSharedLanes.get(round.ownerId)?.add(lane)
      }
    }
    if (roundReachesAffectedCutoff(broadUnreliableCutoffs, round)) {
      roundsAffectedByUnreliableIdentity.add(round.ownerId)
    }
  }

  const canonicalIds = canonicalEntries.map(entry => entry.id)
  const unassignedEntryIds = canonicalIds.filter(id => !assignedIds.has(id))
  const canonicalTotals = decimalMap(canonicalEntries)
  const assignedEntries = assignments
    .map(assignment => canonicalById.get(assignment.entryId))
    .filter(entry => entry !== undefined)
  const assignedTotals = decimalMap(assignedEntries)
  const conserved = unassignedEntryIds.length === 0
    && assignedIds.size === canonicalEntries.length
    && sameDecimalMaps(canonicalTotals, assignedTotals)
  const additive = conserved
    && identityConflicts.length === 0
    && invalidInputs.length === 0

  // Audit is account-wide and therefore fails closed on any malformed or
  // conflicting input. A row bucket is narrower: a malformed ETH commission
  // must not make an otherwise complete BTC round lose its exact NET. Scope
  // known defects to the owner/interval they can actually affect while keeping
  // `audit.additive` false for the complete reconciliation.
  const roundsWithLocalDefects = new Set(invalidInputs
    .map(input => input.ownerId)
    .filter(Boolean))
  for (const conflict of identityConflicts) {
    if (conflict.source === 'round') {
      for (const round of normalizedRounds) {
        if (round.ownerId === conflict.id || round.ownerId.startsWith(`${conflict.id}#`)) {
          roundsWithLocalDefects.add(round.ownerId)
        }
      }
    }
  }
  const conflictedEntryIds = new Set(identityConflicts
    .map(conflict => conflict.id)
    .filter(id => canonicalById.has(id)))
  for (const assignment of assignments) {
    if (!conflictedEntryIds.has(assignment.entryId)) continue
    if (assignment.kind === 'roundOwned') roundsWithLocalDefects.add(assignment.ownerId)
    for (const ownerId of assignment.affectedRoundIds) roundsWithLocalDefects.add(ownerId)
  }
  const broadDefectCutoffs = emptyCausalCutoffIndex()
  for (const conflictingEntries of conflictingEntriesById.values()) {
    for (const entry of conflictingEntries.values()) {
      const evidenceBackedOwners = evidenceBackedRoundOwnerIds(entry)
      for (const ownerId of evidenceBackedOwners) {
        roundsWithLocalDefects.add(ownerId)
      }
      // A rejected payload must not disappear merely because it fell outside a
      // known interval. Retain that uncertainty as one compact causal scope.
      if (evidenceBackedOwners.size === 0) {
        recordAffectedScopeCutoff(broadDefectCutoffs, causalAffectedScope(entry))
      }
    }
  }
  for (const invalid of invalidInputs.filter(input => input.source === 'income')) {
    const probe = {
      component: invalid.component,
      symbol: invalid.symbol,
      leg: invalid.leg,
      tradeId: invalid.tradeId,
      time: invalid.time,
    }
    const matches = evidenceBackedRoundOwnerIds(probe)
    for (const ownerId of matches) roundsWithLocalDefects.add(ownerId)
    if (matches.size > 0) continue
    if (invalid.component === 'commissionCredit'
      || invalid.time === null
      || invalid.symbol === null) {
      recordAffectedScopeCutoff(broadDefectCutoffs, Object.freeze({
        symbol: invalid.symbol,
        leg: invalid.symbol === null ? null : invalid.leg,
        openedAtOrBefore: invalid.time ?? Number.POSITIVE_INFINITY,
      }))
    }
  }
  for (const round of normalizedRounds) {
    if (roundReachesAffectedCutoff(broadDefectCutoffs, round)) {
      roundsWithLocalDefects.add(round.ownerId)
    }
  }

  const roundOwnedResults = normalizedRounds.map((round) => {
    const bucket = roundOwned.get(round.ownerId) ?? {
      ownerId: round.ownerId,
      roundId: round.roundId,
      symbol: round.symbol,
      leg: round.leg,
      entries: [],
    }
    return aggregateBucket({
      bucket,
      settlementAsset: round.settlementAsset ?? normalizedSettlementAsset,
      additive: conserved && !roundsWithLocalDefects.has(round.ownerId),
      round,
      incomeCoverage,
      sharedLanes: new Set([
        ...accountWidePositionSharedLanes,
        ...(roundSharedLanes.get(round.ownerId) ?? []),
      ]),
      affectedByUnreliableIdentity: roundsAffectedByUnreliableIdentity.has(round.ownerId),
    })
  })
  const aggregateShared = buckets => freezeArray([...buckets.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([, bucket]) => aggregateBucket({
      bucket,
      settlementAsset: normalizedSettlementAsset,
      additive,
      conflictedEntryIds,
    })))
  const scopedSharedBuckets = (
    ownerIds,
    { includeGlobalCommissionCredits = false, scope = null } = {},
  ) => {
    const scoped = new Map()
    for (const assignment of assignments) {
      if (assignment.kind === 'roundOwned') continue
      const entry = canonicalById.get(assignment.entryId)
      if (entry === undefined) continue
      if (assignment.presentationScope !== null
        && assignment.presentationScope !== scope) continue
      const reachesScope = assignment.matchedRoundIds.some(ownerId => ownerIds.has(ownerId))
      const globalCommissionCredit = includeGlobalCommissionCredits
        && entry.component === 'commissionCredit'
        && assignment.matchedRoundIds.length === 0
      if (!reachesScope && !globalCommissionCredit) continue
      const kind = globalCommissionCredit ? 'unattributedShared' : assignment.kind
      const key = `${kind}:${assignment.kind}:${assignment.ownerId}`
      const source = assignment.kind === 'legOwned'
        ? legOwned.get(assignment.ownerId)
        : assignment.kind === 'contractShared'
          ? contractShared.get(assignment.ownerId)
          : accountShared.get(assignment.ownerId)
      const bucket = ownerBucket(scoped, key, {
        ownerId: assignment.ownerId,
        kind,
        symbol: source?.symbol ?? entry.symbol ?? null,
        leg: source?.leg ?? entry.leg ?? null,
      })
      bucket.entries.push(entry)
    }
    return scoped
  }
  const closedOwnerIds = new Set(normalizedRounds
    .filter(round => round.open !== true)
    .map(round => round.ownerId))
  const openOwnerIds = new Set(normalizedRounds
    .filter(round => round.open === true)
    .map(round => round.ownerId))
  const closedSharedBuckets = scopedSharedBuckets(closedOwnerIds, {
    // Binance can post a rebate after its fill closes. Until the row carries a
    // reliable trade identity, keep the real account movement visible once in
    // the Closed reconciliation without pretending one round owns it.
    includeGlobalCommissionCredits: true,
    scope: 'closed',
  })
  const openSharedBuckets = scopedSharedBuckets(openOwnerIds, {
    includeGlobalCommissionCredits: true,
    scope: 'open',
  })
  const projectedEntryIds = buckets => new Set([...buckets.values()]
    .flatMap(bucket => bucket.entries.map(entry => entry.id)))
  const closedProjectedEntryIds = projectedEntryIds(closedSharedBuckets)
  const openProjectedEntryIds = projectedEntryIds(openSharedBuckets)
  const presentationOverlapEntryIds = [...closedProjectedEntryIds]
    .filter(entryId => openProjectedEntryIds.has(entryId))
    .sort()
  const presentationDisjoint = presentationOverlapEntryIds.length === 0

  const visibleNet = totalsFromMap(canonicalTotals, normalizedSettlementAsset)
  const allRoundsComplete = roundOwnedResults.every(round => round.walletNet !== null)
  const walletNet = additive
    && unreliableIdentityIds.size === 0
    && allRoundsComplete
    && visibleNet.length === 1
    ? visibleNet[0]
    : null
  const duplicateInputIds = freezeArray([...duplicateCounts.keys()].sort())
  const stableIdentityConflicts = freezeArray([...identityConflicts]
    .sort((left, right) => left.id.localeCompare(right.id)
      || left.source.localeCompare(right.source)))
  const audit = Object.freeze({
    canonicalEntryIds: freezeArray(canonicalIds),
    assignedEntryIds: freezeArray([...assignedIds]),
    roundOwnedEntryIds: freezeArray(assignments
      .filter(assignment => assignment.kind === 'roundOwned').map(assignment => assignment.entryId)),
    legOwnedEntryIds: freezeArray(assignments
      .filter(assignment => assignment.kind === 'legOwned').map(assignment => assignment.entryId)),
    contractSharedEntryIds: freezeArray(assignments
      .filter(assignment => assignment.kind === 'contractShared').map(assignment => assignment.entryId)),
    accountSharedEntryIds: freezeArray(assignments
      .filter(assignment => assignment.kind === 'accountShared').map(assignment => assignment.entryId)),
    duplicateInputIds,
    duplicatesRejected: freezeArray([...duplicateCounts.entries()]
      .map(([id, count]) => Object.freeze({ id, count }))),
    unreliableIdentityIds: freezeArray([...unreliableIdentityIds]),
    unassignedEntryIds: freezeArray(unassignedEntryIds),
    identityConflicts: stableIdentityConflicts,
    invalidInputs: freezeArray(invalidInputs),
    skippedIncome: freezeArray(skippedIncome),
    canonicalTotals: totalsFromMap(canonicalTotals, normalizedSettlementAsset, {
      includeZeroAssets: true,
    }),
    assignedTotals: totalsFromMap(assignedTotals, normalizedSettlementAsset, {
      includeZeroAssets: true,
    }),
    conserved,
    disjoint: assignedIds.size === assignments.length,
    presentationDisjoint,
    presentationOverlapEntryIds: freezeArray(presentationOverlapEntryIds),
    additive,
  })

  return Object.freeze({
    settlementAsset: normalizedSettlementAsset,
    entries: freezeArray(canonicalEntries),
    assignments: freezeArray(assignments),
    ownership: Object.freeze({
      roundOwned: freezeArray(roundOwnedResults),
      legOwned: aggregateShared(legOwned),
      contractShared: aggregateShared(contractShared),
      accountShared: aggregateShared(accountShared),
      // Presentation scope for Closed Positions. It contains only shared
      // entries whose evidence-backed owner set reaches at least one closed
      // round, including interval-matched partial or unresolved rounds.
      closedShared: aggregateShared(closedSharedBuckets),
      // The live-position peer of `closedShared`. Contract/leg adjustments are
      // shown once outside the open rows only with fill/interval evidence.
      // Fully unmatched entries remain in their global shared buckets above.
      openShared: aggregateShared(openSharedBuckets),
    }),
    assets: freezeArray(visibleNet.map(total => total.asset)),
    visibleNet,
    walletNet,
    audit,
  })
}

export default reconcileFuturesWalletLedger
