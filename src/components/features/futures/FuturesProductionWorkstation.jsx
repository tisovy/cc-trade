import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import { describeFuturesOrderIntent } from '../../../utils/futuresOrderPresentation.js'
import {
  readFuturesSymbolHistory,
  rememberFuturesSymbol,
  toggleFuturesFavorite,
  writeFuturesSymbolHistory,
} from '../../../utils/futuresSymbolHistory.js'
import { clampUiScale, readUiScale, writeUiScale } from '../../../utils/uiScale.js'
import FuturesOrderEditor from './FuturesOrderEditor.jsx'
import FuturesPositionCloser from './FuturesPositionCloser.jsx'
import FuturesPositionMarginEditor from './FuturesPositionMarginEditor.jsx'
import FuturesPortfolioDock from './FuturesPortfolioDock.jsx'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

const DEFAULT_FUTURES_SYMBOL = 'BTCUSDT'
const DEFAULT_FUTURES_INTERVAL = '15m'

export const FuturesProductionWorkstation = ({
  enabled,
  executionState,
  wsConnection,
  sendMessage,
}) => {
  // Reopen on the contract the trader left on, not on an alphabetical default.
  // The restored contract is folded back into the recency list at startup, so
  // the rail lists it from the first frame instead of after the first click.
  const [symbolHistory, setSymbolHistory] = useState(() => {
    const stored = readFuturesSymbolHistory()
    return stored.lastSymbol ? rememberFuturesSymbol(stored, stored.lastSymbol) : stored
  })
  const [symbol, setSymbol] = useState(() => (
    readFuturesSymbolHistory().lastSymbol ?? DEFAULT_FUTURES_SYMBOL
  ))
  const [interval, setInterval] = useState(DEFAULT_FUTURES_INTERVAL)
  const [uiScale, setUiScale] = useState(() => readUiScale())
  const [draftPrice, setDraftPrice] = useState(null)
  const [gestureRequest, setGestureRequest] = useState(null)
  const [orderAmendRequest, setOrderAmendRequest] = useState(null)
  const [orderEditor, setOrderEditor] = useState(null)
  const [positionCloser, setPositionCloser] = useState(null)
  const [marginEditor, setMarginEditor] = useState(null)
  const [sizeRequest, setSizeRequest] = useState(null)
  const gestureSequenceRef = useRef(0)
  const amendmentSequenceRef = useRef(0)
  const sizeSequenceRef = useRef(0)
  const workstationState = useFuturesProductionWorkstation({
    enabled,
    symbol,
    interval,
    wsConnection,
    sendMessage,
  })
  const selectedContract = workstationState.resources.catalog?.contracts?.find(
    contract => contract.symbol === symbol,
  ) ?? null

  // The ticket owns the price-to-notional conversion, so a size pick carries the
  // quantity and the ticket values it at the price the operator is working at.
  const handleSizePick = useCallback((quantity) => {
    sizeSequenceRef.current += 1
    setSizeRequest({ id: sizeSequenceRef.current, quantity })
  }, [])

  const handleSymbolChange = useCallback((nextSymbol) => {
    setDraftPrice(null)
    setGestureRequest(null)
    setOrderAmendRequest(null)
    setOrderEditor(null)
    setSizeRequest(null)
    setSymbol(nextSymbol)
    setSymbolHistory(previous => rememberFuturesSymbol(previous, nextSymbol))
  }, [])

  const handleToggleFavorite = useCallback((favoriteSymbol) => {
    setSymbolHistory(previous => toggleFuturesFavorite(previous, favoriteSymbol))
  }, [])

  // One panel at a time: opening any of them closes the others, so the cursor
  // never has two overlapping submissions under it.
  const handleOrderEdit = useCallback((order, anchor) => {
    setPositionCloser(null)
    setMarginEditor(null)
    setOrderEditor({ order, anchor })
  }, [])

  const closeOrderEditor = useCallback(() => setOrderEditor(null), [])

  const handlePositionClose = useCallback((position, anchor) => {
    setOrderEditor(null)
    setMarginEditor(null)
    setPositionCloser({ position, anchor })
  }, [])

  const closePositionCloser = useCallback(() => setPositionCloser(null), [])

  const handleMarginEdit = useCallback((position, anchor) => {
    setOrderEditor(null)
    setPositionCloser(null)
    setMarginEditor({ position, anchor })
  }, [])

  const closeMarginEditor = useCallback(() => setMarginEditor(null), [])

  const handleUiScaleChange = useCallback((nextScale) => {
    const scale = clampUiScale(nextScale)
    setUiScale(scale)
    writeUiScale(scale)
  }, [])

  useEffect(() => {
    writeFuturesSymbolHistory(symbolHistory)
  }, [symbolHistory])

  const handleTradingGesture = useCallback((gesture) => {
    gestureSequenceRef.current += 1
    setDraftPrice(gesture.price)
    setGestureRequest({ ...gesture, id: gestureSequenceRef.current })
  }, [])

  const handleOrderDrag = useCallback((amendment) => {
    amendmentSequenceRef.current += 1
    setDraftPrice(amendment.price)
    setOrderAmendRequest({ ...amendment, id: amendmentSequenceRef.current })
  }, [])

  const executionOpenOrders = executionState?.openOrders
  const ownedOrders = useMemo(() => (
    Array.isArray(executionOpenOrders)
      ? executionOpenOrders
        .filter(order => order.symbol === symbol)
        .map((order) => {
          const intent = describeFuturesOrderIntent(order)
          return {
            ...order,
            orderKind: order.orderKind === 'ALGO' ? 'ALGO' : 'REGULAR',
            price: order.orderKind === 'ALGO'
              ? (order.triggerPrice ?? order.price)
              : order.price,
            positionSide: intent.positionSide,
            positionEffect: intent.positionEffect,
            intentLabel: intent.label,
            tone: intent.tone,
          }
        })
      : []
  ), [executionOpenOrders, symbol])

  const executionPositions = executionState?.positions
  const ownedPositions = useMemo(() => (
    Array.isArray(executionPositions)
      ? executionPositions.filter(position => position.symbol === symbol)
      : []
  ), [executionPositions, symbol])

  // The panel is opened from a row, but it stays open while the account keeps
  // refreshing. It reads the live position rather than the snapshot it was
  // opened with, so the margin it shows is never one adjustment behind.
  const marginEditorTarget = marginEditor?.position
  const marginPosition = useMemo(() => {
    if (!marginEditorTarget) return null
    const live = Array.isArray(executionPositions)
      ? executionPositions.find(position => position.symbol === marginEditorTarget.symbol
        && position.positionSide === marginEditorTarget.positionSide)
      : null
    return live ?? marginEditorTarget
  }, [executionPositions, marginEditorTarget])

  const catalogContracts = workstationState.resources.catalog?.contracts
  // Account rows span every symbol, so each one is rendered at its own
  // contract's precision rather than at the selected contract's.
  const tickSizes = useMemo(() => Object.fromEntries(
    (Array.isArray(catalogContracts) ? catalogContracts : [])
      .map(contract => [contract.symbol, contract.filters?.price?.tickSize ?? null])
      .filter(([, tickSize]) => typeof tickSize === 'string'),
  ), [catalogContracts])

  const tradingRail = (
    <FuturesTradingTicket
      state={executionState}
      selectedSymbol={symbol}
      selectedContract={selectedContract}
      draftPrice={draftPrice}
      gestureRequest={gestureRequest}
      orderAmendRequest={orderAmendRequest}
      sizeRequest={sizeRequest}
      onDraftPriceChange={setDraftPrice}
      onOrderEdit={handleOrderEdit}
      onPositionClose={handlePositionClose}
    />
  )

  const portfolioDock = (
    <FuturesPortfolioDock
      selectedSymbol={symbol}
      positions={executionState?.positions}
      openOrders={executionState?.openOrders}
      tickSizes={tickSizes}
      history={executionState?.history}
      onClosePosition={handlePositionClose}
      onCancelOrder={executionState?.cancelOrder}
      onOrderEdit={handleOrderEdit}
      onMarginEdit={handleMarginEdit}
      onSymbolChange={handleSymbolChange}
      onSizePick={handleSizePick}
      onLoadHistory={executionState?.loadHistory}
    />
  )

  return (
    <div
      className="futures-production-workstation"
      data-testid="futures-production-workstation"
      style={{ '--fx-ui-scale': uiScale }}
    >
      <FuturesWorkstationView
        identity="USDⓈ-M FUTURES"
        state={workstationState}
        selectedSymbol={symbol}
        selectedInterval={interval}
        draftPrice={draftPrice}
        ownedOrders={ownedOrders}
        ownedPositions={ownedPositions}
        candleHistory={workstationState.candleHistory}
        onLoadHistory={workstationState.loadCandleHistory}
        tradingRail={tradingRail}
        portfolioDock={portfolioDock}
        symbolHistory={symbolHistory}
        uiScale={uiScale}
        onToggleFavorite={handleToggleFavorite}
        onUiScaleChange={handleUiScaleChange}
        onDraftPriceChange={setDraftPrice}
        onTradingGesture={handleTradingGesture}
        onOrderDrag={handleOrderDrag}
        onOrderCancel={executionState?.cancelOrder}
        onOrderEdit={handleOrderEdit}
        onRetry={workstationState.retry}
        onTapeConfigurationChange={workstationState.configureTape}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={setInterval}
      />
      {orderEditor ? (
        <FuturesOrderEditor
          order={orderEditor.order}
          contract={orderEditor.order.symbol === symbol ? selectedContract : null}
          maxOrderNotionalUsdt={executionState?.maxOrderNotionalUsdt ?? null}
          anchor={orderEditor.anchor}
          onSubmit={executionState?.modifyOrder}
          onCancelOrder={executionState?.cancelOrder}
          onClose={closeOrderEditor}
        />
      ) : null}
      {positionCloser ? (
        <FuturesPositionCloser
          position={positionCloser.position}
          contract={positionCloser.position.symbol === symbol ? selectedContract : null}
          anchor={positionCloser.anchor}
          onCloseMarket={(position, options) => executionState?.closePosition?.(position, options)}
          onCloseLimit={close => executionState?.placeOrder?.({
            symbol: close.symbol,
            side: close.side,
            orderType: 'LIMIT',
            price: close.price,
            quantity: close.quantity,
            reduceOnly: true,
          })}
          onClose={closePositionCloser}
        />
      ) : null}
      {marginEditor && marginPosition ? (
        <FuturesPositionMarginEditor
          position={marginPosition}
          availableUsdt={executionState?.balances?.USDT?.available ?? null}
          anchor={marginEditor.anchor}
          onSubmit={executionState?.adjustPositionMargin}
          onClose={closeMarginEditor}
        />
      ) : null}
    </div>
  )
}

const MemoizedFuturesProductionWorkstation = memo(FuturesProductionWorkstation)
MemoizedFuturesProductionWorkstation.displayName = 'FuturesProductionWorkstation'

export default MemoizedFuturesProductionWorkstation
