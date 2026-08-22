import {
  FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
  MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE,
  canonicalFuturesIncomeRow,
  sanitizeFuturesSettledIncomeError,
} from './futuresSettledIncomeResource.js'

// What an open position has already put into or taken out of the wallet.
//
// The unrealized PnL beside it says what the position would produce if it were
// closed now. This says what it has produced already: the realized PnL of the
// parts closed out of it, the funding paid or received while it has been held,
// the commission charged on its fills, and the insurance clearance if it has
// ever been part-liquidated. On a position scaled out of several times and held
// across a funding boundary those are the larger number, and unlike the
// unrealized figure they are settled — the money is in the wallet and is not
// coming back out.
//
// Two conventions meet here and only one of them is used. Every amount below is
// the exchange's own `income`, which is signed its way: positive is an inflow,
// so funding paid, commission and insurance clearance all arrive negative and
// the total is their sum. A fill's `commission` is the opposite — an unsigned
// magnitude that has to be subtracted — and nothing on this path may mix the
// two, because doing so returns a fee to the operator as profit.

// Which kinds of flow are the position's own, and which of them the desk could
// have worked out for itself.
//
// A transfer in or out of the futures wallet is the operator moving money, not a
// position earning or costing it, and counting it would make a deposit read as a
// winning trade — so it is absent here entirely.
//
// `derivable` is the second question, and it is about *records* rather than
// about money. The trade record the desk reads anyway for its history panel
// states, per fill, what that fill realized and what it was charged for it; the
// income record states the same two things again, one row per fill, thirteen
// thousand of them in a week on the operator's account. A figure available from
// a record already in hand is not read a second time from a metered one — and
// where both are held, they are not added to each other either, which is what
// this flag prevents. Funding, insurance clearance and the rebates are marked
// underivable because nothing else states them: no fill names a funding charge,
// and no fill names a credit that came back after it.
const COMPONENT_OF_INCOME_TYPE = Object.freeze({
  REALIZED_PNL: Object.freeze({ component: 'realizedPnl', derivable: true }),
  FUNDING_FEE: Object.freeze({ component: 'funding', derivable: false }),
  COMMISSION: Object.freeze({ component: 'commission', derivable: true }),
  INSURANCE_CLEAR: Object.freeze({ component: 'insuranceClear', derivable: false }),
  // Rebates are commission coming back. They belong with the charge rather than
  // in a line of their own: what the operator wants to know is what the position
  // cost them to trade, and on a rebated account the gross charge is not it.
  COMMISSION_REBATE: Object.freeze({ component: 'commission', derivable: false }),
  REFERRAL_KICKBACK: Object.freeze({ component: 'commission', derivable: false }),
  API_REBATE: Object.freeze({ component: 'commission', derivable: false }),
  FEE_RETURN: Object.freeze({ component: 'commission', derivable: false }),
})

export const FUTURES_SETTLED_COMPONENTS = Object.freeze([
  'realizedPnl',
  'funding',
  'commission',
  'insuranceClear',
])

// The components a fill states on its own. Named once, here, because two places
// have to agree about it and a list that disagrees with the table above is a
// charge counted twice or not at all.
const DERIVABLE_COMPONENTS = Object.freeze(['realizedPnl', 'commission'])

// The kinds of flow no other record the desk reads can state, and therefore the
// only ones worth paying `/fapi/v1/income` for. Derived from the table above
// rather than written out again: a kind added there as underivable is a kind the
// desk must start asking for, and a second copy of this list is a kind that is
// folded but never read — money simply missing from the column, with nothing
// failing. The main process imports this and asks for exactly these.
export const FUTURES_UNDERIVABLE_INCOME_TYPES = Object.freeze(
  Object.entries(COMPONENT_OF_INCOME_TYPE)
    .filter(([, flow]) => flow.derivable !== true)
    .map(([incomeType]) => incomeType),
)

const toFiniteNumber = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toSafeSettledTime = (value) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && value.trim() === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

const FUTURES_SETTLED_RESOURCE_STATUSES = new Set([
  'idle', 'loading', 'ready', 'stale', 'error',
])

const settledAccountFingerprint = value => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null
}

const settledIncomeType = value => (
  typeof value === 'string' ? value.trim().toUpperCase() : ''
)

const canonicalIncomeRowOrder = (left, right) => (
  left.time - right.time
  || left.incomeType.localeCompare(right.incomeType)
  || left.identity.localeCompare(right.identity)
)

// Canonical constructors intentionally discard malformed rows and collapse
// repeated identities. That is useful while assembling exchange pages, but at
// the IPC trust boundary it would turn a complete lane into a shorter complete
// lane. Validate without loss before accepting any part of the candidate frame.
const canonicalIncomeRowsWithoutLoss = (
  rows,
  expectedIncomeType = null,
  maximumRows = MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE,
) => {
  if (!Array.isArray(rows) || rows.length > maximumRows) return null
  const byIdentity = new Map()
  for (const raw of rows) {
    const row = canonicalFuturesIncomeRow(raw)
    if (row === null || (expectedIncomeType !== null && row.incomeType !== expectedIncomeType)) {
      return null
    }
    // Reject both byte-equivalent repeats and contradictory values under one
    // identity. IPC frames are canonical snapshots, not exchange page input.
    if (byIdentity.has(row.identity)) return null
    byIdentity.set(row.identity, row)
  }
  return [...byIdentity.values()].sort(canonicalIncomeRowOrder)
}

const sameCanonicalIncomeRows = (left, right) => (
  left.length === right.length
  && left.every((row, index) => {
    const other = right[index]
    return row.identity === other.identity
      && row.symbol === other.symbol
      && row.incomeType === other.incomeType
      && row.income === other.income
      && row.asset === other.asset
      && row.time === other.time
      && row.tranId === other.tranId
      && row.tradeId === other.tradeId
  })
)

// A row is identified by its type and its transaction together. Binance states
// that `tranId` is unique only within one `incomeType`, so the id alone would
// collapse a real commission row onto the realized-PnL row it was charged
// beside — and a page boundary inside one millisecond hands the same row back
// twice, which is a funding charge counted twice if nothing catches it.
// Falls back to what the row *is* when the exchange gave it no identity this
// desk can use — a `tranId` past 2^53 has lost digits before it is parsed, and
// the adapter refuses a rounded one. Keying every such row alike is what left the
// desk holding one funding charge out of twenty on 2026-08-20.
//
// The fill the row was charged on is part of that fallback, because contract,
// kind, instant and amount are not enough to tell two commission rows apart: an
// account filling the same size at the same price twice in one millisecond pays
// the same fee twice, and without `tradeId` the second charge is read as a
// repeat of the first and dropped. Funding names no fill and needs none — a
// contract is charged once per settlement.
const incomeRowKey = (row) => {
  const identity = row?.tranId
  if (identity !== null && identity !== undefined && identity !== '') {
    return `${row?.incomeType ?? ''}:${identity}`
  }
  return `${row?.incomeType ?? ''}:${row?.symbol ?? ''}:${row?.time ?? ''}`
    + `:${row?.income ?? ''}:${row?.tradeId ?? ''}`
}

// Whether an income row, as the exchange states it, is one a position can be
// charged or credited with.
export const isFuturesSettledIncomeRow = row => (
  COMPONENT_OF_INCOME_TYPE[row?.incomeType] !== undefined
  && typeof row?.symbol === 'string'
  && row.symbol.length > 0
)

/**
 * Reads a page of income into the entries a position's money is made of.
 *
 * **Idempotent, and that is load-bearing rather than tidy.** This runs at three
 * points on one path — the main process narrowing what it broadcasts and the
 * renderer validating a compatibility frame that may already contain parsed
 * entries — and on 2026-08-20 it
 * silently emptied the operator's column because it did not. The main process
 * sent rows already read into `{component, amount}`; every later call looked for
 * the `incomeType` and `income` that the first had consumed, matched nothing,
 * and dropped every row. The Positions column showed `—` against a position the
 * Binance app had 264.38 USDT of charges on. Both halves had tests; the seam
 * between them did not.
 *
 * So an entry this function has already produced is accepted as itself. A caller
 * cannot get it wrong by calling it once too often, which is the only way this
 * shape of bug is prevented for good — a comment saying "call me once" is not.
 */
export const readFuturesSettledIncome = (rows) => {
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const kept = []
  for (const row of rows) {
    // Already read: keep it as it is rather than looking for exchange fields it
    // no longer carries.
    if (FUTURES_SETTLED_COMPONENTS.includes(row?.component)
      && Number.isFinite(row?.amount)
      && typeof row?.symbol === 'string'
      && row.symbol.length > 0) {
      // An entry that predates the flag is treated as derivable when it is a
      // commission or a realized PnL. Both readings are safe in the direction
      // that matters: a charge the trade record also states is dropped rather
      // than counted twice, and nothing the trade record cannot state is a
      // charge of that shape.
      kept.push(row.derivable === undefined
        ? Object.freeze({ ...row, derivable: DERIVABLE_COMPONENTS.includes(row.component) })
        : row)
      continue
    }
    const flow = COMPONENT_OF_INCOME_TYPE[row?.incomeType]
    if (flow === undefined) continue
    const { component, derivable } = flow
    const amount = toFiniteNumber(row?.income)
    const symbol = typeof row?.symbol === 'string' && row.symbol.length > 0
      ? row.symbol.toUpperCase()
      : null
    // A flow with no contract against it cannot be attributed to a position, and
    // an unreadable amount is not a zero.
    if (amount === null || symbol === null) continue
    // Every row is deduplicated, by the exchange's identity where there is one
    // and by what the row is where there is not. Skipping the check for rows
    // without an identity let a page boundary inside one millisecond count a
    // funding charge twice; keying them all alike let a Map keep one of twenty.
    // Both are wrong totals, and the natural key is wrong in neither direction.
    {
      const key = incomeRowKey(row)
      if (seen.has(key)) continue
      seen.add(key)
    }
    kept.push(Object.freeze({
      symbol,
      component,
      // Whether the desk can derive this same charge from the trade record it
      // reads anyway. Downstream reconciliation uses the classification so one
      // charge stated by two records is not treated as two movements.
      derivable,
      amount,
      asset: typeof row?.asset === 'string' && row.asset.length > 0 ? row.asset : null,
      time: Number.isFinite(row?.time) ? row.time : 0,
      tradeId: row?.tradeId ?? null,
    }))
  }
  return kept
}

// What the main process broadcast, validated at the boundary the way every other
// frame on this lane is. The window matters as much as the rows: a contract with
// no row inside it is indistinguishable from one the read never reached, and only
// `from` tells the two apart.
export const readFuturesSettledIncomeFrame = (payload) => {
  if (payload === null || typeof payload !== 'object') return null
  if (payload.version === FUTURES_SETTLED_INCOME_RESOURCE_VERSION) {
    const accountFingerprint = settledAccountFingerprint(payload.accountFingerprint)
    if (accountFingerprint === null) return null
    if (payload.lanes === null || typeof payload.lanes !== 'object') {
      return null
    }
    const lanesAreArray = Array.isArray(payload.lanes)
    if (lanesAreArray
      && payload.lanes.length !== FUTURES_UNDERIVABLE_INCOME_TYPES.length) return null
    const laneEntries = lanesAreArray
      ? payload.lanes.map(raw => [null, raw])
      : Object.entries(payload.lanes)
    if (laneEntries.length !== FUTURES_UNDERIVABLE_INCOME_TYPES.length) return null
    const parsedLanes = {}
    const laneRows = []
    for (const [key, raw] of laneEntries) {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
      const keyedIncomeType = key === null ? '' : settledIncomeType(key)
      const hasStatedIncomeType = raw.incomeType !== null && raw.incomeType !== undefined
      const statedIncomeType = hasStatedIncomeType ? settledIncomeType(raw.incomeType) : ''
      const incomeType = statedIncomeType || keyedIncomeType
      if (incomeType === ''
        || !FUTURES_UNDERIVABLE_INCOME_TYPES.includes(incomeType)
        || (key !== null && statedIncomeType !== '' && statedIncomeType !== keyedIncomeType)
        || Object.hasOwn(parsedLanes, incomeType)) return null
      const coveredFrom = raw.coveredFrom === null
        ? null
        : toSafeSettledTime(raw.coveredFrom)
      const coveredTo = raw.coveredTo === null
        ? null
        : toSafeSettledTime(raw.coveredTo)
      if ((coveredFrom === null) !== (coveredTo === null)
        || (coveredFrom !== null && coveredFrom > coveredTo)) return null
      const canonicalRows = canonicalIncomeRowsWithoutLoss(raw.rows, incomeType)
      if (canonicalRows === null) return null
      const rows = Object.freeze(canonicalRows)
      if (!FUTURES_SETTLED_RESOURCE_STATUSES.has(raw.status)) return null
      const status = raw.status
      const targetTo = raw.targetTo === null ? null : toSafeSettledTime(raw.targetTo)
      const attemptedAt = raw.attemptedAt === null
        ? null
        : toSafeSettledTime(raw.attemptedAt)
      const successfulAt = raw.successfulAt === null
        ? null
        : toSafeSettledTime(raw.successfulAt)
      const confirmationNotBefore = raw.confirmationNotBefore === null
        || raw.confirmationNotBefore === undefined
        ? null
        : toSafeSettledTime(raw.confirmationNotBefore)
      if ((raw.coveredFrom !== null && coveredFrom === null)
        || (raw.coveredTo !== null && coveredTo === null)
        || (raw.targetTo !== null && targetTo === null)
        || (raw.attemptedAt !== null && attemptedAt === null)
        || (raw.successfulAt !== null && successfulAt === null)
        || (raw.confirmationNotBefore !== null
          && raw.confirmationNotBefore !== undefined
          && confirmationNotBefore === null)
        || (attemptedAt !== null && successfulAt !== null && attemptedAt < successfulAt)
        || (raw.pending !== null && raw.pending !== undefined)
        || (status === 'ready' && (
          coveredFrom === null
          || coveredTo === null
          || targetTo === null
          || attemptedAt === null
          || successfulAt === null
          || confirmationNotBefore !== null
        ))
        || (confirmationNotBefore !== null && status !== 'stale')
        || (status !== 'ready' && raw.complete === true)) return null
      const error = raw.error === null
        ? null
        : sanitizeFuturesSettledIncomeError(raw.error)
      laneRows.push(...rows)
      parsedLanes[incomeType] = {
        incomeType,
        rows,
        coveredFrom,
        coveredTo,
        targetTo,
        status,
        attemptedAt,
        successfulAt,
        confirmationNotBefore,
        claimedComplete: raw.complete === true,
        error,
      }
    }
    const parsedIncomeTypes = Object.keys(parsedLanes)
    if (parsedIncomeTypes.length !== FUTURES_UNDERIVABLE_INCOME_TYPES.length
      || FUTURES_UNDERIVABLE_INCOME_TYPES.some(
        incomeType => !Object.hasOwn(parsedLanes, incomeType),
      )) return null
    const orderedParsedLanes = Object.values(parsedLanes).sort(
      (left, right) => left.incomeType.localeCompare(right.incomeType),
    )
    const targets = orderedParsedLanes
      .map(lane => lane.targetTo)
      .filter(value => value !== null)
    const targetTo = targets.length > 0 ? Math.max(...targets) : null
    const lanes = Object.freeze(Object.fromEntries(orderedParsedLanes.map(lane => {
      const complete = lane.claimedComplete
        && lane.status === 'ready'
        && lane.coveredFrom !== null
        && lane.coveredTo !== null
        && targetTo !== null
        && lane.coveredTo >= targetTo
      return [lane.incomeType, Object.freeze({
        incomeType: lane.incomeType,
        rows: lane.rows,
        coveredFrom: lane.coveredFrom,
        coveredTo: lane.coveredTo,
        targetTo: lane.targetTo,
        status: lane.status,
        attemptedAt: lane.attemptedAt,
        successfulAt: lane.successfulAt,
        confirmationNotBefore: lane.confirmationNotBefore,
        complete,
        error: lane.error,
      })]
    })))
    const normalizedLanes = Object.values(lanes)
    const generation = Number.isSafeInteger(payload.generation) && payload.generation >= 0
      ? payload.generation
      : null
    const digest = typeof payload.digest === 'string'
      && payload.digest.length > 0
      && payload.digest.length <= 128
      ? payload.digest
      : null
    if (generation === null || digest === null) return null
    const aggregateRows = Object.freeze([...laneRows].sort(canonicalIncomeRowOrder))
    if (Object.hasOwn(payload, 'rows')) {
      const suppliedRows = canonicalIncomeRowsWithoutLoss(
        payload.rows,
        null,
        MAX_FUTURES_SETTLED_INCOME_ROWS_PER_LANE * normalizedLanes.length,
      )
      if (suppliedRows === null || !sameCanonicalIncomeRows(suppliedRows, aggregateRows)) {
        return null
      }
    }
    const status = normalizedLanes.some(lane => lane.status === 'error')
      ? normalizedLanes.some(lane => lane.successfulAt !== null || lane.rows.length > 0)
        ? 'stale'
        : 'error'
      : normalizedLanes.some(lane => lane.status === 'stale')
        ? 'stale'
        : normalizedLanes.some(lane => lane.status === 'loading')
          ? 'loading'
          : normalizedLanes.length > 0
            && normalizedLanes.every(lane => lane.status === 'ready')
            ? 'ready'
            : 'idle'
    const coverageIsPresent = normalizedLanes.length > 0 && normalizedLanes.every(
      lane => lane.coveredFrom !== null && lane.coveredTo !== null,
    )
    const candidateCoveredFrom = coverageIsPresent
      ? Math.max(...normalizedLanes.map(lane => lane.coveredFrom))
      : null
    const candidateCoveredTo = coverageIsPresent
      ? Math.min(...normalizedLanes.map(lane => lane.coveredTo))
      : null
    const coveredFrom = candidateCoveredFrom !== null
      && candidateCoveredTo !== null
      && candidateCoveredFrom <= candidateCoveredTo
      ? candidateCoveredFrom
      : null
    const coveredTo = coveredFrom === null ? null : candidateCoveredTo
    const attempted = normalizedLanes
      .map(lane => lane.attemptedAt)
      .filter(value => value !== null)
    const successful = normalizedLanes
      .map(lane => lane.successfulAt)
      .filter(value => value !== null)
    const attemptedAt = attempted.length > 0 ? Math.max(...attempted) : null
    const successfulAt = successful.length === normalizedLanes.length
      && successful.length > 0
      ? Math.min(...successful)
      : null
    const completeByType = Object.freeze(Object.fromEntries(
      normalizedLanes.map(lane => [lane.incomeType, lane.complete]),
    ))
    const complete = normalizedLanes.length > 0
      && normalizedLanes.every(lane => lane.complete)
    const error = normalizedLanes.find(lane => lane.error !== null)?.error ?? null
    const suppliedTimeMatches = (key, derived) => {
      if (!Object.hasOwn(payload, key)) return true
      const supplied = payload[key] === null ? null : toSafeSettledTime(payload[key])
      return !(payload[key] !== null && supplied === null) && supplied === derived
    }
    if ((Object.hasOwn(payload, 'status') && payload.status !== status)
      || !suppliedTimeMatches('coveredFrom', coveredFrom)
      || !suppliedTimeMatches('coveredTo', coveredTo)
      || !suppliedTimeMatches('targetTo', targetTo)
      || !suppliedTimeMatches('attemptedAt', attemptedAt)
      || !suppliedTimeMatches('successfulAt', successfulAt)
      || (Object.hasOwn(payload, 'complete') && payload.complete !== complete)) return null
    if (Object.hasOwn(payload, 'completeByType')) {
      if (payload.completeByType === null
        || typeof payload.completeByType !== 'object'
        || Array.isArray(payload.completeByType)) return null
      const suppliedTypes = Object.keys(payload.completeByType).sort()
      const derivedTypes = Object.keys(completeByType).sort()
      if (suppliedTypes.length !== derivedTypes.length
        || suppliedTypes.some((type, index) => type !== derivedTypes[index])
        || derivedTypes.some(type => payload.completeByType[type] !== completeByType[type])) {
        return null
      }
    }
    if (Object.hasOwn(payload, 'error')) {
      const suppliedError = payload.error === null
        ? null
        : sanitizeFuturesSettledIncomeError(payload.error)
      const sameError = suppliedError?.code === error?.code
        && suppliedError?.message === error?.message
        && (suppliedError?.status ?? null) === (error?.status ?? null)
      if ((suppliedError === null) !== (error === null)
        || (suppliedError !== null && !sameError)) return null
    }
    const readAt = toSafeSettledTime(payload.readAt)
    if (readAt === null) return null
    return Object.freeze({
      version: FUTURES_SETTLED_INCOME_RESOURCE_VERSION,
      accountFingerprint,
      rows: aggregateRows,
      lanes,
      coveredFrom,
      coveredTo,
      from: coveredFrom,
      readAt,
      targetTo,
      status,
      completeByType,
      complete,
      attemptedAt,
      successfulAt,
      error,
      generation,
      digest,
    })
  }
  if (!Array.isArray(payload.rows)) return null
  const from = toFiniteNumber(payload.from)
  const readAt = toFiniteNumber(payload.readAt)
  if (from === null || readAt === null) return null
  return Object.freeze({
    rows: Object.freeze(readFuturesSettledIncome(payload.rows)),
    from,
    readAt,
    // Whether the read reached the end of the window or gave up part-way. A
    // walk that stopped at its page budget has rows the desk never saw, and a
    // total built from what it did see must not read as the whole of it.
    complete: payload.complete !== false,
  })
}

const sameSettledIncomeError = (left, right) => (
  (left === null && right === null)
  || (left !== null && right !== null
    && left?.code === right?.code
    && left?.message === right?.message
    && (left?.status ?? null) === (right?.status ?? null))
)

const sameFuturesSettledIncomeContent = (left, right) => {
  if (left.status !== right.status
    || left.coveredFrom !== right.coveredFrom
    || left.coveredTo !== right.coveredTo
    || left.targetTo !== right.targetTo
    || left.complete !== right.complete
    || !sameSettledIncomeError(left.error, right.error)) return false
  const leftTypes = Object.keys(left.lanes ?? {}).sort()
  const rightTypes = Object.keys(right.lanes ?? {}).sort()
  if (leftTypes.length !== rightTypes.length
    || leftTypes.some((type, index) => type !== rightTypes[index])) return false
  return leftTypes.every((incomeType) => {
    const held = left.lanes[incomeType]
    const candidate = right.lanes[incomeType]
    return held.status === candidate.status
      && held.coveredFrom === candidate.coveredFrom
      && held.coveredTo === candidate.coveredTo
      && held.targetTo === candidate.targetTo
      && held.confirmationNotBefore === candidate.confirmationNotBefore
      && held.complete === candidate.complete
      && sameSettledIncomeError(held.error, candidate.error)
      && sameCanonicalIncomeRows(held.rows, candidate.rows)
  })
}

// Frames can cross on the socket when an expensive read finishes after a newer
// resource state was already published. Once v2 has been seen, neither a legacy
// frame nor a lower generation may move the renderer backwards. A same-generation
// frame is allowed only for newer observation metadata over the exact same
// content digest; a disagreement is rejected as a contradictory frame, not
// guessed at.
export const newerFuturesSettledIncomeFrame = (held, candidate) => {
  if (candidate === null) return held
  if (held?.accountFingerprint !== undefined
    && candidate?.accountFingerprint !== undefined
    && held.accountFingerprint !== candidate.accountFingerprint) return held
  if (held?.version !== FUTURES_SETTLED_INCOME_RESOURCE_VERSION) return candidate
  if (candidate.version !== FUTURES_SETTLED_INCOME_RESOURCE_VERSION) return held
  if (candidate.generation < held.generation) return held
  if (candidate.generation === held.generation) {
    if (candidate.digest !== held.digest
      || candidate.readAt <= held.readAt
      || !sameFuturesSettledIncomeContent(held, candidate)) return held
    const heldLanes = held.lanes ?? {}
    const candidateLanes = candidate.lanes ?? {}
    const doesNotRegress = (previous, next) => previous === null
      || previous === undefined
      || (Number.isFinite(next) && next >= previous)
    const observationIsMonotonic = Object.entries(heldLanes).every(([incomeType, lane]) => {
      const next = candidateLanes[incomeType]
      return next !== undefined
        && doesNotRegress(lane.attemptedAt, next.attemptedAt)
        && doesNotRegress(lane.successfulAt, next.successfulAt)
    })
    return observationIsMonotonic ? candidate : held
  }
  return candidate
}
