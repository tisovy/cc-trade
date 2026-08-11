import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  mergeFuturesPositionMarks,
  readFuturesPositionMarks,
} from '../utils/futuresPositionMarks.js'
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
  // Live mark prices, keyed by symbol. Kept beside the snapshot rather than
  // folded into it, so a dropped feed loses only the overlay.
  positionMarks: {},
  // Leverage and margin mode, keyed by symbol: the two things the position read
  // stopped reporting. Held beside the snapshot for the same reason as the marks.
  symbolConfigs: {},
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
})

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
  }, [marketGeneration])

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

    const handleMessage = (event) => {
      if (!active) return
      let payload
      try {
        payload = JSON.parse(event?.data)
      } catch {
        return
      }
      if (payload === null || typeof payload !== 'object') return

      if (payload.type === 'futures_account_state') {
        setState(previous => applyAccountEnvelope(previous, payload))
      }
      if (payload.type === 'futures_position_marks') {
        const positionMarks = readFuturesPositionMarks(payload.marks)
        if (positionMarks !== null) {
          setState(previous => ({ ...previous, positionMarks }))
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
      if (payload.futures_execution_update) {
        const report = payload.futures_execution_update
        setState((previous) => {
          const settled = settledReportIdentity(report)
          const settledOrders = settled === null
            ? previous.settledOrders
            : rememberSettledOrder(previous.settledOrders, settled)
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
            openOrders: mergeOrderUpdate(previous.openOrders, report, settledOrders),
            // The review of the past is maintained by the same stream the live
            // panels are: an order that settles or a fill that closes a position
            // belongs in it without asking Binance for the account again.
            history: foldExecutionIntoFuturesHistory(previous.history, report),
          }
        })
        answerCommandWatchers({ kind: 'execution', report })
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

    wsConnection.addEventListener('message', handleMessage)
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
      wsConnection.removeEventListener('message', handleMessage)
      wsConnection.removeEventListener('close', handleDisconnect)
      wsConnection.removeEventListener('error', handleDisconnect)
    }
  }, [abandonCommandWatchers, answerCommandWatchers, enabled, wsConnection])

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

  const loadHistory = useCallback((targetSymbol, { full = false } = {}) => {
    if (!state.historyStoreReady) return false
    const symbolToLoad = targetSymbol ?? symbolRef.current
    const sent = sendCommand(createFuturesAccountHistoryCommand({
      coverage: state.history.coverage,
      full,
      symbol: symbolToLoad,
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
      sendCommand(createFuturesAccountRefreshCommand({ symbol: symbolRef.current }))
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

  // Every position surface reads the same re-valued list, so the ticket and the
  // dock can never disagree about what a position is worth — or about the
  // leverage it is carried at, which the position read no longer reports.
  const positions = useMemo(
    () => mergeFuturesPositionMarks(
      mergeFuturesPositionConfigs(state.positions, state.symbolConfigs),
      state.positionMarks,
    ),
    [state.positions, state.positionMarks, state.symbolConfigs],
  )

  return useMemo(() => ({
    ...state,
    positions,
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
    refresh,
    retryUnsentCommand,
    setLeverage,
    setMarginType,
    setTradingPaused,
    state,
  ])
}

export default useFuturesTrading
export { useFuturesTrading }
