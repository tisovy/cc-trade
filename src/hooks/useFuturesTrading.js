import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createFuturesAccountRefreshCommand,
  createFuturesCancelAllCommand,
  createFuturesCancelOrderCommand,
  createFuturesPlaceOrderCommand,
  createFuturesSetTradingPausedCommand,
} from '../utils/tradingCommands.js'

const OPEN_ORDER_STATUSES = new Set(['NEW', 'PARTIALLY_FILLED'])

const isOpenSocket = (connection) => {
  const openState = globalThis.WebSocket?.OPEN ?? 1
  return connection?.readyState === openState
}

const isUsableSocket = (connection) => isOpenSocket(connection)
  && typeof connection?.send === 'function'
  && typeof connection?.addEventListener === 'function'
  && typeof connection?.removeEventListener === 'function'

const createInitialState = ({ enabled, connection }) => ({
  connected: Boolean(enabled && isUsableSocket(connection)),
  balances: null,
  openOrders: [],
  positions: [],
  lastExecution: null,
  lastError: null,
  tradingPaused: false,
})

const mergeOrderUpdate = (openOrders, report) => {
  if (!report || typeof report.orderId === 'undefined') return openOrders
  const withoutOrder = openOrders.filter(order => (
    String(order.orderId) !== String(report.orderId)
  ))
  if (OPEN_ORDER_STATUSES.has(report.status)) {
    return [...withoutOrder, report]
  }
  return withoutOrder
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

  useEffect(() => {
    symbolRef.current = symbol
  }, [symbol])

  useEffect(() => {
    if (!enabled || !isUsableSocket(wsConnection)) {
      const reset = createInitialState({ enabled, connection: wsConnection })
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(previous => (previous.connected === reset.connected
        && previous.openOrders.length === 0 && previous.positions.length === 0
        ? previous
        : reset))
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

      if (payload.futures_balances !== undefined) {
        setState(previous => ({ ...previous, connected: true, balances: payload.futures_balances }))
      }
      if (Array.isArray(payload.futures_orders)) {
        setState(previous => ({
          ...previous,
          connected: true,
          openOrders: payload.futures_orders.filter(order => OPEN_ORDER_STATUSES.has(order.status)),
        }))
      }
      if (Array.isArray(payload.futures_positions)) {
        setState(previous => ({ ...previous, connected: true, positions: payload.futures_positions }))
      }
      if (payload.futures_execution_update) {
        const report = payload.futures_execution_update
        setState(previous => ({
          ...previous,
          connected: true,
          lastExecution: report,
          lastError: null,
          openOrders: mergeOrderUpdate(previous.openOrders, report),
        }))
      }
      if (typeof payload.futures_trading_paused === 'boolean') {
        setState(previous => ({
          ...previous,
          connected: true,
          tradingPaused: payload.futures_trading_paused,
        }))
      }
      if (payload.command_rejected
        && (payload.command_rejected.details?.marketType === 'futures'
          || payload.command_rejected.code === 'FUTURES_API_ERROR')) {
        setState(previous => ({ ...previous, lastError: payload.command_rejected }))
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
      return false
    }
    try {
      wsConnection.send(JSON.stringify(command))
      return true
    } catch {
      return false
    }
  }, [enabled, wsConnection])

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

  const cancelAll = useCallback((targetSymbol) => sendCommand(createFuturesCancelAllCommand({
    symbol: targetSymbol ?? symbolRef.current,
  })), [sendCommand])

  const closePosition = useCallback((position) => {
    const quantity = Math.abs(Number(position?.quantity))
    if (!Number.isFinite(quantity) || quantity <= 0) return false
    return sendCommand(createFuturesPlaceOrderCommand({
      symbol: position.symbol,
      side: Number(position.quantity) > 0 ? 'SELL' : 'BUY',
      orderType: 'MARKET',
      quantity,
      positionSide: position.positionSide,
      reduceOnly: true,
    }))
  }, [sendCommand])

  const refresh = useCallback((targetSymbol) => sendCommand(createFuturesAccountRefreshCommand({
    symbol: targetSymbol ?? symbolRef.current,
  })), [sendCommand])

  const setTradingPaused = useCallback(paused => sendCommand(
    createFuturesSetTradingPausedCommand({ paused }),
  ), [sendCommand])

  return useMemo(() => ({
    ...state,
    placeOrder,
    cancelOrder,
    cancelAll,
    closePosition,
    refresh,
    setTradingPaused,
  }), [cancelAll, cancelOrder, closePosition, placeOrder, refresh, setTradingPaused, state])
}

export default useFuturesTrading
export { useFuturesTrading }
