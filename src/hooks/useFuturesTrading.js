import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createFuturesPositionMarkStore,
} from '../utils/futuresPositionMarks.js'
import {
  pruneFuturesMarginCalls,
  readFuturesMarginCall,
} from '../utils/futuresMarginCall.js'
import {
  mergeFuturesPositionConfigs,
  readFuturesSymbolConfigs,
} from '../utils/futuresSymbolConfig.js'
import {
  FUTURES_FEE_VALUATION_COMMAND_MAX_MINUTES,
  createFuturesAccountHistoryCommand,
  createFuturesAccountRefreshCommand,
  createFuturesAdjustPositionMarginCommand,
  createFuturesCancelAllCommand,
  createFuturesCancelOrderCommand,
  createFuturesFeeValuationCommand,
  createFuturesModifyOrderCommand,
  createFuturesPlaceOrderCommand,
  createFuturesSetLeverageCommand,
  createFuturesSetMarginTypeCommand,
  createFuturesSetTradingPausedCommand,
  createFuturesSymbolConfigCommand,
} from '../utils/tradingCommands.js'
import {
  collectFuturesFeeValuationMissingMinutes,
  createFuturesFeeValuationPriceLookup,
  futuresFeeReserveWantsPrice,
  mergeFuturesFeeValuationPrices,
  readFuturesFeeReserve,
  readFuturesFeeValuationFrame,
  valueFuturesForeignFees,
} from '../utils/futuresFeeValuation.js'
import { describeFuturesAlgoTrigger } from '../utils/futuresOrderPresentation.js'
import {
  newerFuturesSettledIncomeFrame,
  readFuturesSettledIncomeFrame,
} from '../utils/futuresSettledMoney.js'
import {
  buildFuturesTradeRoundIndex,
  futuresTradePositionKey,
} from '../utils/futuresTradeRounds.js'
import {
  reconcileFuturesWalletLedger,
  sumFuturesWalletDecimalAmounts,
} from '../utils/futuresWalletLedger.js'
import { DESK_FRAME_KINDS, ensureDeskFrameRouter } from '../utils/deskFrameRouter.js'
import { measureFrameMarks } from '../utils/frameMarks.js'
import { createUnsentCommandStore } from '../utils/unsentTradingCommand.js'
import { answersUnresolvedCommand } from '../utils/unresolvedCommandIdentity.js'
import { readUnresolvedOrderPostcondition } from '../utils/orderMutationPostcondition.js'
import {
  FUTURES_COMMAND_OUTCOME,
  futuresCommandAnswerNamesAnOrder,
  readFuturesCommandAnswer,
} from '../utils/futuresCommandOutcome.js'
import {
  TERMINAL_FUTURES_ORDER_STATUSES,
  applyFuturesHistoryReading,
  beginFuturesHistoryRead,
  createHeldFuturesHistory,
  foldExecutionsIntoFuturesHistory,
  futuresHistoryTradeKey,
} from '../utils/futuresHeldHistory.js'
import {
  futuresHistoryStore,
  restoreFuturesHistoryFromStore,
} from '../utils/futuresHistoryStore.js'

const OPEN_ORDER_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED'])
// Slow enough to stay a fraction of the exchange's weight budget — one account
// read costs ninety of the 2400 a minute — and fast enough that a settlement
// nobody told the desk about is half a minute of staleness rather than a
// permanent one.
const ACCOUNT_RECONCILE_INTERVAL_MS = 30_000
const NO_CANCELS_IN_FLIGHT = Object.freeze([])

// How long a caller waits for the exchange's answer before the silence itself
// becomes the answer. The backend states an ambiguous outcome immediately and
// reconciles it over a few seconds, so this only bounds total silence — a
// caller that waited forever would hold a drag open on a dead connection.
const COMMAND_ANSWER_TIMEOUT_MS = 15_000
// One REST reconfirmation per burst of fills, ten seconds after the newest
// one; every further fill restarts the wait. The operator's rule (2026-09-03):
// «после филла таймаут 10 секунд на переподтверждение, новые филлы его
// ресетят». It was 1.2 s per contract without a restart, which sent a read
// per window while a scalp was still running — on 2026-09-02 the desk's own
// history reads outweighed its commands twenty to one. No ceiling on the
// restart: a burst ends when the fills stop.
const HISTORY_GAP_READ_DELAY_MS = 10_000

// One commit per cluster of account-lane frames. Measured 2026-08-30
// (desk-2026-08-30-002.jsonl): execution traffic arrives as clusters of five
// to seven frames every ~200 ms during a partial-fill burst, and one React
// commit per frame put the commit leg at 400 ms against a quiet 17 ms while
// the pointer starved. The first frame after a quiet moment applies at once;
// what lands within this window of the last commit folds into one trailing
// commit, in arrival order, nothing dropped — 100 ms folds a cluster's
// remainder into one commit while adding no latency to the first report.
const FUTURES_EXECUTION_COMMIT_WINDOW_MS = 100

// The review arithmetic — rounds, wallet ledger, settled money — trails the
// execution state by at most this bound during a burst and catches up when
// the burst ends. Working orders, positions and the plates stay immediate.
const FUTURES_REVIEW_FOLD_TRAIL_MS = 1_000

const ACCOUNT_RESOURCE_NAMES = [
  'balances',
  'positions',
  'regularOrders',
  'algoOrders',
  'userDataStream',
]
const MANUAL_REFRESH_ACCOUNT_RESOURCE_NAMES = Object.freeze([
  'balances',
  'positions',
  'regularOrders',
  'algoOrders',
])
const MANUAL_REFRESH_REQUEST_PATTERN = /^[.A-Za-z0-9:/_-]{1,36}$/

const SETTLED_CREDIT_LANES = Object.freeze([
  'COMMISSION_REBATE',
  'REFERRAL_KICKBACK',
  'API_REBATE',
  'FEE_RETURN',
])

const futuresRoundPositionSignature = positions => `[${(
  Array.isArray(positions) ? positions : []
).map(position => JSON.stringify([
  position?.symbol ?? null,
  position?.positionSide ?? 'BOTH',
  position?.quantity ?? position?.positionAmt ?? null,
  position?.entryPrice ?? null,
])).sort().join(',')}]`

const futuresRoundPositionBasis = signature => Object.freeze(
  JSON.parse(signature).map(([symbol, positionSide, quantity, entryPrice]) => Object.freeze({
    symbol,
    positionSide,
    quantity,
    entryPrice,
  })),
)

const finiteCoverageTime = value => (
  Number.isSafeInteger(value) && value >= 0 ? value : null
)

const futuresAccountFingerprint = value => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return /^[a-f0-9]{16}$/.test(normalized) ? normalized : null
}

// A v2 frame's content tuple is validated before it enters state. Observation
// clocks can then advance without changing any canonical money. Keep legacy
// frames on object identity so an unversioned caller never receives a stronger
// cache promise than its payload can prove.
const futuresSettledIncomeContentRevision = (settledIncome) => {
  const accountFingerprint = futuresAccountFingerprint(settledIncome?.accountFingerprint)
  const generation = settledIncome?.generation
  const digest = settledIncome?.digest
  if (settledIncome?.version !== 2
    || accountFingerprint === null
    || !Number.isSafeInteger(generation)
    || generation < 0
    || typeof digest !== 'string'
    || digest.length === 0
    || digest.length > 128) return settledIncome
  return JSON.stringify([accountFingerprint, generation, digest])
}

const readFuturesManualRefreshReceipt = (payload) => {
  const request = typeof payload?.request === 'string' ? payload.request : ''
  const requestedAt = finiteCoverageTime(payload?.requestedAt)
  const accountFingerprint = futuresAccountFingerprint(payload?.accountFingerprint)
  if (payload?.type !== 'futures_manual_refresh_outcome'
    || payload?.version !== 1
    || payload?.status !== 'accepted'
    || !MANUAL_REFRESH_REQUEST_PATTERN.test(request)
    || requestedAt === null
    || accountFingerprint === null
    || payload?.account?.disposition !== 'resource'
    || payload?.settledIncome?.disposition !== 'resource') return null
  return Object.freeze({
    version: 1,
    status: 'accepted',
    request,
    requestedAt,
    accountFingerprint,
    accountDisposition: 'resource',
    settledIncomeDisposition: 'resource',
  })
}

const manualRefreshAccountOutcome = (accountResources, requestedAt) => {
  const resources = Object.fromEntries(MANUAL_REFRESH_ACCOUNT_RESOURCE_NAMES.map((name) => {
    const resource = accountResources?.[name] ?? null
    const lastAttemptAt = finiteCoverageTime(resource?.lastAttemptAt)
    const attempted = lastAttemptAt !== null && lastAttemptAt >= requestedAt
    return [name, Object.freeze({
      status: attempted ? resource?.status ?? 'error' : 'loading',
      lastAttemptAt,
      lastSuccessfulAt: finiteCoverageTime(resource?.lastSuccessfulAt),
      error: attempted ? resource?.error ?? null : null,
    })]
  }))
  const states = Object.values(resources).map(resource => resource.status)
  const terminal = states.every(status => status !== 'idle' && status !== 'loading')
  const status = !terminal
    ? 'loading'
    : states.every(state => state === 'ready')
      ? 'ready'
      : states.some(state => state === 'ready' || state === 'stale')
        ? 'partial'
        : 'error'
  return Object.freeze({
    terminal,
    status,
    resources: Object.freeze(resources),
  })
}

const combinedIncomeLaneCoverage = (settledIncome, incomeTypes) => {
  const lanes = incomeTypes
    .map(type => settledIncome?.lanes?.[type])
    .filter(Boolean)
  if (lanes.length !== incomeTypes.length) {
    return Object.freeze({
      coveredFrom: null,
      coveredTo: null,
      complete: false,
      status: 'incomplete',
    })
  }
  const coveredFrom = lanes
    .map(lane => finiteCoverageTime(lane.coveredFrom))
    .filter(value => value !== null)
  const coveredTo = lanes
    .map(lane => finiteCoverageTime(lane.coveredTo))
    .filter(value => value !== null)
  return Object.freeze({
    coveredFrom: coveredFrom.length === lanes.length ? Math.max(...coveredFrom) : null,
    coveredTo: coveredTo.length === lanes.length ? Math.min(...coveredTo) : null,
    complete: lanes.every(lane => lane.complete === true),
    status: lanes.some(lane => lane.status === 'error' || lane.status === 'stale')
      ? 'stale'
      : lanes.some(lane => lane.status === 'loading') ? 'loading' : 'ready',
  })
}

const walletIncomeCoverage = (settledIncome) => {
  if (settledIncome?.version !== 2 || settledIncome?.lanes === null
    || typeof settledIncome?.lanes !== 'object') return settledIncome
  return Object.freeze({
    lanes: Object.freeze({
      funding: combinedIncomeLaneCoverage(settledIncome, ['FUNDING_FEE']),
      insurance: combinedIncomeLaneCoverage(settledIncome, ['INSURANCE_CLEAR']),
      commissionCredit: combinedIncomeLaneCoverage(settledIncome, SETTLED_CREDIT_LANES),
    }),
  })
}

const roundCoverageByPosition = (
  trades,
  coverageBySymbol,
  historyGeneration,
  foldedTradeKeys = [],
) => {
  const generation = Number.isSafeInteger(historyGeneration) ? historyGeneration : null
  const folded = new Set(Array.isArray(foldedTradeKeys) ? foldedTradeKeys : [])
  const positions = new Map()
  // `/userTrades` proves one contract interval. Project it to every legal leg
  // up front so an authoritative snapshot can still receive the real page /
  // retention outcome when the bounded store retained no fill for that key.
  // Unused projections are ignored by the round fold.
  for (const contract of Object.keys(coverageBySymbol ?? {})) {
    const symbol = String(contract ?? '').toUpperCase()
    for (const leg of ['BOTH', 'LONG', 'SHORT']) {
      const key = futuresTradePositionKey(symbol, leg)
      if (key !== null) positions.set(key, { symbol, earliestFoldedAt: null })
    }
  }
  for (const trade of Array.isArray(trades) ? trades : []) {
    const symbol = String(trade?.symbol ?? '').toUpperCase()
    const key = futuresTradePositionKey(symbol, trade?.positionSide ?? 'BOTH')
    if (key === null) continue
    const held = positions.get(key) ?? { symbol, earliestFoldedAt: null }
    if (folded.has(futuresHistoryTradeKey(trade))) {
      const time = finiteCoverageTime(trade?.time)
      if (time !== null && (held.earliestFoldedAt === null || time < held.earliestFoldedAt)) {
        held.earliestFoldedAt = time
      }
    }
    positions.set(key, held)
  }
  const coverage = {}
  for (const [key, { symbol, earliestFoldedAt }] of positions) {
    const source = coverageBySymbol?.[symbol]?.tradeCoverage
    const sourceCoveredTo = finiteCoverageTime(source?.coveredTo)
    const confirmedCoveredTo = earliestFoldedAt === null
      ? sourceCoveredTo
      : earliestFoldedAt === 0 || sourceCoveredTo === null
        ? null
        : Math.min(sourceCoveredTo, earliestFoldedAt - 1)
    coverage[key] = Object.freeze({
      version: 2,
      coveredFrom: finiteCoverageTime(source?.coveredFrom),
      coveredTo: confirmedCoveredTo,
      // Preserve the exact acquisition edge. `true` remains accepted for
      // legacy coverage, while a v2 producer's safe timestamp is the single
      // source of truth for which contiguous suffix starts from flat.
      flatBoundary: source?.flatBoundary === true
        ? true
        : finiteCoverageTime(source?.flatBoundary) ?? false,
      pageLimited: source?.pageLimited === true,
      retentionLimited: source?.retentionLimited === true,
      continuityComplete: source?.continuityComplete === true,
      terminalReconciled: null,
      generation,
    })
  }
  return Object.freeze(coverage)
}

const visibleAmount = (bucket, asset = 'USDT') => (
  bucket?.visibleNet?.find(total => total.asset === asset)?.amount ?? null
)

const enrichRoundWithWallet = (round, wallet) => {
  // `walletNet` already proves that canonical ownership is complete and that
  // exactly one non-zero asset remains. That asset need not be the round's trade
  // settlement asset: a zero-USDT round can move only BNB commission. Keep the
  // ledger's denomination instead of lowering that truthful single-asset result
  // to partial or relabelling it as settlement money.
  const exactWallet = wallet?.walletNet ?? null
  // A bucket blocked only by a foreign-asset fee is presented valued: the same
  // gate the history panel applies, so the two surfaces cannot disagree about
  // when the BNB fee joins the number. An exact wallet net proven in a
  // foreign asset (a zero-USDT round moving only its BNB fee) is valued the
  // same way, since the app's headline for it is the settlement figure.
  const valuation = (exactWallet === null
    || exactWallet.asset !== round.settlementAsset)
    && wallet !== null
    && (wallet.qualifications ?? []).every(code => code === 'MULTI_ASSET')
    ? valueFuturesForeignFees({
      amounts: wallet.visibleNet ?? [],
      settlementAsset: round.settlementAsset,
      feeValuations: round.feeValuations,
    })
    : null
  const display = valuation?.amount
    ?? exactWallet?.amount
    ?? visibleAmount(wallet, round.settlementAsset)
  const numeric = display === null ? Number.NaN : Number(display)
  return Object.freeze({
    ...round,
    wallet,
    netExact: exactWallet !== null,
    netPnlText: display,
    // Transitional presentation value. Exact arithmetic remains the decimal
    // text on `wallet`; Number is used only by colour/formatting at the boundary.
    netPnl: Number.isFinite(numeric) ? numeric : round.netPnl,
  })
}

const settledReadingFromWallet = (round, wallet, settlementAsset = round?.settlementAsset) => {
  if (!wallet || typeof settlementAsset !== 'string' || settlementAsset === '') return null
  const components = {
    realizedPnl: [],
    funding: [],
    commission: [],
    insuranceClear: [],
  }
  const otherAssets = new Map()
  const add = (target, key, amount) => {
    target[key].push(amount)
  }
  for (const entry of wallet.entries ?? []) {
    const target = entry.asset === settlementAsset
      ? components
      : (() => {
        if (!otherAssets.has(entry.asset)) otherAssets.set(entry.asset, {
          realizedPnl: [], funding: [], commission: [], insuranceClear: [],
        })
        return otherAssets.get(entry.asset)
      })()
    const component = entry.component === 'realized' ? 'realizedPnl'
      : entry.component === 'funding' ? 'funding'
        : entry.component === 'insurance' ? 'insuranceClear'
          : 'commission'
    add(target, component, entry.amount)
  }
  const exactComponents = totals => Object.freeze(Object.fromEntries(
    Object.entries(totals).map(([component, amounts]) => [
      component,
      sumFuturesWalletDecimalAmounts(amounts),
    ]),
  ))
  const settlementComponents = exactComponents(components)
  const settlementTotal = sumFuturesWalletDecimalAmounts(
    Object.values(settlementComponents).filter(amount => amount !== null),
  )
  const otherAssetReadings = Object.freeze([...otherAssets.entries()].map(([asset, totals]) => {
    const exactTotals = exactComponents(totals)
    const total = sumFuturesWalletDecimalAmounts(
      Object.values(exactTotals).filter(amount => amount !== null),
    )
    return Object.freeze({
      asset,
      ...exactTotals,
      amount: total,
      total,
    })
  }))
  // A BNB commission valued in the settlement asset, folded onto the exact
  // settlement total for presentation. The same gate the closed-round surfaces
  // apply — the bucket may be blocked by nothing but the multiple assets — so
  // a coverage-qualified reading degrades everywhere identically. Within the
  // gate, every foreign amount must be exactly the round's charged fee with a
  // complete valuation behind it; anything else keeps the per-asset statement,
  // degraded to "not included".
  const bucketBlockedOnlyByAssets = (wallet.qualifications ?? [])
    .every(code => code === 'MULTI_ASSET')
  const valuation = bucketBlockedOnlyByAssets
    ? valueFuturesForeignFees({
      amounts: [
        { asset: settlementAsset, amount: settlementTotal ?? '0' },
        ...otherAssetReadings
          .filter(reading => reading.total !== null)
          .map(reading => ({ asset: reading.asset, amount: reading.total })),
      ],
      settlementAsset,
      feeValuations: round?.feeValuations,
    })
    : null
  return Object.freeze({
    symbol: round.symbol,
    positionKey: round.positionKey,
    ...settlementComponents,
    total: settlementTotal,
    settlementAsset,
    otherAssets: otherAssetReadings,
    valuation,
    // What the fold could and could not value, so the surface can state a BNB
    // fee as "not included" with its reason instead of a bare second number.
    feeValuations: Array.isArray(round?.feeValuations) ? round.feeValuations : Object.freeze([]),
    from: round.openTime,
    // A valued reading is as covered as an exact wallet net: the gate above
    // proves the multiple assets were the bucket's only obstacle, so the
    // "covers the read, not the whole life" note must not fire on it.
    complete: wallet.walletNet !== null || valuation !== null,
    qualifications: wallet.qualifications,
  })
}

const createInitialAccountResources = () => Object.fromEntries(
  ACCOUNT_RESOURCE_NAMES.map(resource => [resource, {
    status: 'idle',
    data: resource === 'balances' || resource === 'userDataStream' ? null : [],
    updatedAt: null,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    error: null,
  }]),
)

// What is held from before a transport loss is a reading, not a confirmation.
// The values stay on screen — re-entering the workspace with an empty desk is
// worse — but nothing may treat them as current until a read answers on the
// connection that is up now. `stale` is the status the readiness gate already
// understands, so sizing refuses on it and exits stay available.
// Returns what it was given when nothing was confirmed in the first place, so a
// caller can tell "already unconfirmed" from "just became unconfirmed".
const markAccountResourcesUnconfirmed = (resources) => {
  const entries = Object.entries(resources ?? {})
  if (!entries.some(([, resource]) => resource?.status === 'ready')) return resources
  return Object.fromEntries(entries.map(([name, resource]) => [
    name,
    resource?.status === 'ready'
      ? {
        ...resource,
        status: 'stale',
        error: {
          code: 'TRANSPORT_LOST',
          message: 'Not confirmed since the connection dropped — retry account synchronization.',
        },
      }
      : resource,
  ]))
}

const isOpenSocket = (connection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return connection?.readyState === openState
}

const isUsableSocket = (connection) => isOpenSocket(connection)
  && typeof connection?.send === 'function'
  && typeof connection?.addEventListener === 'function'
  && typeof connection?.removeEventListener === 'function'

const createInitialState = ({ enabled, connection, historyStoreReady = false }) => ({
  connected: Boolean(enabled && isUsableSocket(connection)),
  // All persistent and settled readings are admitted inside this account
  // namespace. It is learned from an authenticated account envelope; until
  // then no history cache or income frame is allowed onto the screen.
  accountFingerprint: null,
  balances: null,
  openOrders: [],
  // Identities the exchange has reported settled, so a message that left before
  // the settlement cannot put an order back into the list after it.
  settledOrders: new Map(),
  positions: [],
  // What the account has already settled — realized PnL, funding, commission,
  // insurance clearance — as the exchange's own income rows, with the window
  // they were read over. Held raw rather than folded: the fold needs to know
  // when each open position began, and that comes from the fills, which the
  // history store holds. Null until a read has answered, which is a different
  // thing from an account that has settled nothing.
  settledIncome: null,
  // Leverage and margin mode, keyed by symbol: the two things the position read
  // stopped reporting. Held beside the snapshot for the same reason as the marks.
  symbolConfigs: {},
  // Positions the exchange has itself warned about, keyed by contract and side.
  // Distinct from the liquidation price drawn beside them, which is the desk's
  // own reckoning rather than Binance raising its hand.
  marginCalls: {},
  accountResources: createInitialAccountResources(),
  lastExecution: null,
  lastError: null,
  // A submission Binance never confirmed either way. Held apart from
  // `lastError` because it is not a failure and must never offer a retry.
  unresolvedCommand: null,
  tradingPaused: false,
  maxOrderNotionalUsdt: null,
  history: createHeldFuturesHistory(),
  // The opening history decision waits for IndexedDB to answer. Without this
  // gate the workstation can send a full discovery command while the persisted
  // coverage that would have answered it is still opening.
  historyStoreReady,
  // Incremented by the backend whenever the authenticated private stream
  // opens. It is a request to close the REST history gap spanning offline time,
  // including a position that opened and closed entirely while the stream was
  // absent and therefore no longer appears in the positions basis.
  historyReconcileGeneration: 0,
  // Which marked frame this state was produced by. Only frames the exchange
  // caused move it, so the commit effect below runs on those and on nothing
  // else — a state set for any other reason leaves it where it was.
  frameRevision: 0,
  // The settlement-asset prices foreign-asset fees are valued at, per pair and
  // per minute (`{ BNBUSDT: { [minuteMs]: closeText | null } }`). Market data
  // rather than account data: it survives an account reset, because the price
  // of a minute does not depend on whose fee it values.
  feeValuationPrices: {},
})

const resetFuturesAccountState = (
  previous,
  accountFingerprint,
  { historyStoreReady = false } = {},
) => ({
  ...previous,
  accountFingerprint,
  balances: null,
  openOrders: [],
  settledOrders: new Map(),
  positions: [],
  settledIncome: null,
  symbolConfigs: {},
  marginCalls: {},
  accountResources: createInitialAccountResources(),
  lastExecution: null,
  lastError: null,
  unresolvedCommand: null,
  tradingPaused: false,
  maxOrderNotionalUsdt: null,
  history: createHeldFuturesHistory(),
  historyStoreReady,
  historyReconcileGeneration: 0,
})

// What one drawn frame is recorded as — three of the four readings; the
// fourth, SUPERSEDED, is decided where the commit's entries are read
// together, because it is a relation between two frames of one order in one
// commit, not a property of a frame alone. Kept beside the marks rather
// than in the effect, so the readings can be read in one place.
const readingOf = (entry, drawnMark, drawnOrders) => {
  const shows = orderReportDrawn(drawnOrders, entry.report)
  if (shows === false) return 'NOT_DRAWN'
  return drawnMark === entry.before ? 'UNCHANGED' : 'DELIVERED'
}

// How many frames may be waiting for the commit that draws them. A fill is two;
// a burst of partial fills against one order is one per fill, and they are drawn
// within a tick of each other. Bounded because a memory that cannot be bounded
// is a leak, not because this is expected to fill.
const PENDING_FRAME_MARKS_MEMORY = 64

// What these surfaces would draw, as a value two states can be compared by.
//
// Not a hash of the account: an order's identity, what the exchange says it is,
// how much of it has traded and what it rests at are exactly the fields the
// chart label, the rail row and the ticket total are derived from, and a
// position's contract and size are what the dock draws. Two states that agree
// here drew the same thing, which is what separates a frame that changed the
// screen from one that arrived and changed nothing. It never leaves the
// renderer — what is reported is which of the two it was.
const orderScreenMark = order => [
  orderIdentity(order),
  order?.status ?? '',
  order?.z ?? order?.executedQty ?? '',
  order?.origQty ?? '',
  order?.price ?? '',
  order?.triggerPrice ?? order?.stopPrice ?? '',
].join('|')

// Whether the screen ended up showing what one report said.
//
// "Did anything change" is the wrong question to ask of an order frame, and
// asking it produced a wrong answer in the ordinary case: a fill sends two
// frames carrying the same fact — the folded account envelope and the report —
// so whichever landed second changed nothing and would have been recorded as
// though it had not arrived. That is the exact misreading this whole change
// exists to remove.
//
// So the frame is judged against its own subject: the row the report names, as
// the desk draws it after the commit. A terminal report is shown by the row
// being gone; a working one by the row carrying the state and the filled
// quantity the exchange stated.
const orderReportDrawn = (openOrders, report) => {
  if (report === null) return null
  const identity = orderIdentity(normalizeOrderSource(report, 'REGULAR'))
  const drawn = openOrders.find(order => orderIdentity(order) === identity) ?? null
  const status = String(report?.status ?? report?.X ?? '').toUpperCase()
  if (TERMINAL_FUTURES_ORDER_STATUSES.has(status)) return drawn === null
  if (drawn === null) return false
  const filled = order => String(order?.z ?? order?.executedQty ?? '')
  return String(drawn.status ?? '').toUpperCase() === status && filled(drawn) === filled(report)
}

const screenMark = ({ openOrders = [], positions = [] } = {}) => [
  [...openOrders].map(orderScreenMark).sort().join(';'),
  (Array.isArray(positions) ? positions : [])
    .map(position => `${position?.symbol ?? ''}|${position?.positionAmt ?? ''}`)
    .join(';'),
].join('#')

const normalizeOrderSource = (order, fallback = 'REGULAR') => {
  const orderKind = order?.orderKind === 'ALGO' ? 'ALGO' : fallback
  return {
    ...order,
    orderKind,
    orderSource: orderKind,
  }
}

const orderExchangeId = (order) => {
  const normalized = normalizeOrderSource(order)
  return normalized.sourceOrderId
    ?? normalized.algoId
    ?? normalized.orderId
    ?? normalized.clientAlgoId
    ?? normalized.clientOrderId
    ?? null
}

const orderIdentity = (order) => {
  const normalized = normalizeOrderSource(order)
  return `${normalized.orderKind}:${normalized.symbol ?? ''}:${orderExchangeId(order) ?? ''}`
}

// An order that has settled cannot rest again: the exchange does not reuse an
// order id. It can, however, still be described as resting — by a report that
// left the exchange before the fill and arrives after it, and by an account
// snapshot read from a different Binance service than the stream, which is
// eventually consistent with it.
//
// Both happen when an order fills the instant it is placed, which is what a
// limit order at a level break does: the stream's FILLED overtakes the reply to
// the placement itself, and the reply then puts the order back into the list as
// NEW. Nothing reads the account again unless the desk acts, so it rests there,
// filled, until the application is reloaded.
//
// So the desk remembers what it has seen settle and refuses to be told
// otherwise. Bounded, because it is a guard against messages in flight and not
// a history: a few hundred settlements is far more than can be in flight at
// once.
const SETTLED_ORDER_MEMORY = 256

const rememberSettledOrder = (settledOrders, identity) => {
  const next = new Map(settledOrders)
  // Re-inserting moves it back to the newest end, so an identity that is still
  // being contradicted cannot age out while the contradictions arrive.
  next.delete(identity)
  next.set(identity, true)
  while (next.size > SETTLED_ORDER_MEMORY) next.delete(next.keys().next().value)
  return next
}

// Only a report that names an order the exchange can identify settles anything:
// without an id, the identity is a prefix that every unidentified order on the
// contract would share.
const settledReportIdentity = (report) => {
  if (orderExchangeId(report) === null) return null
  return TERMINAL_FUTURES_ORDER_STATUSES.has(String(report?.status ?? '').toUpperCase())
    ? orderIdentity(report)
    : null
}

// Which listed algorithmic parent each spawned regular order belongs to. Only a
// parent that has fired names one; one still resting reports the exchange's
// empty value and claims nothing.
//
// Keyed by contract as well as by id, for the same reason `orderIdentity` is:
// Binance numbers orders per symbol, so the same id on another contract is
// another order, and resolving a parent from it would take a live stop off the
// screen because something unrelated filled.
const spawnedParentKey = (symbol, spawnedOrderId) => `${symbol ?? ''}:${spawnedOrderId}`

const readSpawnedParents = (openOrders) => {
  const parents = new Map()
  for (const order of openOrders) {
    const trigger = describeFuturesAlgoTrigger(order)
    if (!trigger.triggered) continue
    parents.set(spawnedParentKey(order.symbol, trigger.spawnedOrderId), orderIdentity(order))
  }
  return parents
}

// The parent a report belongs to, or null when no listed parent claims it. The
// exchange states the spawned identity as a string and the stream states its
// own as a number, so the two are compared as trimmed text: `'123'` and `123`
// are the same order, and comparing them by type would never match.
const spawnedParentIdentity = (spawnedParents, report) => {
  const spawnedOrderId = String(report?.orderId ?? report?.i ?? '').trim()
  if (spawnedOrderId === '') return null
  return spawnedParents.get(spawnedParentKey(report?.symbol ?? report?.s, spawnedOrderId)) ?? null
}

// Bounded for the same reason the settled memory is: this is a guard against a
// burst of reports about one trigger, not a record of the account.
const RESOLVED_PARENT_MEMORY = 64

const rememberResolvedParent = (resolvedParents, identity) => {
  const next = new Set(resolvedParents)
  next.delete(identity)
  next.add(identity)
  while (next.size > RESOLVED_PARENT_MEMORY) next.delete(next.values().next().value)
  return next
}

const isOpenSnapshotOrder = order => (
  !TERMINAL_FUTURES_ORDER_STATUSES.has(String(order?.status ?? '').toUpperCase())
)

// Binance's own services are eventually consistent with each other: the order
// snapshot fetched right after an amendment can still describe the order as it
// was. Both sides carry the exchange's update time, so the newer one wins and
// the operator never has to reload to see a size they just changed.
const orderUpdatedAt = (order) => {
  const value = Number(order?.T ?? order?.updateTime ?? order?.transactTime ?? order?.time)
  return Number.isSafeInteger(value) ? value : null
}

const preferNewerOrder = (snapshotOrder, knownOrders) => {
  const known = knownOrders.get(orderIdentity(snapshotOrder))
  if (!known) return snapshotOrder
  const knownAt = orderUpdatedAt(known)
  const snapshotAt = orderUpdatedAt(snapshotOrder)
  if (knownAt === null || snapshotAt === null) return snapshotOrder
  return knownAt > snapshotAt ? known : snapshotOrder
}

const mergeOrderUpdate = (openOrders, report, settledOrders) => {
  if (!report || typeof report.orderId === 'undefined') return openOrders
  const normalizedReport = normalizeOrderSource(report)
  const reportIdentity = orderIdentity(normalizedReport)
  const withoutOrder = openOrders.filter(order => orderIdentity(order) !== reportIdentity)
  if (OPEN_ORDER_STATUSES.has(normalizedReport.status)
    && !settledOrders.has(reportIdentity)) {
    return [...withoutOrder, normalizedReport]
  }
  return withoutOrder
}

const applyAccountEnvelope = (
  previous,
  payload,
  { historyStoreReady = false } = {},
) => {
  if (payload?.type !== 'futures_account_state'
    || payload.version !== 1
    || !payload.resources
    || typeof payload.resources !== 'object') return previous

  const fingerprint = futuresAccountFingerprint(payload.accountFingerprint)
  // Once the account has been named, an unscoped account frame cannot be
  // allowed to mutate it. Initial unscoped frames remain display-compatible
  // with an older backend, but they never unlock persistent/settled data.
  if (previous.accountFingerprint !== null && fingerprint === null) return previous
  const base = fingerprint !== null && fingerprint !== previous.accountFingerprint
    ? resetFuturesAccountState(previous, fingerprint, { historyStoreReady })
    : previous

  const accountResources = {
    ...base.accountResources,
    ...Object.fromEntries(ACCOUNT_RESOURCE_NAMES.flatMap(resource => (
      payload.resources[resource] && typeof payload.resources[resource] === 'object'
        ? [[resource, payload.resources[resource]]]
        : []
    ))),
  }
  const balances = accountResources.balances?.data ?? null
  const positions = Array.isArray(accountResources.positions?.data)
    ? accountResources.positions.data
    : base.positions
  const knownOrders = new Map(base.openOrders.map(order => [orderIdentity(order), order]))
  const regularOrders = Array.isArray(accountResources.regularOrders?.data)
    ? accountResources.regularOrders.data.map(order => normalizeOrderSource(order, 'REGULAR'))
    : []
  const algoOrders = Array.isArray(accountResources.algoOrders?.data)
    ? accountResources.algoOrders.data.map(order => normalizeOrderSource(order, 'ALGO'))
    : []

  return {
    ...base,
    connected: true,
    accountFingerprint: fingerprint ?? base.accountFingerprint,
    accountResources,
    balances,
    positions,
    // The exchange's warning stands until the position it names says it should
    // not: closed, smaller, or with more margin behind it. Nothing else takes it
    // down, because nothing else is the exchange talking about that position.
    marginCalls: pruneFuturesMarginCalls(base.marginCalls, positions),
    openOrders: [...regularOrders, ...algoOrders]
      .filter(isOpenSnapshotOrder)
      .filter(order => !base.settledOrders.has(orderIdentity(order)))
      .map(order => preferNewerOrder(order, knownOrders)),
  }
}

// Spot-parity futures trading state: pushed futures_* messages from the local
// backend plus fire-and-forget typed trading commands. No intents, no
// confirmations — the backend and the exchange are the authority.
// A frame issued under no known activation is sent unstamped: the backend gates
// it on the market name alone, exactly as it did before generations existed.
const stampGeneration = (command, generation) => (
  Number.isSafeInteger(generation) ? { ...command, generation } : command
)

const useFuturesTrading = ({
  enabled,
  symbol,
  wsConnection,
  marketGeneration = null,
  historyStore = futuresHistoryStore,
} = {}) => {
  const historyStoreUnavailable = typeof historyStore?.readContracts !== 'function'
    || (historyStore === futuresHistoryStore
      && typeof globalThis.indexedDB?.open !== 'function')
  const [state, setState] = useState(() => createInitialState({
    enabled,
    connection: wsConnection,
    historyStoreReady: historyStoreUnavailable,
  }))
  const [manualRefreshReceipt, setManualRefreshReceipt] = useState(null)
  const [positionMarkStore] = useState(() => createFuturesPositionMarkStore())
  const symbolRef = useRef(symbol)
  // Read inside the connection effect, which must not re-run when only the
  // generation changes: re-running it would resend the account refresh.
  const generationRef = useRef(marketGeneration)
  const accountFingerprintRef = useRef(null)
  const unsentCommandsRef = useRef(null)
  if (unsentCommandsRef.current === null) {
    unsentCommandsRef.current = createUnsentCommandStore()
  }
  const unsentCommands = unsentCommandsRef.current

  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    generationRef.current = marketGeneration
    // A renderer activation and the shared public feed are different
    // lifecycles. Repeating the same market activation clears what the renderer
    // may call live, but the backend feed normally survives and publishes the
    // next revision in the same epoch. Keep that admission point so a delayed
    // revision cannot repopulate the store and the next advancing revision can.
    positionMarkStore.clear({ preserveAdmission: true })
  }, [marketGeneration, positionMarkStore])

  // Every authenticated reading belongs to one market activation and one
  // credential fingerprint. A superseded activation may still have frames in
  // flight, so close admission before those frames can repopulate state. The
  // next account envelope opens the new namespace and the cache is restored
  // only inside it.
  useEffect(() => {
    accountFingerprintRef.current = null
    setState(previous => resetFuturesAccountState(previous, null, {
      historyStoreReady: historyStoreUnavailable,
    }))
    setManualRefreshReceipt(null)
  }, [historyStoreUnavailable, marketGeneration])

  // Which listed algorithmic parent each spawned regular order belongs to.
  // Mirrored into a ref because it is consulted on the stream's own path, which
  // must not re-subscribe every time the account list changes.
  const spawnedParentsRef = useRef(new Map())
  const openOrders = state.openOrders
  useEffect(() => {
    spawnedParentsRef.current = readSpawnedParents(openOrders)
  }, [openOrders])

  // Which parents this connection has already read for, so a burst of fills
  // against one of them stays one read.
  const resolvedParentsRef = useRef(new Set())

  // The half of a marked frame's journey only this side can close.
  //
  // `pendingFrameMarksRef` holds the frames waiting for the commit that draws
  // them; `frameMarkSeqRef` numbers them, so the effect below reports the frames
  // it was armed for and never a later state that happened to render;
  // `screenMarkRef` holds what these surfaces last drew, which is what says
  // whether a frame changed anything at all.
  //
  // A list rather than one slot, because a fill is two frames — the folded
  // account envelope and the report itself, sent back to back. Delivered in one
  // tick they become one React commit, and a single slot reported the second and
  // lost the first: the order line, which is the one this was built for.
  const pendingFrameMarksRef = useRef([])
  const frameMarkSeqRef = useRef(0)
  const screenMarkRef = useRef(screenMark())
  // The cluster waiting for its one commit, and the clock that decides
  // whether the next frame starts a commit or joins this one.
  const executionQueueRef = useRef([])
  const executionDrainTimerRef = useRef(null)
  const executionLastCommitAtRef = useRef(0)

  // Assigned rather than closed over: the stream handler is installed once per
  // connection, and `sendCommand` is rebuilt whenever the market activation
  // changes. Closing over it would re-subscribe, which resends the opening
  // account refresh.
  const sendCommandRef = useRef(null)

  // Read inside the connection effect, which must not re-run because the store
  // it writes to was passed as a new object.
  const historyStoreRef = useRef(historyStore)
  useEffect(() => {
    historyStoreRef.current = historyStore
  }, [historyStore])
  const historyCoverageRef = useRef(state.history.coverage)
  useEffect(() => {
    historyCoverageRef.current = state.history.coverage
  }, [state.history.coverage])
  // The burst's one timer and the contracts it has touched so far.
  const historyGapReadTimersRef = useRef({ timer: null, symbols: new Set() })

  useEffect(() => {
    const burst = historyGapReadTimersRef.current
    if (burst.timer !== null) globalThis.clearTimeout(burst.timer)
    burst.timer = null
    burst.symbols.clear()
    historyCoverageRef.current = {}
    resolvedParentsRef.current.clear()
  }, [marketGeneration, state.accountFingerprint])

  // The review is on screen before anything is asked of the exchange. A settled
  // order and an executed trade do not change while the desk is closed, so what
  // an earlier run read is presented from the local store — stamped with when it
  // was read, so nobody mistakes it for a reading taken now. A store that will
  // not open leaves the review exactly as it is without one.
  useEffect(() => {
    const fingerprint = state.accountFingerprint
    if (!enabled || fingerprint === null) return undefined
    if (historyStoreUnavailable) {
      setState(previous => previous.accountFingerprint === fingerprint
        && previous.historyStoreReady !== true
        ? { ...previous, historyStoreReady: true }
        : previous)
      return undefined
    }
    let abandoned = false
    void (async () => {
      let restored = null
      try {
        restored = restoreFuturesHistoryFromStore(
          await historyStore?.readContracts?.(fingerprint),
          { fingerprint },
        )
      } catch {
        restored = null
      }
      if (abandoned) return
      setState((previous) => {
        if (previous.accountFingerprint !== fingerprint) return previous
        // A read answered while the store was opening. The exchange's own answer
        // is the newer of the two and wins outright.
        const history = restored !== null && previous.history.readAt === null
          ? restored
          : previous.history
        return { ...previous, history, historyStoreReady: true }
      })
    })()
    return () => { abandoned = true }
  }, [enabled, historyStore, historyStoreUnavailable, state.accountFingerprint])

  // Commands whose answer somebody is waiting on. Held in a ref rather than in
  // state: nothing renders from them, and a pending answer must survive every
  // re-render the account traffic causes while it is outstanding.
  const commandWatchersRef = useRef([])

  const settleCommandWatcher = useCallback((watcher, result) => {
    if (!commandWatchersRef.current.includes(watcher)) return
    commandWatchersRef.current = commandWatchersRef.current.filter(entry => entry !== watcher)
    if (watcher.timer !== null) globalThis.clearTimeout(watcher.timer)
    watcher.settle(Object.freeze(result))
  }, [])

  const answerCommandWatchers = useCallback((answer) => {
    // An answer that names no order — a paused desk, a local cap, an
    // unconfigured adapter — answers one command of that action, and the oldest
    // in flight is the one it is about. Settling every watcher on it would let a
    // refusal of the ticket's order end the drag's wait for a different one.
    const settlesOne = !futuresCommandAnswerNamesAnOrder(answer)
    for (const watcher of [...commandWatchersRef.current]) {
      const result = readFuturesCommandAnswer(watcher, answer)
      if (!result) continue
      settleCommandWatcher(watcher, result)
      if (settlesOne) return
    }
  }, [settleCommandWatcher])

  // A connection that drops mid-command answers nothing: what the exchange did
  // with it is exactly as unknown as it was a moment before.
  const abandonCommandWatchers = useCallback((code, message) => {
    for (const watcher of [...commandWatchersRef.current]) {
      settleCommandWatcher(watcher, {
        outcome: FUTURES_COMMAND_OUTCOME.UNKNOWN,
        code,
        message,
      })
    }
  }, [settleCommandWatcher])

  useEffect(() => () => abandonCommandWatchers(
    'FUTURES_WORKSPACE_CLOSED',
    'The Futures workspace closed before Binance answered this command.',
  ), [abandonCommandWatchers])

  useEffect(() => {
    if (!enabled || !isUsableSocket(wsConnection)) {
      positionMarkStore.clear()
      // Keep the last-known account snapshot so re-entering Futures mode is
      // usable immediately; the refresh sent on re-enable reconciles it. The
      // early return has to answer for the whole update, not only the two fields
      // it started with: a held resource still marked ready is a reading nothing
      // has confirmed on this connection.
      setState((previous) => {
        const accountResources = markAccountResourcesUnconfirmed(previous.accountResources)
        return previous.connected === false
          && previous.lastError === null
          && accountResources === previous.accountResources
          ? previous
          : { ...previous, connected: false, lastError: null, accountResources }
      })
      return undefined
    }

    let active = true
    const historyGapRead = historyGapReadTimersRef.current

    // One timer for the burst, whichever contracts it touches. A fill adds its
    // contract and restarts the wait; when the fills stop, one read goes out
    // per contract touched.
    const scheduleHistoryGapRead = (report) => {
      const symbol = String(report?.symbol ?? '').toUpperCase()
      if (symbol === '' || !(Number(report?.lastFilledQty ?? report?.l) > 0)) return
      historyGapRead.symbols.add(symbol)
      if (historyGapRead.timer !== null) globalThis.clearTimeout(historyGapRead.timer)
      historyGapRead.timer = globalThis.setTimeout(() => {
        historyGapRead.timer = null
        const symbols = [...historyGapRead.symbols]
        historyGapRead.symbols.clear()
        if (!active) return
        for (const touched of symbols) {
          sendCommandRef.current?.(createFuturesAccountHistoryCommand({
            basisOnly: true,
            coverage: historyCoverageRef.current,
            // Named so the record can score this read apart from the others:
            // whether the read after a fill ever brings what the stream did
            // not is the question that decides if it keeps being sent.
            reason: 'fill',
            symbol: touched,
            views: ['trades'],
          }))
        }
      }, HISTORY_GAP_READ_DELAY_MS)
    }

    // One state update per cluster: the first frame after quiet applies at
    // once, frames that follow within the commit window fold into one
    // trailing commit, in arrival order, none dropped or superseded — the
    // account lane's lossless delivery holds from the exchange to the
    // applied state, because every report carries a fill the history fold
    // must see.
    const drainExecutionQueue = () => {
      const entries = executionQueueRef.current
      if (entries.length === 0) return
      executionQueueRef.current = []
      executionLastCommitAtRef.current = Date.now()
      setState((previous) => {
        let next = previous
        let frameRevision = 0
        // The heavy filter+sort+bound of the held history runs once for the
        // cluster; the order list and settled set fold per report, in
        // arrival order, because the envelopes between reports read them.
        let reports = []
        const foldReports = () => {
          if (reports.length === 0) return
          next = { ...next, history: foldExecutionsIntoFuturesHistory(next.history, reports) }
          reports = []
        }
        for (const entry of entries) {
          if (entry.revision !== 0) frameRevision = entry.revision
          if (entry.kind === 'account') {
            // A frame that re-keys the account wipes the held history; the
            // reports before it belong to the account before it, exactly as
            // they would applied one at a time. The first naming from null
            // needs no flush: the fold no-ops on unheld history either side
            // of the reset, and a held history under a null fingerprint is
            // unreachable — readings apply only to the account they name.
            const fingerprint = futuresAccountFingerprint(entry.payload?.accountFingerprint)
            if (fingerprint !== null && fingerprint !== (next.accountFingerprint ?? null)
              && next.accountFingerprint !== null) foldReports()
            next = applyAccountEnvelope(next, entry.payload, {
              historyStoreReady: historyStoreUnavailable,
            })
            continue
          }
          const report = entry.report
          const settled = settledReportIdentity(report)
          const withReport = settled === null
            ? next.settledOrders
            : rememberSettledOrder(next.settledOrders, settled)
          // A spawned order that filled or was cancelled has finished what
          // its parent was placed to do. The parent is remembered as settled
          // for the same reason any other settled order is: the algo
          // snapshot is read from a different Binance service than the
          // stream and can still describe it as resting.
          const settledOrders = entry.parentSettled
            ? rememberSettledOrder(withReport, entry.parentIdentity)
            : withReport
          const merged = mergeOrderUpdate(next.openOrders, report, settledOrders)
          const held = next.unresolvedCommand
          const verdict = readUnresolvedOrderPostcondition(held, report)
          next = {
            ...next,
            connected: true,
            lastExecution: report,
            lastError: verdict?.state === 'terminal' ? {
              request: held.request, code: verdict.code, message: verdict.message,
              details: { ...held.details, status: verdict.status, postconditionSatisfied: false },
            } : next.lastError?.details?.postconditionSatisfied === false ? next.lastError : null,
            // Identity alone is not proof that cancel/modify took effect.
            unresolvedCommand: verdict && verdict.state !== 'pending' ? null : held,
            settledOrders,
            openOrders: entry.parentSettled
              ? merged.filter(order => orderIdentity(order) !== entry.parentIdentity)
              : merged,
          }
          reports.push(report)
        }
        foldReports()
        return frameRevision === 0 ? next : { ...next, frameRevision }
      })
    }

    const queueExecutionEntry = (entry) => {
      executionQueueRef.current = [...executionQueueRef.current, entry]
      if (executionDrainTimerRef.current !== null) return
      const sinceCommit = Date.now() - executionLastCommitAtRef.current
      if (sinceCommit >= FUTURES_EXECUTION_COMMIT_WINDOW_MS) {
        drainExecutionQueue()
        return
      }
      executionDrainTimerRef.current = globalThis.setTimeout(() => {
        executionDrainTimerRef.current = null
        drainExecutionQueue()
      }, FUTURES_EXECUTION_COMMIT_WINDOW_MS - sinceCommit)
    }

    // Account frames only. This used to read every frame the desk delivered —
    // parsing a hundred-and-eighteen-kilobyte book ten times a second in order
    // to find out it was not an account envelope, on the path whose job is to
    // take a filled order off the screen.
    const handleMessage = (frame) => {
      if (!active) return
      const payload = frame?.payload
      if (payload === null || typeof payload !== 'object') return

      // Present only on the frames the exchange caused. Arming answers the
      // revision the commit effect waits for, or `0` for a frame carrying no
      // marks — which is most of this lane, and costs it nothing.
      const armFrameMarks = ({
        resource,
        symbol = null,
        identity = null,
        status = null,
        report = null,
      }) => {
        const marks = frame?.marks ?? null
        const receivedAt = frame?.receivedAt ?? null
        if (marks === null || !Number.isSafeInteger(receivedAt)) return 0
        const revision = frameMarkSeqRef.current + 1
        frameMarkSeqRef.current = revision
        pendingFrameMarksRef.current = [
          // Bounded for the reason every other memory here is: this is a guard
          // against a burst, not a record. Nothing but a commit that never came
          // can leave an entry behind, and one that did is not worth a leak.
          ...pendingFrameMarksRef.current.slice(-(PENDING_FRAME_MARKS_MEMORY - 1)),
          {
            revision,
            marks,
            receivedAt,
            resource,
            symbol,
            identity,
            status,
            // The frame's own subject, where it has one. An account envelope
            // has none — it restates the whole account — so it is judged by
            // whether the screen moved and nothing more.
            report,
            // What the screen showed before this frame was applied.
            before: screenMarkRef.current,
          },
        ]
        return revision
      }

      if (payload.type === 'futures_account_state') {
        const fingerprint = futuresAccountFingerprint(payload.accountFingerprint)
        if (fingerprint !== null) accountFingerprintRef.current = fingerprint
        const revision = armFrameMarks({ resource: 'account' })
        queueExecutionEntry({ kind: 'account', payload, revision })
      }
      if (payload.type === 'futures_manual_refresh_outcome') {
        const receipt = readFuturesManualRefreshReceipt(payload)
        if (receipt !== null && receipt.accountFingerprint === accountFingerprintRef.current) {
          setManualRefreshReceipt(previous => previous !== null
            && previous.requestedAt > receipt.requestedAt
            ? previous
            : receipt)
        }
      }
      if (payload.type === 'futures_history_reconcile' && payload.version === 1) {
        const fingerprint = futuresAccountFingerprint(payload.accountFingerprint)
        const generation = Number(payload.generation)
        if (fingerprint !== null
          && fingerprint === accountFingerprintRef.current
          && Number.isSafeInteger(generation)
          && generation > 0) {
          setState(previous => (
            previous.accountFingerprint !== fingerprint
              || generation <= previous.historyReconcileGeneration
              ? previous
              : { ...previous, historyReconcileGeneration: generation }
          ))
        }
      }
      if (payload.type === 'futures_position_marks') {
        positionMarkStore.replace(payload.marks, payload.revision, payload.feedEpoch)
      }
      if (payload.type === 'futures_settled_income') {
        const fingerprint = futuresAccountFingerprint(payload.accountFingerprint)
        if (fingerprint === null || fingerprint !== accountFingerprintRef.current) return
        const settledIncome = readFuturesSettledIncomeFrame(payload)
        if (settledIncome !== null) {
          setState((previous) => {
            if (previous.accountFingerprint !== fingerprint) return previous
            const next = newerFuturesSettledIncomeFrame(previous.settledIncome, settledIncome)
            return next === previous.settledIncome
              ? previous
              : { ...previous, settledIncome: next }
          })
        }
      }
      if (payload.type === 'futures_fee_valuation') {
        const frame = readFuturesFeeValuationFrame(payload)
        if (frame !== null) {
          setState((previous) => {
            const feeValuationPrices = mergeFuturesFeeValuationPrices(
              previous.feeValuationPrices,
              frame,
            )
            return feeValuationPrices === previous.feeValuationPrices
              ? previous
              : { ...previous, feeValuationPrices }
          })
        }
      }
      if (payload.futures_symbol_configs) {
        const symbolConfigs = readFuturesSymbolConfigs(payload.futures_symbol_configs)
        // Merged rather than replaced: the reads arrive per contract — one for the
        // contract on screen, one per open position — and each answers only for
        // the symbols it asked about.
        if (symbolConfigs !== null) {
          setState(previous => ({
            ...previous,
            symbolConfigs: { ...previous.symbolConfigs, ...symbolConfigs },
          }))
        }
      }
      if (payload.futures_conditional_trigger_reject) {
        const refusal = payload.futures_conditional_trigger_reject
        // A stop that met its trigger and was then refused by the matching
        // engine. No read explains this one — at the next reconciliation the
        // order is simply gone — so the exchange's own words go where every
        // other exchange refusal goes, rather than only into the log.
        setState(previous => ({
          ...previous,
          lastError: {
            code: 'FUTURES_TRIGGER_REJECTED',
            message: refusal.reason ?? 'The exchange refused the triggered order.',
            details: {
              marketType: 'futures',
              symbol: refusal.symbol ?? null,
              orderId: refusal.orderId ?? null,
            },
          },
        }))
      }
      if (payload.futures_margin_call) {
        const marginCalls = readFuturesMarginCall(payload.futures_margin_call)
        // Merged rather than replaced: the exchange sends a call for the
        // positions at risk now, and says nothing about one it warned of a
        // minute ago — an absence here is not an all-clear.
        if (marginCalls !== null) {
          setState(previous => ({
            ...previous,
            marginCalls: { ...previous.marginCalls, ...marginCalls },
          }))
        }
      }
      if (payload.futures_execution_update) {
        const report = payload.futures_execution_update
        // The frame the operator's complaint is about: what the exchange says
        // an order is now. Named by the identity the command that placed it
        // carries, and by the state the exchange gave it — `PARTIALLY_FILLED`
        // is what makes a partial fill legible in the record without the
        // record ever holding a quantity.
        const frameRevisionForReport = armFrameMarks({
          resource: 'orders',
          symbol: report?.symbol ?? report?.s ?? null,
          identity: report?.orderId ?? report?.i ?? null,
          status: report?.status ?? report?.X ?? null,
          report,
        })
        // A parent that fires would sit on the chart at its trigger price until
        // the beat came round. It does not have to: the desk already holds the
        // identity of the regular order that parent spawned, and this is that
        // order's report. The stream also carries `ALGO_UPDATE` for the parent
        // itself, which the backend folds — this path stands on its own because
        // it needs no event whose delivery to this account is unproven. Matching the two is the whole of the exception — a report
        // naming no listed parent still reads nothing.
        const parentIdentity = spawnedParentIdentity(
          spawnedParentsRef.current,
          report,
        )
        const parentSettled = parentIdentity !== null
          && TERMINAL_FUTURES_ORDER_STATUSES.has(String(report?.status ?? '').toUpperCase())
        // The state application joins the cluster's one commit; what waits on
        // the report does not wait on the commit — a drag's cancellation is
        // answered from the report itself, at arrival.
        queueExecutionEntry({
          kind: 'execution',
          report,
          revision: frameRevisionForReport,
          parentIdentity,
          parentSettled,
        })
        answerCommandWatchers({ kind: 'execution', report })
        // The stream updates the visible fill immediately. One delayed REST gap
        // read per affected contract then proves that no sibling execution was
        // missed and replaces the stream projection with Binance's canonical
        // trade row. A fill burst shares this timer instead of buying one page
        // per partial execution.
        scheduleHistoryGapRead(report)
        // One read for the match, and only for the match. The parent is already
        // off the screen by the line above; this confirms it against the list
        // the stream cannot report, and picks up whatever the same trigger left
        // behind. Deduplicated by parent, so a burst of fills on one spawned
        // order is one read rather than one read per fill.
        if (parentIdentity !== null && !resolvedParentsRef.current.has(parentIdentity)) {
          resolvedParentsRef.current = rememberResolvedParent(
            resolvedParentsRef.current,
            parentIdentity,
          )
          sendCommandRef.current?.(createFuturesAccountRefreshCommand({
            symbol: symbolRef.current,
          }))
        }
      }
      if (payload.futures_history && typeof payload.futures_history === 'object') {
        const history = payload.futures_history
        const fingerprint = futuresAccountFingerprint(history.accountFingerprint)
        const readAt = finiteCoverageTime(history.readAt)
        if (fingerprint === null || fingerprint !== accountFingerprintRef.current
          || readAt === null) return
        setState(previous => previous.accountFingerprint !== fingerprint
          ? previous
          : ({
            ...previous,
            connected: true,
            history: applyFuturesHistoryReading(previous.history, history, readAt),
          }))
        // What the exchange just proved settled outlives this run. A failed read
        // proves nothing, and a store that will not write is not a failed read.
        if (!history.error) {
          void (async () => {
            try {
              await historyStoreRef.current?.writeReading?.({
                symbols: history.symbols,
                orders: history.orders,
                trades: history.trades,
                readFrom: history.readFrom,
                merge: history.merge,
                tradeCoverage: history.tradeCoverage,
                // Which endpoints this answer covered, so the store replaces
                // only those and the view it did not read keeps what it holds.
                views: history.views,
                readAt,
                accountFingerprint: fingerprint,
              })
            } catch {
              // A review that cannot be stored is still a review that was read.
            }
          })()
        }
      }
      if (typeof payload.futures_trading_paused === 'boolean'
        || Object.hasOwn(payload, 'futures_max_order_usdt')) {
        setState(previous => ({
          ...previous,
          connected: true,
          tradingPaused: typeof payload.futures_trading_paused === 'boolean'
            ? payload.futures_trading_paused
            : previous.tradingPaused,
          maxOrderNotionalUsdt: payload.futures_max_order_usdt === null
            ? null
            : Number.isFinite(Number(payload.futures_max_order_usdt))
                && Number(payload.futures_max_order_usdt) > 0
              ? String(payload.futures_max_order_usdt)
              : previous.maxOrderNotionalUsdt,
        }))
      }
      if (payload.command_rejected
        && (payload.command_rejected.details?.marketType === 'futures'
          || payload.command_rejected.code === 'FUTURES_API_ERROR')) {
        // A rejection settles only the command it names. A refusal of one
        // command is not an answer about another whose outcome is unknown.
        setState((previous) => {
          const rejection = payload.command_rejected
          return {
            ...previous,
            lastError: rejection,
            unresolvedCommand: answersUnresolvedCommand(previous.unresolvedCommand, {
              symbol: rejection.details?.symbol,
              orderId: rejection.details?.orderId,
              clientOrderId: rejection.details?.clientOrderId,
              request: rejection.request,
            })
              ? null
              : previous.unresolvedCommand,
          }
        })
        answerCommandWatchers({ kind: 'rejected', envelope: payload.command_rejected })
      }
      // The end of an unknown outcome: the backend has established what the
      // exchange did with this command, and says so by name.
      if (payload.command_resolved
        && payload.command_resolved.details?.marketType === 'futures') {
        setState((previous) => {
          const resolution = payload.command_resolved
          return answersUnresolvedCommand(previous.unresolvedCommand, {
            symbol: resolution.details?.symbol,
            orderId: resolution.details?.orderId,
            clientOrderId: resolution.details?.clientOrderId,
            request: resolution.request,
          })
            ? { ...previous, unresolvedCommand: null }
            : previous
        })
        answerCommandWatchers({ kind: 'resolved', envelope: payload.command_resolved })
      }
      // An unresolved outcome is deliberately not an error: the order may be
      // live, and presenting it as a failure is what makes an operator create a
      // second one. It is held separately and cleared only by an answer.
      if (payload.command_unresolved
        && payload.command_unresolved.details?.marketType === 'futures') {
        setState(previous => ({
          ...previous,
          unresolvedCommand: payload.command_unresolved,
        }))
        answerCommandWatchers({ kind: 'unresolved', envelope: payload.command_unresolved })
      }
    }

    const handleDisconnect = () => {
      if (!active) return
      // Account state may remain as an explicitly stale reading; a public mark
      // may not. Once this transport is gone there is nobody left to clear a
      // feed that stopped, so retaining it would label an aged price `live`.
      positionMarkStore.clear()
      abandonCommandWatchers(
        'TRANSPORT_LOST',
        'The connection dropped before Binance answered this command.',
      )
      setState(previous => ({
        ...previous,
        connected: false,
        accountResources: markAccountResourcesUnconfirmed(previous.accountResources),
      }))
    }

    const unsubscribe = ensureDeskFrameRouter(wsConnection)?.subscribe(
      DESK_FRAME_KINDS.ACCOUNT,
      handleMessage,
    ) ?? (() => {})
    wsConnection.addEventListener('close', handleDisconnect)
    wsConnection.addEventListener('error', handleDisconnect)

    try {
      wsConnection.send(JSON.stringify(stampGeneration(createFuturesAccountRefreshCommand({
        symbol: symbolRef.current,
      }), generationRef.current)))
      setState(previous => ({ ...previous, connected: true }))
    } catch {
      handleDisconnect()
    }

    return () => {
      active = false
      // Nothing queued may be lost to a teardown: the cluster in hand is
      // committed now, however short of the window it is.
      if (executionDrainTimerRef.current !== null) {
        globalThis.clearTimeout(executionDrainTimerRef.current)
        executionDrainTimerRef.current = null
      }
      drainExecutionQueue()
      if (historyGapRead.timer !== null) globalThis.clearTimeout(historyGapRead.timer)
      historyGapRead.timer = null
      historyGapRead.symbols.clear()
      positionMarkStore.clear()
      unsubscribe()
      wsConnection.removeEventListener('close', handleDisconnect)
      wsConnection.removeEventListener('error', handleDisconnect)
    }
  }, [
    abandonCommandWatchers,
    answerCommandWatchers,
    enabled,
    historyStoreUnavailable,
    positionMarkStore,
    wsConnection,
  ])

  // What these surfaces last drew. Updated before the effect below reads it —
  // effects run in the order they are written, and that order is what lets the
  // report say whether the frame it is measuring changed anything.
  const drawnOrders = state.openOrders
  const drawnPositions = state.positions
  const drawnOrdersRef = useRef(drawnOrders)
  useEffect(() => {
    drawnOrdersRef.current = drawnOrders
    screenMarkRef.current = screenMark({
      openOrders: drawnOrders,
      positions: drawnPositions,
    })
  }, [drawnOrders, drawnPositions])

  // The last of the five marks, and the only one that has to be taken here.
  //
  // An effect rather than the reducer, for the reason the workstation's own
  // measurement states: "the state was set" is not "the operator saw it", and
  // the stage between them is exactly what the complaint is about. This runs
  // after React has committed the tree the frame produced.
  //
  // It reports and never blocks. A measurement that cannot be built or sent is
  // dropped: producing it may not change what is drawn or when.
  const frameRevision = state.frameRevision
  useEffect(() => {
    const pending = pendingFrameMarksRef.current
    if (pending.length === 0) return
    const drawn = pending.filter(entry => entry.revision <= frameRevision)
    if (drawn.length === 0) return
    pendingFrameMarksRef.current = pending.filter(entry => entry.revision > frameRevision)
    const committedAt = Date.now()
    if (!isOpenSocket(wsConnection) || typeof wsConnection?.send !== 'function') return
    // One commit may fold several reports of one filling order, of which
    // only the newest can be on the screen. The older ones were folded, not
    // lost — their fills are in the held history — and judging them against
    // a screen that has rightly moved past them is how an ordinary burst
    // used to read as 286 undelivered frames. Each entry is judged at its
    // own commit: the newest report of each order against the screen, the
    // ones behind it as superseded within this commit.
    const newestReportOf = new Map()
    for (const entry of drawn) {
      if (entry.resource !== 'orders' || entry.report === null) continue
      newestReportOf.set(
        orderIdentity(normalizeOrderSource(entry.report, 'REGULAR')),
        entry.revision,
      )
    }
    for (const entry of drawn) {
      const measured = measureFrameMarks(entry.marks, {
        receivedAt: entry.receivedAt,
        committedAt,
      })
      // Marks that do not describe a journey — a clock stepped backwards
      // between two of them — cost this line and nothing else.
      if (measured === null) continue
      try {
        wsConnection.send(JSON.stringify({
          action: 'report_frame_marks',
          resource: entry.resource,
          symbol: entry.symbol,
          identity: entry.identity,
          status: entry.status,
          // Four readings, and the last is the one worth having.
          //
          // `DELIVERED` — the screen shows what this frame said, and drawing it
          // moved something. `UNCHANGED` — the screen already showed it: the
          // sibling frame of the same fill got there first, or the exchange
          // restated what was drawn. `SUPERSEDED` — a newer report of the same
          // order was folded into the same commit, and its state is what the
          // screen now shows. None of the three is a fault.
          //
          // `NOT_DRAWN` — the newest state of this order is not on the screen.
          // That is the operator's complaint stated exactly, and it is what
          // the absence of a line used to look like.
          code: entry.resource === 'orders'
            && entry.report !== null
            && newestReportOf.get(
              orderIdentity(normalizeOrderSource(entry.report, 'REGULAR')),
            ) !== entry.revision
            ? 'SUPERSEDED'
            : readingOf(entry, screenMarkRef.current, drawnOrdersRef.current),
          ...measured,
        }))
      } catch {
        // A diagnostic may never raise into the desk.
      }
    }
  }, [frameRevision, wsConnection])

  // Every command carries the market activation it was issued under. The
  // backend refuses one from a superseded activation, so a command composed
  // before a market switch cannot execute after it.
  const sendCommand = useCallback((command) => {
    if (!enabled || !isOpenSocket(wsConnection) || typeof wsConnection?.send !== 'function') {
      unsentCommands.remember(command)
      return false
    }
    try {
      wsConnection.send(JSON.stringify(stampGeneration(command, marketGeneration)))
      unsentCommands.clear()
      return true
    } catch {
      unsentCommands.remember(command)
      return false
    }
  }, [enabled, marketGeneration, unsentCommands, wsConnection])

  useEffect(() => {
    sendCommandRef.current = sendCommand
  }, [sendCommand])

  // Sends a command and answers with what the exchange did with it, rather than
  // with whether the frame left. A drag that lifts an order off the book cannot
  // begin on a dispatch: it has to know the order is gone, and it has to know
  // the difference between "refused" and "no answer" — a drag started on the
  // second would show a lifted order that is still resting on the exchange.
  const awaitCommandOutcome = useCallback((command, identity) => new Promise((resolve) => {
    const watcher = {
      ...identity,
      request: command.action,
      settle: resolve,
      timer: null,
    }
    watcher.timer = globalThis.setTimeout(() => settleCommandWatcher(watcher, {
      outcome: FUTURES_COMMAND_OUTCOME.UNKNOWN,
      code: 'FUTURES_ANSWER_TIMEOUT',
      message: 'Binance has not answered this command. Check the order on Binance before acting on it.',
    }), COMMAND_ANSWER_TIMEOUT_MS)
    // Registered before it is sent: the answer cannot arrive before the frame
    // does, but the registration must not be the thing that races it.
    commandWatchersRef.current = [...commandWatchersRef.current, watcher]
    if (!sendCommand(command)) {
      settleCommandWatcher(watcher, {
        outcome: FUTURES_COMMAND_OUTCOME.REFUSED,
        code: 'LOCAL_CONNECTION_UNAVAILABLE',
        message: 'Local backend connection unavailable — nothing was sent.',
      })
    }
  }), [sendCommand, settleCommandWatcher])

  // The cancellation a drag waits on. Confirmed means the exchange reported the
  // order cancelled; an order the market filled while the command was in flight
  // is refused, not confirmed, because nothing is owed for an order that traded.
  const cancelOrderAndConfirm = useCallback(({
    symbol: orderSymbol,
    orderId,
    origClientOrderId,
  } = {}) => {
    const command = createFuturesCancelOrderCommand({
      symbol: orderSymbol ?? symbolRef.current,
      orderId,
      origClientOrderId,
    })
    return awaitCommandOutcome(command, {
      kind: 'cancel',
      symbol: command.symbol,
      orderId: orderId ?? null,
      // The order's own client id, not the command's: the cancellation report
      // echoes the order that was cancelled.
      clientOrderId: origClientOrderId ?? null,
    })
  }, [awaitCommandOutcome])

  const placeOrderAndConfirm = useCallback(({
    symbol: orderSymbol,
    side,
    orderType = 'LIMIT',
    price,
    quantity,
    positionSide,
    reduceOnly,
  } = {}) => {
    const command = createFuturesPlaceOrderCommand({
      symbol: orderSymbol ?? symbolRef.current,
      side,
      orderType,
      price,
      quantity,
      positionSide,
      reduceOnly,
    })
    return awaitCommandOutcome(command, {
      kind: 'place',
      symbol: command.symbol,
      orderId: null,
      // Binance echoes the id the command minted, which is how a placement is
      // recognised before it has an order id at all.
      clientOrderId: command.clientOrderId,
    })
  }, [awaitCommandOutcome])

  // Resends the exact command that never left the renderer, identity and all.
  // Rebuilding it would mint a new client order id and the exchange could no
  // longer tell the two attempts apart.
  const retryUnsentCommand = useCallback(() => {
    const pending = unsentCommands.peek()
    return pending ? sendCommand(pending) : false
  }, [sendCommand, unsentCommands])

  const placeOrder = useCallback(({
    symbol: orderSymbol,
    side,
    orderType = 'LIMIT',
    price,
    quantity,
    positionSide,
    reduceOnly,
  }) => sendCommand(createFuturesPlaceOrderCommand({
    symbol: orderSymbol ?? symbolRef.current,
    side,
    orderType,
    price,
    quantity,
    positionSide,
    reduceOnly,
  })), [sendCommand])

  // A command the renderer withheld — for readiness, for a leg it could not
  // resolve, for a cancel already in flight — never reaches the main process,
  // and on 2026-09-02 left no line while the operator could not get out. The
  // report rides the same link as the display transitions: validated by the
  // record, reaching no exchange, blocking nothing.
  const reportWithheld = useCallback(({ command, code, symbol: orderSymbol = null, identity = null }) => {
    if (!enabled || !isOpenSocket(wsConnection) || typeof wsConnection?.send !== 'function') return
    try {
      wsConnection.send(JSON.stringify({
        action: 'report_withheld_command',
        command,
        code,
        market: 'futures',
        symbol: orderSymbol ?? symbolRef.current ?? null,
        identity,
      }))
    } catch {
      // Reporting only: the desk never waits on its own diagnostics.
    }
  }, [enabled, wsConnection])

  // One cancel in flight per order. Four cancellations of one order left the
  // renderer in six seconds on 2026-09-02 — nothing on the row said one was
  // already out — and three came back `-2011`. The key is released by the
  // answer, the refusal, the unresolved report or the answer watcher.
  const cancelsInFlightRef = useRef(new Map())
  const [cancellingOrderIds, setCancellingOrderIds] = useState(NO_CANCELS_IN_FLIGHT)
  const cancelKeyOf = (orderSymbol, orderId, origClientOrderId) => (
    `${orderSymbol}:${orderId ?? ''}:${origClientOrderId ?? ''}`
  )
  const syncCancelling = useCallback(() => {
    const ids = [...cancelsInFlightRef.current.values()]
    setCancellingOrderIds(previous => (
      previous.length === ids.length && previous.every((id, index) => id === ids[index])
        ? previous
        : Object.freeze(ids)
    ))
  }, [])

  const cancelOrder = useCallback(({ symbol: orderSymbol, orderId, origClientOrderId }) => {
    const symbol = orderSymbol ?? symbolRef.current
    const key = cancelKeyOf(symbol, orderId, origClientOrderId)
    if (cancelsInFlightRef.current.has(key)) {
      reportWithheld({
        command: 'trade.cancelOrder',
        code: 'CANCEL_IN_FLIGHT',
        symbol,
        identity: orderId ?? origClientOrderId ?? null,
      })
      return false
    }
    const command = createFuturesCancelOrderCommand({ symbol, orderId, origClientOrderId })
    cancelsInFlightRef.current.set(key, String(orderId ?? origClientOrderId ?? ''))
    syncCancelling()
    const release = () => {
      cancelsInFlightRef.current.delete(key)
      syncCancelling()
    }
    awaitCommandOutcome(command, {
      kind: 'cancel',
      symbol,
      orderId: orderId ?? null,
      clientOrderId: origClientOrderId ?? null,
    }).then(release, release)
    return true
  }, [awaitCommandOutcome, reportWithheld, syncCancelling])

  // Atomic reprice, for the surface that reprices by typing: a rejected
  // amendment leaves the original order untouched on the exchange. The chart
  // drag is cancel-and-place instead, by design — see `useFuturesOrderDrag`.
  const modifyOrder = useCallback(({
    symbol: orderSymbol,
    side,
    orderId,
    origClientOrderId,
    price,
    quantity,
  }) => sendCommand(createFuturesModifyOrderCommand({
    symbol: orderSymbol ?? symbolRef.current,
    side,
    orderId,
    origClientOrderId,
    price,
    quantity,
  })), [sendCommand])

  const cancelAll = useCallback((targetSymbol) => sendCommand(createFuturesCancelAllCommand({
    symbol: targetSymbol ?? symbolRef.current,
  })), [sendCommand])

  // A partial close is still a close. Hedge-mode rows state their leg outright
  // and that statement wins over quantity sign: some normalized/test sources
  // carry a positive size for SHORT, which must be bought back, never sold into.
  // One-way BOTH rows retain the exchange's signed-quantity convention.
  const closePosition = useCallback((position, { quantity: requestedQuantity } = {}) => {
    const openQuantity = Math.abs(Number(position?.quantity))
    const quantity = requestedQuantity === undefined || requestedQuantity === null
      ? openQuantity
      : Math.abs(Number(requestedQuantity))
    if (!Number.isFinite(openQuantity) || openQuantity <= 0) return false
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > openQuantity) return false
    const positionSide = String(position?.positionSide ?? '').toUpperCase()
    const closeSide = positionSide === 'SHORT'
      ? 'BUY'
      : positionSide === 'LONG'
        ? 'SELL'
        : Number(position.quantity) > 0 ? 'SELL' : 'BUY'
    return sendCommand(createFuturesPlaceOrderCommand({
      symbol: position.symbol,
      side: closeSide,
      orderType: 'MARKET',
      quantity,
      positionSide: position.positionSide,
      reduceOnly: true,
    }))
  }, [sendCommand])

  // Margin moves on one named position: the symbol and the leg always come
  // from the position row, never from whichever contract is on screen.
  const adjustPositionMargin = useCallback(({
    symbol: positionSymbol,
    positionSide,
    direction,
    amount,
  } = {}) => {
    if (!positionSymbol) return false
    return sendCommand(createFuturesAdjustPositionMarginCommand({
      symbol: positionSymbol,
      positionSide,
      direction,
      amount,
    }))
  }, [sendCommand])

  // `views` names the endpoints this read is for — the view the operator has
  // open. Reading both costs a second fan-out answering a panel nobody is
  // looking at: twelve contracts, one request each, through a queue that spaces
  // every request 150ms from the last.
  const loadHistory = useCallback((targetSymbol, {
    basisOnly = false,
    full = false,
    // Why the panel asks: `open`, `refresh` or `full`, from the control that
    // asked. The command drops anything outside its closed set.
    reason = null,
    views = null,
  } = {}) => {
    if (!state.historyStoreReady) return false
    const symbolToLoad = targetSymbol ?? symbolRef.current
    const sent = sendCommand(createFuturesAccountHistoryCommand({
      coverage: state.history.coverage,
      basisOnly,
      full,
      reason,
      symbol: symbolToLoad,
      views,
    }))
    // The rows already read stay on screen while the read is in flight: emptying
    // them makes the operator wait a second time for what they were reading.
    setState(previous => ({
      ...previous,
      history: beginFuturesHistoryRead(previous.history, { symbol: symbolToLoad, sent }),
    }))
    return sent
  }, [sendCommand, state.history.coverage, state.historyStoreReady])

  // View-driven reads still come through this command. The independent basis
  // effect below uses the same path with `basisOnly`, so current position money
  // no longer depends on which history tab the operator happened to open.

  const refresh = useCallback((targetSymbol) => {
    const command = createFuturesAccountRefreshCommand({
      manual: true,
      symbol: targetSymbol ?? symbolRef.current,
    })
    const accepted = sendCommand(command)
    if (accepted) {
      setManualRefreshReceipt(previous => {
        const requestedAt = Date.now()
        if (previous !== null && previous.requestedAt > requestedAt) return previous
        return Object.freeze({
          version: 1,
          status: 'sending',
          request: command.clientOrderId,
          requestedAt,
          accountFingerprint: state.accountFingerprint,
          accountDisposition: 'resource',
          settledIncomeDisposition: 'resource',
        })
      })
    }
    return accepted
  }, [sendCommand, state.accountFingerprint])

  // Everything above learns that an order is gone from a message: the stream's
  // report, or the snapshot a mutation asks for. If no message arrives — a
  // socket that stopped delivering without closing, an event the exchange never
  // sent — nothing re-reads at all, and an order that filled rests in the list
  // until the application is reloaded. So while orders are working, the account
  // is re-read on a slow beat, and the settled memory decides what the read is
  // allowed to say.
  //
  // Only while they are working: with nothing resting there is nothing to go
  // stale this way, and the read is not free.
  const hasWorkingOrders = state.openOrders.length > 0
  useEffect(() => {
    if (!enabled || !isUsableSocket(wsConnection) || !hasWorkingOrders) return undefined
    const reconcile = setInterval(() => {
      sendCommand(createFuturesAccountRefreshCommand({
        symbol: symbolRef.current,
        // A timer, not a person. It polls for resting orders going stale; it is
        // not somebody looking at a figure and asking why it has not moved.
        periodic: true,
      }))
    }, ACCOUNT_RECONCILE_INTERVAL_MS)
    return () => clearInterval(reconcile)
  }, [enabled, hasWorkingOrders, sendCommand, wsConnection])

  // A read, not a write: what leverage this contract is set to and how far it may
  // be set. Asked for per contract rather than folded into the account refresh,
  // which costs ninety weight and answers for the account, not for one symbol.
  const loadSymbolConfig = useCallback((targetSymbol) => sendCommand(
    createFuturesSymbolConfigCommand({ symbol: targetSymbol ?? symbolRef.current }),
  ), [sendCommand])

  // Leverage names its contract explicitly — never the one on screen — because
  // applying it to the wrong contract reprices every position on that contract.
  const setLeverage = useCallback(({ symbol: targetSymbol, leverage } = {}) => {
    if (!targetSymbol) return false
    return sendCommand(createFuturesSetLeverageCommand({ symbol: targetSymbol, leverage }))
  }, [sendCommand])

  // The margin mode names its contract on the same terms as the leverage: what
  // it decides is whether a losing position is capped at its own margin or
  // stands behind the whole wallet.
  const setMarginType = useCallback(({ symbol: targetSymbol, marginType } = {}) => {
    if (!targetSymbol) return false
    return sendCommand(createFuturesSetMarginTypeCommand({ symbol: targetSymbol, marginType }))
  }, [sendCommand])

  const setTradingPaused = useCallback(paused => sendCommand(
    createFuturesSetTradingPausedCommand({ paused }),
  ), [sendCommand])

  // Account positions stay stable between account/config events. Live market
  // valuation lives in the per-symbol external store, so a mark tick does not
  // invalidate command state or the held-history tree.
  const positions = useMemo(
    () => mergeFuturesPositionConfigs(state.positions, state.symbolConfigs),
    [state.positions, state.symbolConfigs],
  )
  const roundPositionSignature = useMemo(
    () => futuresRoundPositionSignature(positions),
    [positions],
  )
  const historyReconcileRef = useRef(null)
  useEffect(() => {
    if (!enabled || !isUsableSocket(wsConnection) || !state.historyStoreReady
      || state.accountFingerprint === null
      || state.accountResources.positions?.status !== 'ready') return
    const missingSettlementEvidence = state.history.trades.some(trade => (
      typeof trade?.marginAsset !== 'string' || trade.marginAsset.trim() === ''
    ))
    const generation = state.historyReconcileGeneration
    if (!missingSettlementEvidence && generation <= 0) return
    // `account.history` is refused without a symbol, and this effect fires at
    // start before a contract has been chosen — the desk's own journal showed
    // the refusal once per session start (INVALID_TYPED_HISTORY_SYMBOL, from
    // 2026-08-22 on), and the offline-gap close it asked for was silently
    // lost. Any contract the account holds names the read as well as the one
    // on screen; with neither, wait — the effect re-runs when positions land.
    const reconcileSymbol = symbolRef.current
      || state.positions[0]?.symbol
      || state.history.symbols?.[0]
      || null
    if (reconcileSymbol === null) return
    const key = [
      state.accountFingerprint,
      generation,
      missingSettlementEvidence ? 'asset-migration' : 'stream-gap',
    ].join(':')
    if (historyReconcileRef.current === key) return
    const sent = sendCommand(createFuturesAccountHistoryCommand({
      basisOnly: false,
      // Old rows without marginAsset cannot be repaired by paging forward from
      // their identity. Re-enumerate the bounded window once; ordinary stream
      // reconnects need only the cheaper cursor gaps.
      full: missingSettlementEvidence,
      coverage: state.history.coverage,
      reason: 'stream',
      symbol: reconcileSymbol,
      views: ['trades'],
    }))
    if (sent) historyReconcileRef.current = key
  }, [
    enabled,
    sendCommand,
    state.accountFingerprint,
    state.accountResources.positions?.status,
    state.history.coverage,
    state.history.symbols,
    state.history.trades,
    state.historyReconcileGeneration,
    state.historyStoreReady,
    state.positions,
    wsConnection,
  ])

  const basisReadRef = useRef({
    connection: null,
    accountFingerprint: null,
    positions: null,
    progress: null,
    timer: null,
  })
  useEffect(() => {
    const clearPending = () => {
      if (basisReadRef.current.timer !== null) {
        globalThis.clearTimeout(basisReadRef.current.timer)
      }
      basisReadRef.current.timer = null
    }
    if (!enabled || !isUsableSocket(wsConnection) || !state.historyStoreReady
      || state.accountFingerprint === null
      || state.accountResources.positions?.status !== 'ready') {
      clearPending()
      basisReadRef.current = {
        connection: wsConnection,
        accountFingerprint: state.accountFingerprint,
        positions: null,
        progress: null,
        timer: null,
      }
      return
    }
    if (basisReadRef.current.connection !== wsConnection
      || basisReadRef.current.accountFingerprint !== state.accountFingerprint) {
      clearPending()
      basisReadRef.current = {
        connection: wsConnection,
        accountFingerprint: state.accountFingerprint,
        positions: null,
        progress: null,
        timer: null,
      }
    }
    const keys = positions
      .map(position => futuresTradePositionKey(
        position?.symbol,
        position?.positionSide ?? 'BOTH',
      ))
      .filter(Boolean)
      .sort()
    if (keys.length === 0) {
      clearPending()
      basisReadRef.current.positions = null
      basisReadRef.current.progress = null
      return
    }
    const positionSignature = keys.join('|')
    const sendBasisRead = () => sendCommand(createFuturesAccountHistoryCommand({
      basisOnly: true,
      coverage: state.history.coverage,
      reason: 'bootstrap',
      symbol: positions[0]?.symbol,
      views: ['trades'],
    }))
    // Even complete persisted coverage predates this authenticated activation.
    // One command lets the backend vouch the cursor against stream activity and
    // closes any fills that happened while the desk was offline.
    if (basisReadRef.current.positions !== positionSignature) {
      clearPending()
      basisReadRef.current.positions = positionSignature
      basisReadRef.current.progress = 'activation'
      if (!sendBasisRead()) basisReadRef.current.progress = null
      return
    }
    // The backend owns every continuation from here: cold/legacy acquisition,
    // older backfill, forward gap and post-gap all share one bounded checkpoint.
    // A second five-second React timer used to double the REST fan-out and could
    // arrive as an ordinary command that bypassed the post-gap commit path.
    clearPending()
    basisReadRef.current.progress = 'server-managed'
  }, [
    enabled,
    positions,
    state.accountFingerprint,
    state.accountResources.positions?.status,
    state.history.coverage,
    state.historyStoreReady,
    sendCommand,
    wsConnection,
  ])
  useEffect(() => () => {
    if (basisReadRef.current.timer !== null) {
      globalThis.clearTimeout(basisReadRef.current.timer)
    }
  }, [])

  // Whether the position basis is the account's complete open-position set. A
  // key absent from a delivered snapshot proves that position flat, which is
  // what lets the fold anchor a chain's left boundary backward from its
  // terminal. `stale` stays authoritative: it is the last confirmed snapshot
  // held across a transport loss, and no fill can arrive through the same
  // lost transport to move the account away from it.
  const positionSnapshotComplete = state.accountResources.positions?.status === 'ready'
    || state.accountResources.positions?.status === 'stale'

  // What the review would refold for. Only the burst-driven inputs trail —
  // every fill advances the trade generation and moves the position
  // signature; income, fee prices and snapshot completeness move at human
  // cadence and keep their immediate path below.
  const reviewSourceStamp = [
    state.accountFingerprint ?? '',
    Number.isSafeInteger(state.history.tradeGeneration)
      ? state.history.tradeGeneration
      : 0,
    roundPositionSignature,
    positionSnapshotComplete ? 'y' : 'n',
  ].join('~')
  const [reviewStamp, setReviewStamp] = useState(reviewSourceStamp)
  const reviewFoldLastAtRef = useRef(0)
  useEffect(() => {
    if (reviewStamp === reviewSourceStamp) return undefined
    const since = Date.now() - reviewFoldLastAtRef.current
    // Outside a burst the first change folds at once; inside one, at most
    // one fold per trailing bound, and the timer left armed at the burst's
    // end is what catches the review up without an operator action.
    if (since >= FUTURES_REVIEW_FOLD_TRAIL_MS) {
      reviewFoldLastAtRef.current = Date.now()
      setReviewStamp(reviewSourceStamp)
      return undefined
    }
    const timer = globalThis.setTimeout(() => {
      reviewFoldLastAtRef.current = Date.now()
      setReviewStamp(reviewSourceStamp)
    }, FUTURES_REVIEW_FOLD_TRAIL_MS - since)
    return () => globalThis.clearTimeout(timer)
  }, [reviewSourceStamp, reviewStamp])

  // The held review also contains orders and observation clocks. Snapshot its
  // trade-owned fields, the position basis and the snapshot completeness in
  // one cut on the trailed stamp: one moment defines the whole fold's view of
  // the account, so a position whose start is taken from one moment cannot be
  // charged for fills read at another — and an orders-only answer cannot
  // refold thousands of fills and rebuild every wallet result.
  const roundTradeHistory = useMemo(
    () => Object.freeze({
      trades: state.history.trades,
      coverage: state.history.coverage,
      foldedTrades: state.history.foldedTrades,
      generation: Number.isSafeInteger(state.history.tradeGeneration)
        ? state.history.tradeGeneration
        : 0,
      positionBasis: futuresRoundPositionBasis(roundPositionSignature),
      snapshotComplete: positionSnapshotComplete,
    }),
    // The trailed stamp is the explicit content authority for all captured
    // fields; the fingerprint keys an account re-key past the trail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.accountFingerprint, reviewStamp],
  )

  // One fold of the fills, read twice: it says when each open position began,
  // and for the same rounds what they have realized and been charged. Both
  // answers must come from one walk — a position whose start is taken from one
  // fold and whose costs are taken from another can be charged for what happened
  // before it opened.
  // The minute prices the fold values foreign-asset fees at. Absent minutes
  // answer null, the affected round degrades to "not included", and the ask
  // effect below goes and buys exactly those minutes.
  const feeValuationPriceAt = useMemo(
    () => createFuturesFeeValuationPriceLookup(state.feeValuationPrices),
    [state.feeValuationPrices],
  )
  const baseTradeRoundIndex = useMemo(() => (
    buildFuturesTradeRoundIndex(roundTradeHistory.trades, {
      coverage: roundCoverageByPosition(
        roundTradeHistory.trades,
        roundTradeHistory.coverage,
        roundTradeHistory.generation,
        roundTradeHistory.foldedTrades,
      ),
      positions: roundTradeHistory.positionBasis,
      snapshotComplete: roundTradeHistory.snapshotComplete,
      generation: roundTradeHistory.generation,
      feeValuationPriceAt,
    })
  ), [
    feeValuationPriceAt,
    roundTradeHistory,
  ])
  const settledIncomeContentRevision = futuresSettledIncomeContentRevision(
    state.settledIncome,
  )
  const walletSettledIncome = useMemo(
    () => state.settledIncome,
    // The validated revision deliberately excludes observation-only clocks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settledIncomeContentRevision],
  )
  const tradeRoundIndex = useMemo(() => {
    const base = baseTradeRoundIndex
    const walletLedger = reconcileFuturesWalletLedger({
      // Unresolved intervals are ownership barriers too. Feeding only resolved
      // rounds would let funding inside an unresolved older position fall back
      // onto an unrelated later round of the same contract. Their wallet bucket
      // stays partial and is never promoted to a numeric history row.
      rounds: base.legacyRounds,
      income: walletSettledIncome?.rows ?? [],
      incomeCoverage: walletIncomeCoverage(walletSettledIncome),
    })
    const walletByRound = new Map(walletLedger.ownership.roundOwned.map(wallet => (
      [wallet.roundId, wallet]
    )))
    const enrich = round => enrichRoundWithWallet(round, walletByRound.get(round.key) ?? null)
    const rounds = Object.freeze(base.rounds.map(enrich))
    return Object.freeze({
      ...base,
      rounds,
      all: rounds,
      open: Object.freeze(rounds.filter(round => round?.open === true)),
      closed: Object.freeze(rounds.filter(round => !round?.open && round?.exitPrice !== null)),
      walletLedger,
      sharedAdjustments: walletLedger.ownership.closedShared,
      openSharedAdjustments: walletLedger.ownership.openShared,
    })
  }, [baseTradeRoundIndex, walletSettledIncome])
  const openRounds = tradeRoundIndex.open

  // When each open position began, from that fold. One walk defines when a
  // position started for every surface that asks, so the settled money on a row
  // and the round in the history can never disagree about which fills belong to
  // it.
  //
  // A contract the fills do not reach back far enough to have seen opened has no
  // start here, and the reading built from it says so rather than presenting the
  // window's total as the position's.
  // Legacy position-row presentation consumes a lookup object. It is now keyed
  // by canonical position key so simultaneous LONG and SHORT legs never receive
  // the same symbol-wide settled total; the values themselves come from the
  // same canonical ledger as Closed Positions.
  const settledMoney = useMemo(() => {
    if (settledIncomeContentRevision === null) return null
    const entries = openRounds.map((round) => {
      const reading = settledReadingFromWallet(round, round.wallet)
      return reading === null ? null : [round.positionKey, reading]
    }).filter(Boolean)
    return Object.freeze(Object.fromEntries(entries))
  }, [openRounds, settledIncomeContentRevision])
  // The wallet's remaining BNB fee reserve, valued at the newest priced minute
  // — one global reading, marked low under its declared bound, honest about
  // absence and unreadability. The operator's only warning before Binance
  // silently reverts an empty reserve to undiscounted USDT fees.
  const feeReserve = useMemo(() => readFuturesFeeReserve({
    balances: state.balances,
    prices: state.feeValuationPrices?.BNBUSDT ?? null,
    now: Date.now(),
  }), [state.balances, state.feeValuationPrices])
  // Buys exactly the minutes the held rounds could not value, plus the newest
  // complete minute for the reserve readout. Bounded per command, answered
  // minutes never re-asked (a null answer is final), unanswered ones no more
  // than once a minute — one weight-1 page ask, not a standing stream.
  const feeValuationAsksRef = useRef(new Map())
  useEffect(() => {
    const send = sendCommandRef.current
    if (typeof send !== 'function') return
    const askedAtFloor = Date.now() - 60_000
    const needed = collectFuturesFeeValuationMissingMinutes(tradeRoundIndex.all)
    if (futuresFeeReserveWantsPrice(feeReserve)) {
      if (!needed.has(feeReserve.pair)) needed.set(feeReserve.pair, [])
      needed.get(feeReserve.pair).unshift(feeReserve.requestMinute)
    }
    for (const [pair, minutes] of needed) {
      const held = state.feeValuationPrices?.[pair] ?? {}
      const ask = []
      for (const minute of minutes) {
        if (Object.hasOwn(held, minute)) continue
        const askedAt = feeValuationAsksRef.current.get(`${pair}:${minute}`)
        if (askedAt !== undefined && askedAt > askedAtFloor) continue
        ask.push(minute)
        if (ask.length >= FUTURES_FEE_VALUATION_COMMAND_MAX_MINUTES) break
      }
      if (ask.length === 0) continue
      if (send(createFuturesFeeValuationCommand({ pair, minutes: ask })) === false) continue
      const askedAt = Date.now()
      for (const minute of ask) {
        feeValuationAsksRef.current.set(`${pair}:${minute}`, askedAt)
      }
    }
  }, [tradeRoundIndex, feeReserve, state.feeValuationPrices])
  const manualRefresh = useMemo(() => {
    const receipt = manualRefreshReceipt
    if (receipt === null || receipt.accountFingerprint !== state.accountFingerprint) return null
    const settledIncome = state.settledIncome
    return Object.freeze({
      version: receipt.version,
      status: receipt.status,
      request: receipt.request,
      requestedAt: receipt.requestedAt,
      account: manualRefreshAccountOutcome(state.accountResources, receipt.requestedAt),
      settledIncome: Object.freeze({
        disposition: receipt.settledIncomeDisposition,
        status: settledIncome?.status ?? 'idle',
        attemptedAt: finiteCoverageTime(settledIncome?.attemptedAt),
        successfulAt: finiteCoverageTime(settledIncome?.successfulAt),
        error: settledIncome?.error ?? null,
      }),
    })
  }, [manualRefreshReceipt, state.accountFingerprint, state.accountResources, state.settledIncome])
  const settledIncomeWindow = useMemo(() => (
    state.settledIncome === null ? null : Object.freeze({
      from: state.settledIncome.from,
      coveredFrom: state.settledIncome.coveredFrom ?? state.settledIncome.from ?? null,
      coveredTo: state.settledIncome.coveredTo ?? null,
      targetTo: state.settledIncome.targetTo ?? null,
      readAt: state.settledIncome.readAt,
      attemptedAt: state.settledIncome.attemptedAt ?? null,
      successfulAt: state.settledIncome.successfulAt ?? null,
      status: state.settledIncome.status ?? null,
      error: state.settledIncome.error ?? null,
      generation: state.settledIncome.generation ?? null,
      digest: state.settledIncome.digest ?? null,
      complete: state.settledIncome.complete,
    })
  ), [state.settledIncome])

  return useMemo(() => ({
    ...state,
    positions,
    positionMarkStore,
    settledMoney,
    manualRefresh,
    tradeRoundIndex,
    // The window the settled figures were read over, so a surface can say what
    // its reading covers rather than implying it covers everything.
    settledIncomeWindow,
    // The global BNB fee-reserve reading for the dock's readout.
    feeReserve,
    placeOrder,
    placeOrderAndConfirm,
    modifyOrder,
    cancelOrder,
    cancelOrderAndConfirm,
    // The orders whose cancel has left the renderer and not yet answered.
    cancellingOrderIds,
    reportWithheld,
    cancelAll,
    closePosition,
    adjustPositionMargin,
    loadHistory,
    loadSymbolConfig,
    refresh,
    retryUnsentCommand,
    setLeverage,
    setMarginType,
    setTradingPaused,
  }), [
    adjustPositionMargin,
    cancelAll,
    cancelOrder,
    cancelOrderAndConfirm,
    cancellingOrderIds,
    reportWithheld,
    closePosition,
    feeReserve,
    loadHistory,
    loadSymbolConfig,
    modifyOrder,
    placeOrder,
    placeOrderAndConfirm,
    positions,
    positionMarkStore,
    refresh,
    retryUnsentCommand,
    setLeverage,
    setMarginType,
    setTradingPaused,
    settledMoney,
    settledIncomeWindow,
    manualRefresh,
    state,
    tradeRoundIndex,
  ])
}

export default useFuturesTrading
export { useFuturesTrading }
