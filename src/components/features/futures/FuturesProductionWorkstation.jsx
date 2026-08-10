import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import { describeFuturesOrderIntent } from '../../../utils/futuresOrderPresentation.js'
import {
  readFuturesSymbolHistory,
  rememberFuturesSymbol,
  searchFuturesSymbols,
  toggleFuturesFavorite,
  writeFuturesSymbolHistory,
} from '../../../utils/futuresSymbolHistory.js'
import { FUTURES_WORKSTATION_INTERVALS } from '../../../utils/futuresWorkstationProtocolShared.js'
import { clampUiScale, readUiScale, writeUiScale } from '../../../utils/uiScale.js'
import QuickSwitchModal from '../tools/QuickSwitchModal.jsx'
import FuturesLeverageEditor from './FuturesLeverageEditor.jsx'
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
  const [leverageEditor, setLeverageEditor] = useState(null)
  const [sizeRequest, setSizeRequest] = useState(null)
  // The same gesture Spot has: start typing and the pair list comes to the
  // cursor. Reaching for a contract cost a trip to the rail's search box and a
  // click on a row, on a desk where the pair changes far more often than anything
  // else on screen.
  const [quickSwitch, setQuickSwitch] = useState({
    visible: false,
    mode: 'pair',
    query: '',
    selectedIndex: 0,
  })
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

  // Every contract the catalogue knows, with the recency list in front of it so
  // the pairs worked with lately are offered before an empty query is even typed
  // — and so a recent contract is offered even before the catalogue arrives.
  const quickSwitchResults = useMemo(() => {
    if (!quickSwitch.visible) return []
    if (quickSwitch.mode === 'interval') {
      const query = quickSwitch.query.trim().toLowerCase()
      return FUTURES_WORKSTATION_INTERVALS.filter(entry => (
        query === '' || entry.toLowerCase().includes(query)
      ))
    }
    const catalog = workstationState.resources.catalog?.contracts ?? []
    return searchFuturesSymbols(
      [...(symbolHistory.recent ?? []), ...catalog.map(entry => entry.symbol)],
      quickSwitch.query,
      symbolHistory,
    )
  }, [quickSwitch, symbolHistory, workstationState.resources.catalog])

  const closeQuickSwitch = useCallback(() => {
    setQuickSwitch(previous => ({ ...previous, visible: false, query: '', selectedIndex: 0 }))
  }, [])

  const handleQuickSwitchQueryChange = useCallback((value) => {
    setQuickSwitch(previous => ({
      ...previous,
      query: previous.mode === 'pair' ? value.toUpperCase() : value,
      selectedIndex: 0,
    }))
  }, [])

  const moveQuickSwitchSelection = useCallback((delta) => {
    const count = quickSwitchResults.length
    if (count === 0) return
    setQuickSwitch(previous => ({
      ...previous,
      selectedIndex: (previous.selectedIndex + delta + count) % count,
    }))
  }, [quickSwitchResults.length])

  // One panel at a time: opening any of them closes the others, so the cursor
  // never has two overlapping submissions under it.
  const handleOrderEdit = useCallback((order, anchor) => {
    setPositionCloser(null)
    setMarginEditor(null)
    setLeverageEditor(null)
    setOrderEditor({ order, anchor })
  }, [])

  const closeOrderEditor = useCallback(() => setOrderEditor(null), [])

  const handlePositionClose = useCallback((position, anchor) => {
    setOrderEditor(null)
    setMarginEditor(null)
    setLeverageEditor(null)
    setPositionCloser({ position, anchor })
  }, [])

  const closePositionCloser = useCallback(() => setPositionCloser(null), [])

  const handleMarginEdit = useCallback((position, anchor) => {
    setOrderEditor(null)
    setPositionCloser(null)
    setLeverageEditor(null)
    setMarginEditor({ position, anchor })
  }, [])

  const closeMarginEditor = useCallback(() => setMarginEditor(null), [])

  const handleLeverageEdit = useCallback((leverageSymbol, anchor) => {
    setOrderEditor(null)
    setPositionCloser(null)
    setMarginEditor(null)
    setLeverageEditor({ symbol: leverageSymbol, anchor })
  }, [])

  const closeLeverageEditor = useCallback(() => setLeverageEditor(null), [])

  const handleUiScaleChange = useCallback((nextScale) => {
    const scale = clampUiScale(nextScale)
    setUiScale(scale)
    writeUiScale(scale)
  }, [])

  const handleQuickSwitchSelect = useCallback((value) => {
    if (!value) return
    if (quickSwitch.mode === 'pair') handleSymbolChange(value)
    else setInterval(value)
    closeQuickSwitch()
  }, [closeQuickSwitch, handleSymbolChange, quickSwitch.mode])

  // A letter opens the pair list, a digit the interval list — the workstation's
  // own shortcuts are all mouse gestures and modifier keys, so neither is taken.
  // Typing inside a field is typing, not a shortcut, and a workspace that is not
  // the active market listens for nothing.
  useEffect(() => {
    if (!enabled) return undefined
    const handleKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (quickSwitch.visible) return
      const target = event.target
      if (target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable) return
      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault()
        setQuickSwitch({
          visible: true,
          mode: 'pair',
          query: event.key.toUpperCase(),
          selectedIndex: 0,
        })
      } else if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        setQuickSwitch({ visible: true, mode: 'interval', query: event.key, selectedIndex: 0 })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled, quickSwitch.visible])

  useEffect(() => {
    writeFuturesSymbolHistory(symbolHistory)
  }, [symbolHistory])

  // The leverage of the contract in hand, asked for whenever the contract
  // changes: the position read reports neither the multiple nor the mode any more,
  // and a desk that cannot state the leverage cannot state what an entry costs.
  const loadSymbolConfig = executionState?.loadSymbolConfig
  useEffect(() => {
    if (!enabled || typeof loadSymbolConfig !== 'function') return
    loadSymbolConfig(symbol)
  }, [enabled, loadSymbolConfig, symbol])

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

  // The leverage panel reads the live config and the live position for the
  // contract it was opened on, so a leverage set from the exchange's own site
  // while it is open is the number it shows.
  const leverageConfig = leverageEditor
    ? executionState?.symbolConfigs?.[leverageEditor.symbol] ?? null
    : null
  const leveragePosition = useMemo(() => {
    if (!leverageEditor || !Array.isArray(executionPositions)) return null
    return executionPositions.find(position => position.symbol === leverageEditor.symbol) ?? null
  }, [executionPositions, leverageEditor])

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
      leverage={executionState?.symbolConfigs?.[symbol]?.leverage ?? null}
      onLeverageEdit={handleLeverageEdit}
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
      accountResources={executionState?.accountResources}
      tickSizes={tickSizes}
      history={executionState?.history}
      onClosePosition={handlePositionClose}
      onCancelOrder={executionState?.cancelOrder}
      onOrderEdit={handleOrderEdit}
      onMarginEdit={handleMarginEdit}
      onLeverageEdit={handleLeverageEdit}
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
      {/* Keyed by the object each panel edits. The panels seed their price, size
          and amount from props once, so re-targeting one at another order or
          position without remounting would submit the first target's draft
          against the second target's identity. */}
      {orderEditor ? (
        <FuturesOrderEditor
          key={`${orderEditor.order.symbol}:${orderEditor.order.orderKind ?? 'REGULAR'}:${orderEditor.order.orderId ?? orderEditor.order.clientOrderId}`}
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
          key={`${positionCloser.position.symbol}:${positionCloser.position.positionSide}`}
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
          key={`${marginPosition.symbol}:${marginPosition.positionSide}`}
          position={marginPosition}
          contract={marginPosition.symbol === symbol ? selectedContract : null}
          availableUsdt={executionState?.balances?.USDT?.available ?? null}
          anchor={marginEditor.anchor}
          onSubmit={executionState?.adjustPositionMargin}
          onClose={closeMarginEditor}
        />
      ) : null}
      {leverageEditor ? (
        <FuturesLeverageEditor
          key={leverageEditor.symbol}
          symbol={leverageEditor.symbol}
          leverage={leverageConfig?.leverage ?? null}
          maxLeverage={leverageConfig?.maxLeverage ?? null}
          maxNotionalValue={leverageConfig?.maxNotionalValue ?? null}
          availableUsdt={executionState?.balances?.USDT?.available ?? null}
          openPosition={leveragePosition}
          anchor={leverageEditor.anchor}
          onSubmit={executionState?.setLeverage}
          onClose={closeLeverageEditor}
        />
      ) : null}
      <QuickSwitchModal
        visible={quickSwitch.visible}
        mode={quickSwitch.mode}
        query={quickSwitch.query}
        results={quickSwitchResults}
        selectedIndex={quickSwitch.selectedIndex}
        onClose={closeQuickSwitch}
        onQueryChange={handleQuickSwitchQueryChange}
        onSelect={handleQuickSwitchSelect}
        onMoveSelection={moveQuickSwitchSelection}
      />
    </div>
  )
}

const MemoizedFuturesProductionWorkstation = memo(FuturesProductionWorkstation)
MemoizedFuturesProductionWorkstation.displayName = 'FuturesProductionWorkstation'

export default MemoizedFuturesProductionWorkstation
