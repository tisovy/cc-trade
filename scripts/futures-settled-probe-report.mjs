import {
  DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
  canonicalFuturesIncomeRows,
} from '../src/utils/futuresSettledIncomeResource.js'
import {
  FUTURES_SETTLED_LANE_WALK,
  walkFuturesSettledIncomeLanes,
} from '../electron/services/futures-settled-income-walk.js'
import {
  buildFuturesTradeRoundIndex,
  futuresTradePositionKey,
} from '../src/utils/futuresTradeRounds.js'
import { reconcileFuturesWalletLedger } from '../src/utils/futuresWalletLedger.js'

const POSITION_LEGS = Object.freeze(['BOTH', 'LONG', 'SHORT'])

const narrowedPositiveLimit = (value, maximum) => (
  Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : maximum
)

// The live probe owns only transport. Pagination, continuation, validation and
// resource truth come from the production lane walker, so the audit cannot
// accidentally compare a timestamp-cursor sample with the lossless runtime.
export const acquireCanonicalFuturesProbeIncome = async ({
  readPage,
  now,
  windowFrom,
  incomeTypes = DEFAULT_FUTURES_SETTLED_INCOME_TYPES,
  limits = FUTURES_SETTLED_LANE_WALK,
} = {}) => {
  const maxPagesPerLane = narrowedPositiveLimit(
    limits?.MAX_PAGES_PER_LANE,
    FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_LANE,
  )
  const maxPagesPerTarget = narrowedPositiveLimit(
    limits?.MAX_PAGES_PER_TARGET,
    FUTURES_SETTLED_LANE_WALK.MAX_PAGES_PER_TARGET,
  )
  const maxPasses = Math.ceil(maxPagesPerTarget / maxPagesPerLane) + 1
  const attemptsByType = Object.fromEntries(incomeTypes.map(type => [type, 0]))
  let resource = null
  let requested = [...incomeTypes]
  let result = null
  let requests = 0
  let passes = 0

  do {
    result = await walkFuturesSettledIncomeLanes({
      readPage,
      now,
      windowFrom,
      held: resource,
      incomeTypes,
      refreshIncomeTypes: requested,
      verifyFullWindow: passes === 0,
      limits,
    })
    passes += 1
    requests += result.requests
    for (const [type, count] of Object.entries(result.attemptsByType)) {
      attemptsByType[type] = (attemptsByType[type] ?? 0) + count
    }
    resource = result.resource
    requested = result.queuedIncomeTypes
  } while (result.queued && passes < maxPasses)

  return Object.freeze({
    resource,
    rows: Object.freeze(canonicalFuturesIncomeRows([...resource.rows.values()])),
    attemptsByType: Object.freeze(attemptsByType),
    requests,
    passes,
    exhausted: result.queued === true,
  })
}

const normalizedSymbol = value => (
  typeof value === 'string' && value.trim() !== ''
    ? value.trim().toUpperCase()
    : null
)

const finiteTime = value => (
  Number.isSafeInteger(value) && value >= 0 ? value : null
)

const probeCoverageByPosition = (fills, coverageBySymbol, generation) => {
  const symbols = new Set()
  for (const symbol of Object.keys(coverageBySymbol ?? {})) {
    const normalized = normalizedSymbol(symbol)
    if (normalized !== null) symbols.add(normalized)
  }
  for (const fill of Array.isArray(fills) ? fills : []) {
    const normalized = normalizedSymbol(fill?.symbol)
    if (normalized !== null) symbols.add(normalized)
  }

  const result = {}
  for (const symbol of symbols) {
    const source = coverageBySymbol?.[symbol]?.tradeCoverage
      ?? coverageBySymbol?.[symbol]
      ?? {}
    for (const leg of POSITION_LEGS) {
      const key = futuresTradePositionKey(symbol, leg)
      if (key === null) continue
      result[key] = Object.freeze({
        version: 2,
        coveredFrom: finiteTime(source?.coveredFrom),
        coveredTo: finiteTime(source?.coveredTo),
        flatBoundary: source?.flatBoundary === true
          ? true
          : finiteTime(source?.flatBoundary) ?? false,
        pageLimited: source?.pageLimited === true,
        retentionLimited: source?.retentionLimited === true,
        continuityComplete: source?.continuityComplete === true,
        terminalReconciled: null,
        generation,
      })
    }
  }
  return Object.freeze(result)
}

const probeSettlementAsset = (fills) => {
  const assets = new Set((Array.isArray(fills) ? fills : [])
    .map(fill => normalizedSymbol(fill?.marginAsset))
    .filter(Boolean))
  return assets.size === 1 ? [...assets][0] : 'USDT'
}

// Pure report assembly used by the live read-only probe and by a deterministic
// regression. It intentionally follows the same two-stage boundary as the
// workstation: fills establish round ownership, then underivable income is
// assigned once by the wallet ledger. Income never enters the round fold.
export const buildCanonicalFuturesProbeReport = ({
  fills = [],
  income = [],
  coverageBySymbol = {},
  positions = null,
  generation = 'probe',
  incomeCoverage = null,
  settlementAsset = null,
} = {}) => {
  const canonicalIncome = Object.freeze(canonicalFuturesIncomeRows(income))
  const roundIndex = buildFuturesTradeRoundIndex(fills, {
    coverage: probeCoverageByPosition(fills, coverageBySymbol, generation),
    positions,
    generation,
  })
  const walletLedger = reconcileFuturesWalletLedger({
    // Unresolved intervals remain ownership barriers. Funding inside one must
    // not fall through to an unrelated later resolved round.
    rounds: roundIndex.legacyRounds,
    income: canonicalIncome,
    incomeCoverage,
    settlementAsset: normalizedSymbol(settlementAsset)
      ?? probeSettlementAsset(fills),
  })
  const walletByRound = new Map(walletLedger.ownership.roundOwned.map(wallet => (
    [wallet.roundId, wallet]
  )))
  const closed = Object.freeze(roundIndex.closed
    .filter(round => round?.exitPrice !== null)
    .map(round => Object.freeze({
      round,
      wallet: walletByRound.get(round.key) ?? null,
    })))
  const open = Object.freeze(roundIndex.open.map(round => Object.freeze({
    round,
    wallet: walletByRound.get(round.key) ?? null,
  })))
  const shared = Object.freeze([
    ...walletLedger.ownership.legOwned,
    ...walletLedger.ownership.contractShared,
    ...walletLedger.ownership.accountShared,
  ])

  return Object.freeze({
    roundIndex,
    walletLedger,
    closed,
    open,
    shared,
    closedShared: walletLedger.ownership.closedShared,
    canonicalIncome,
  })
}

export default buildCanonicalFuturesProbeReport
