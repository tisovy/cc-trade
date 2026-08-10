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
  createFuturesSetTradingPausedCommand,
  createFuturesSymbolConfigCommand,
} from '../utils/tradingCommands.js'
import { createUnsentCommandStore } from '../utils/unsentTradingCommand.js'

const OPEN_ORDER_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED'])
const TERMINAL_ORDER_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'EXPIRED',
  'FILLED',
  'FINISHED',
  'REJECTED',
])
// Slow enough to stay a fraction of the exchange's weight budget — one account
// read costs ninety of the 2400 a minute — and fast enough that a settlement
// nobody told the desk about is half a minute of staleness rather than a
// permanent one.
const ACCOUNT_RECONCILE_INTERVAL_MS = 30_000

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

const isOpenSocket = (connection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return connection?.readyState === openState
}

const isUsableSocket = (connection) => isOpenSocket(connection)
  && typeof connection?.send === 'function'
  && typeof connection?.addEventListener === 'function'
  && typeof connection?.removeEventListener === 'function'

const createEmptyHistory = () => ({
  symbol: null,
  status: 'idle',
  orders: [],
  trades: [],
  error: null,
})

const createInitialState = ({ enabled, connection }) => ({
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
  history: createEmptyHistory(),
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
  return TERMINAL_ORDER_STATUSES.has(String(report?.status ?? '').toUpperCase())
    ? orderIdentity(report)
    : null
}

const isOpenSnapshotOrder = order => (
  !TERMINAL_ORDER_STATUSES.has(String(order?.status ?? '').toUpperCase())
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
const useFuturesTrading = ({ enabled, symbol, wsConnection } = {}) => {
  const [state, setState] = useState(() => createInitialState({
    enabled,
    connection: wsConnection,
  }))
  const symbolRef = useRef(symbol)
  const unsentCommandsRef = useRef(null)
  if (unsentCommandsRef.current === null) {
    unsentCommandsRef.current = createUnsentCommandStore()
  }
  const unsentCommands = unsentCommandsRef.current

  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    if (!enabled || !isUsableSocket(wsConnection)) {
      // Keep the last-known account snapshot so re-entering Futures mode is
      // usable immediately; the refresh sent on re-enable reconciles it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(previous => (previous.connected === false && previous.lastError === null
        ? previous
        : { ...previous, connected: false, lastError: null }))
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
            // An execution report is the answer an unresolved command was waiting
            // for, whether it arrived from the stream or from reconciliation.
            unresolvedCommand: null,
            settledOrders,
            openOrders: mergeOrderUpdate(previous.openOrders, report, settledOrders),
          }
        })
      }
      if (payload.futures_history && typeof payload.futures_history === 'object') {
        const history = payload.futures_history
        setState(previous => ({
          ...previous,
          connected: true,
          history: {
            symbol: typeof history.symbol === 'string' ? history.symbol : previous.history.symbol,
            status: history.error ? 'error' : 'ready',
            orders: Array.isArray(history.orders) ? history.orders : [],
            trades: Array.isArray(history.trades) ? history.trades : [],
            error: history.error ?? null,
          },
        }))
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
        // A rejection settles whatever was pending: the exchange answered.
        setState(previous => ({
          ...previous,
          lastError: payload.command_rejected,
          unresolvedCommand: null,
        }))
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
      }
    }

    const handleDisconnect = () => {
      if (!active) return
      setState(previous => ({ ...previous, connected: false }))
    }

    wsConnection.addEventListener('message', handleMessage)
    wsConnection.addEventListener('close', handleDisconnect)
    wsConnection.addEventListener('error', handleDisconnect)

    try {
      wsConnection.send(JSON.stringify(createFuturesAccountRefreshCommand({
        symbol: symbolRef.current,
      })))
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
  }, [enabled, wsConnection])

  const sendCommand = useCallback((command) => {
    if (!enabled || !isOpenSocket(wsConnection) || typeof wsConnection?.send !== 'function') {
      unsentCommands.remember(command)
      return false
    }
    try {
      wsConnection.send(JSON.stringify(command))
      unsentCommands.clear()
      return true
    } catch {
      unsentCommands.remember(command)
      return false
    }
  }, [enabled, unsentCommands, wsConnection])

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

  // Atomic reprice. Never falls back to cancel + place: a rejected amendment
  // leaves the original order untouched on the exchange.
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

  const loadHistory = useCallback((targetSymbol) => {
    const symbolToLoad = targetSymbol ?? symbolRef.current
    const sent = sendCommand(createFuturesAccountHistoryCommand({ symbol: symbolToLoad }))
    setState(previous => ({
      ...previous,
      history: sent
        ? { symbol: symbolToLoad, status: 'loading', orders: [], trades: [], error: null }
        : {
            symbol: symbolToLoad,
            status: 'error',
            orders: [],
            trades: [],
            error: { code: 'LOCAL_CONNECTION_UNAVAILABLE' },
          },
    }))
    return sent
  }, [sendCommand])

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
    modifyOrder,
    cancelOrder,
    cancelAll,
    closePosition,
    adjustPositionMargin,
    loadHistory,
    loadSymbolConfig,
    refresh,
    retryUnsentCommand,
    setLeverage,
    setTradingPaused,
  }), [
    adjustPositionMargin,
    cancelAll,
    cancelOrder,
    closePosition,
    loadHistory,
    loadSymbolConfig,
    modifyOrder,
    placeOrder,
    positions,
    refresh,
    retryUnsentCommand,
    setLeverage,
    setTradingPaused,
    state,
  ])
}

export default useFuturesTrading
export { useFuturesTrading }
