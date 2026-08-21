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
  createFuturesAccountHistoryCommand,
  createFuturesAccountRefreshCommand,
  createFuturesAdjustPositionMarginCommand,
  createFuturesCancelAllCommand,
  createFuturesCancelOrderCommand,
  createFuturesModifyOrderCommand,
  createFuturesPlaceOrderCommand,
  createFuturesSetLeverageCommand,
  createFuturesSetMarginTypeCommand,
  createFuturesSetTradingPausedCommand,
  createFuturesSymbolConfigCommand,
} from '../utils/tradingCommands.js'
import { describeFuturesAlgoTrigger } from '../utils/futuresOrderPresentation.js'
import {
  foldFuturesSettledMoney,
  readFuturesOpenPositionStarts,
  readFuturesSettledIncomeFrame,
} from '../utils/futuresSettledMoney.js'
import buildFuturesTradeRounds from '../utils/futuresTradeRounds.js'
import { DESK_FRAME_KINDS, ensureDeskFrameRouter } from '../utils/deskFrameRouter.js'
import { measureFrameMarks } from '../utils/frameMarks.js'
import { createUnsentCommandStore } from '../utils/unsentTradingCommand.js'
import { answersUnresolvedCommand } from '../utils/unresolvedCommandIdentity.js'
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
  foldExecutionIntoFuturesHistory,
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

// How long a caller waits for the exchange's answer before the silence itself
// becomes the answer. The backend states an ambiguous outcome immediately and
// reconciles it over a few seconds, so this only bounds total silence — a
// caller that waited forever would hold a drag open on a dead connection.
const COMMAND_ANSWER_TIMEOUT_MS = 15_000

const ACCOUNT_RESOURCE_NAMES = [
  'balances',
  'positions',
  'regularOrders',
  'algoOrders',
  'userDataStream',
]

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
  // Which marked frame this state was produced by. Only frames the exchange
  // caused move it, so the commit effect below runs on those and on nothing
  // else — a state set for any other reason leaves it where it was.
  frameRevision: 0,
})

// What one drawn frame is recorded as. Kept beside the marks rather than in the
// effect, so the three readings can be read in one place.
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

const applyAccountEnvelope = (previous, payload) => {
  if (payload?.type !== 'futures_account_state'
    || payload.version !== 1
    || !payload.resources
    || typeof payload.resources !== 'object') return previous

  const accountResources = {
    ...previous.accountResources,
    ...Object.fromEntries(ACCOUNT_RESOURCE_NAMES.flatMap(resource => (
      payload.resources[resource] && typeof payload.resources[resource] === 'object'
        ? [[resource, payload.resources[resource]]]
        : []
    ))),
  }
  const balances = accountResources.balances?.data ?? null
  const positions = Array.isArray(accountResources.positions?.data)
    ? accountResources.positions.data
    : previous.positions
  const knownOrders = new Map(previous.openOrders.map(order => [orderIdentity(order), order]))
  const regularOrders = Array.isArray(accountResources.regularOrders?.data)
    ? accountResources.regularOrders.data.map(order => normalizeOrderSource(order, 'REGULAR'))
    : []
  const algoOrders = Array.isArray(accountResources.algoOrders?.data)
    ? accountResources.algoOrders.data.map(order => normalizeOrderSource(order, 'ALGO'))
    : []

  return {
    ...previous,
    connected: true,
    accountResources,
    balances,
    positions,
    // The exchange's warning stands until the position it names says it should
    // not: closed, smaller, or with more margin behind it. Nothing else takes it
    // down, because nothing else is the exchange talking about that position.
    marginCalls: pruneFuturesMarginCalls(previous.marginCalls, positions),
    openOrders: [...regularOrders, ...algoOrders]
      .filter(isOpenSnapshotOrder)
      .filter(order => !previous.settledOrders.has(orderIdentity(order)))
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
  const [positionMarkStore] = useState(() => createFuturesPositionMarkStore())
  const symbolRef = useRef(symbol)
  // Read inside the connection effect, which must not re-run when only the
  // generation changes: re-running it would resend the account refresh.
  const generationRef = useRef(marketGeneration)
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
    // Feed publication revisions are scoped to one backend activation, while
    // this external store deliberately survives React renders. Reset both its
    // readings and revision admission when the activation changes so revision
    // 1 from the new feed cannot be rejected behind a larger old revision.
    positionMarkStore.clear({ retireEpoch: true })
  }, [marketGeneration, positionMarkStore])

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

  // The review is on screen before anything is asked of the exchange. A settled
  // order and an executed trade do not change while the desk is closed, so what
  // an earlier run read is presented from the local store — stamped with when it
  // was read, so nobody mistakes it for a reading taken now. A store that will
  // not open leaves the review exactly as it is without one.
  useEffect(() => {
    if (!enabled || historyStoreUnavailable) return undefined
    let abandoned = false
    void (async () => {
      let restored = null
      try {
        restored = restoreFuturesHistoryFromStore(await historyStore?.readContracts?.())
      } catch {
        restored = null
      }
      if (abandoned) return
      setState((previous) => {
        // A read answered while the store was opening. The exchange's own answer
        // is the newer of the two and wins outright.
        const history = restored !== null && previous.history.readAt === null
          ? restored
          : previous.history
        return { ...previous, history, historyStoreReady: true }
      })
    })()
    return () => { abandoned = true }
  }, [enabled, historyStore, historyStoreUnavailable])

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        const revision = armFrameMarks({ resource: 'account' })
        setState((previous) => {
          const next = applyAccountEnvelope(previous, payload)
          return revision === 0 ? next : { ...next, frameRevision: revision }
        })
      }
      if (payload.type === 'futures_position_marks') {
        positionMarkStore.replace(payload.marks, payload.revision, payload.feedEpoch)
      }
      if (payload.type === 'futures_settled_income') {
        const settledIncome = readFuturesSettledIncomeFrame(payload)
        if (settledIncome !== null) {
          setState(previous => ({ ...previous, settledIncome }))
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
        setState((previous) => {
          const settled = settledReportIdentity(report)
          const withReport = settled === null
            ? previous.settledOrders
            : rememberSettledOrder(previous.settledOrders, settled)
          // A spawned order that filled or was cancelled has finished what its
          // parent was placed to do. The parent is remembered as settled for
          // the same reason any other settled order is: the algo snapshot is
          // read from a different Binance service than the stream and can still
          // describe it as resting.
          const settledOrders = parentSettled
            ? rememberSettledOrder(withReport, parentIdentity)
            : withReport
          const merged = mergeOrderUpdate(previous.openOrders, report, settledOrders)
          return {
            ...previous,
            connected: true,
            lastExecution: report,
            lastError: null,
            // An execution report answers an unresolved command only when it is
            // that command's report. Another order's update says nothing about
            // the one whose fate is unknown.
            unresolvedCommand: answersUnresolvedCommand(previous.unresolvedCommand, {
              symbol: report?.symbol,
              orderId: report?.orderId ?? report?.i,
              clientOrderId: report?.clientOrderId ?? report?.c,
            })
              ? null
              : previous.unresolvedCommand,
            settledOrders,
            openOrders: parentSettled
              ? merged.filter(order => orderIdentity(order) !== parentIdentity)
              : merged,
            // The review of the past is maintained by the same stream the live
            // panels are: an order that settles or a fill that closes a position
            // belongs in it without asking Binance for the account again.
            history: foldExecutionIntoFuturesHistory(previous.history, report),
            ...(frameRevisionForReport === 0
              ? {}
              : { frameRevision: frameRevisionForReport }),
          }
        })
        answerCommandWatchers({ kind: 'execution', report })
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
        const readAt = Date.now()
        setState(previous => ({
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
                // Which endpoints this answer covered, so the store replaces
                // only those and the view it did not read keeps what it holds.
                views: history.views,
                readAt,
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
      positionMarkStore.clear()
      unsubscribe()
      wsConnection.removeEventListener('close', handleDisconnect)
      wsConnection.removeEventListener('error', handleDisconnect)
    }
  }, [abandonCommandWatchers, answerCommandWatchers, enabled, positionMarkStore, wsConnection])

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
          // Three readings, and the third is the one worth having.
          //
          // `DELIVERED` — the screen shows what this frame said, and drawing it
          // moved something. `UNCHANGED` — the screen already showed it: the
          // sibling frame of the same fill got there first, or the exchange
          // restated what was drawn. Neither is a fault.
          //
          // `NOT_DRAWN` — the frame arrived and the screen does not show what
          // it said. That is the operator's complaint stated exactly, and it is
          // what the absence of a line used to look like.
          code: readingOf(entry, screenMarkRef.current, drawnOrdersRef.current),
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

  const cancelOrder = useCallback(({ symbol: orderSymbol, orderId, origClientOrderId }) => (
    sendCommand(createFuturesCancelOrderCommand({
      symbol: orderSymbol ?? symbolRef.current,
      orderId,
      origClientOrderId,
    }))
  ), [sendCommand])

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

  // A partial close is still a close: the side always comes from the open
  // position's sign, never from the requested size.
  const closePosition = useCallback((position, { quantity: requestedQuantity } = {}) => {
    const openQuantity = Math.abs(Number(position?.quantity))
    const quantity = requestedQuantity === undefined || requestedQuantity === null
      ? openQuantity
      : Math.abs(Number(requestedQuantity))
    if (!Number.isFinite(openQuantity) || openQuantity <= 0) return false
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > openQuantity) return false
    return sendCommand(createFuturesPlaceOrderCommand({
      symbol: position.symbol,
      side: Number(position.quantity) > 0 ? 'SELL' : 'BUY',
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
  const loadHistory = useCallback((targetSymbol, { full = false, views = null } = {}) => {
    if (!state.historyStoreReady) return false
    const symbolToLoad = targetSymbol ?? symbolRef.current
    const sent = sendCommand(createFuturesAccountHistoryCommand({
      coverage: state.history.coverage,
      full,
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

  // The opening read is not issued here. This hook is mounted by the workspace,
  // which is not told which contract is on screen — `symbolRef` is undefined for
  // its whole life — and a history command without a symbol is completed by the
  // backend from the *panel's* selection or refused outright. The workstation
  // issues it, because the workstation is what knows the contract.

  const refresh = useCallback((targetSymbol) => sendCommand(createFuturesAccountRefreshCommand({
    symbol: targetSymbol ?? symbolRef.current,
  })), [sendCommand])

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

  // One fold of the fills, read twice: it says when each open position began,
  // and for the same rounds what they have realized and been charged. Both
  // answers must come from one walk — a position whose start is taken from one
  // fold and whose costs are taken from another can be charged for what happened
  // before it opened.
  const tradeRoundIndex = useMemo(() => {
    const all = buildFuturesTradeRounds(state.history.trades, {
      income: state.settledIncome?.rows ?? null,
      incomeFrom: state.settledIncome?.from ?? null,
    })
    return Object.freeze({
      all,
      open: Object.freeze(all.filter(round => round?.open === true)),
      closed: Object.freeze(all.filter(round => !round?.open && round?.exitPrice !== null)),
    })
  }, [state.history.trades, state.settledIncome])
  const openRounds = tradeRoundIndex.open

  // When each open position began, from that fold. One walk defines when a
  // position started for every surface that asks, so the settled money on a row
  // and the round in the history can never disagree about which fills belong to
  // it.
  //
  // A contract the fills do not reach back far enough to have seen opened has no
  // start here, and the reading built from it says so rather than presenting the
  // window's total as the position's.
  const openPositionStarts = useMemo(() => {
    const open = new Set(positions
      .filter(position => Number(position?.quantity) !== 0)
      .map(position => String(position?.symbol ?? '').toUpperCase()))
    if (open.size === 0) return {}
    return readFuturesOpenPositionStarts(openRounds, open)
  }, [positions, openRounds])

  // What each open position has already settled. Folded here rather than in the
  // main process because it takes both halves — the exchange's income rows and
  // the fills that say when each position opened — and only the renderer holds
  // the second.
  const settledMoney = useMemo(() => {
    if (state.settledIncome === null) return null
    return foldFuturesSettledMoney(state.settledIncome.rows, {
      starts: openPositionStarts,
      // What the fills already state: the realized PnL of the parts closed out
      // of each open position and the commission its fills were charged. Read
      // from the trade record rather than from the income record, which states
      // the same two things again one row per fill — thirteen thousand rows a
      // week on this account, against the forty-five funding charges that are
      // the only reason the income record is read at all.
      rounds: openRounds,
      // How far back the read actually reached. Without it a contract is
      // reported complete on the strength of knowing when its position began,
      // which says nothing about whether the charges since then were read.
      from: state.settledIncome.from,
    })
  }, [state.settledIncome, openPositionStarts, openRounds])

  return useMemo(() => ({
    ...state,
    positions,
    positionMarkStore,
    settledMoney,
    tradeRoundIndex,
    // The window the settled figures were read over, so a surface can say what
    // its reading covers rather than implying it covers everything.
    settledIncomeWindow: state.settledIncome === null ? null : Object.freeze({
      from: state.settledIncome.from,
      readAt: state.settledIncome.readAt,
      complete: state.settledIncome.complete,
    }),
    placeOrder,
    placeOrderAndConfirm,
    modifyOrder,
    cancelOrder,
    cancelOrderAndConfirm,
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
    closePosition,
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
    state,
    tradeRoundIndex,
  ])
}

export default useFuturesTrading
export { useFuturesTrading }
