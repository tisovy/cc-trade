import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import useFuturesOrderDrag from '../../../hooks/useFuturesOrderDrag.js'
import useFuturesContractDefaults from '../../../hooks/useFuturesContractDefaults.js'
import { useFuturesPositionValuation } from '../../../hooks/useFuturesPositionValuation.js'
import { applyFuturesPositionValuation } from '../../../utils/futuresPositionMarks.js'
import {
  describeFuturesOrderIntent,
  describeFuturesPosition,
} from '../../../utils/futuresOrderPresentation.js'
import {
  describeFuturesOrderAvailability,
  isFuturesBalanceConfirmed,
} from '../../../utils/futuresReadiness.js'
import {
  readFuturesSymbolHistory,
  rememberFuturesSymbol,
  removeFuturesRecentSymbol,
  searchFuturesSymbols,
  toggleFuturesFavorite,
  writeFuturesSymbolHistory,
} from '../../../utils/futuresSymbolHistory.js'
import { FUTURES_WORKSTATION_INTERVALS } from '../../../utils/futuresWorkstationProtocolShared.js'
import { clampUiScale, readUiScale, writeUiScale } from '../../../utils/uiScale.js'
import QuickSwitchModal from '../tools/QuickSwitchModal.jsx'
import FuturesLeverageEditor from './FuturesLeverageEditor.jsx'
import FuturesOrderDragAlert from './FuturesOrderDragAlert.jsx'
import FuturesOrderEditor from './FuturesOrderEditor.jsx'
import FuturesPositionCloser from './FuturesPositionCloser.jsx'
import FuturesPositionMarginEditor from './FuturesPositionMarginEditor.jsx'
import FuturesPortfolioDock from './FuturesPortfolioDock.jsx'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

const DEFAULT_FUTURES_SYMBOL = 'BTCUSDT'
const DEFAULT_FUTURES_INTERVAL = '15m'

const currentRawPosition = (positions, target) => {
  if (!Array.isArray(positions) || !target) return null
  const targetSide = describeFuturesPosition(target).positionSide
  return positions.find(position => position.symbol === target.symbol
    && describeFuturesPosition(position).positionSide === targetSide) ?? null
}

const useLiveFuturesPosition = (position, store, resource) => {
  const updatedAt = Number.isSafeInteger(resource?.updatedAt) ? resource.updatedAt : null
  const lastSuccessfulAt = Number.isSafeInteger(resource?.lastSuccessfulAt)
    ? resource.lastSuccessfulAt
    : null
  const valuation = useFuturesPositionValuation(position, store, {
    snapshotAt: updatedAt ?? lastSuccessfulAt,
    snapshotConfirmed: position !== null || lastSuccessfulAt !== null,
    snapshotCoherent: resource === null || resource === undefined
      ? position !== null
      : updatedAt !== null && updatedAt === lastSuccessfulAt,
    valueOnly: true,
  })
  return useMemo(
    () => applyFuturesPositionValuation(position, valuation),
    [position, valuation],
  )
}

const LiveFuturesPositionCloser = memo(({
  position,
  positionMarkStore,
  positionResource,
  ...props
}) => {
  const valuedPosition = useLiveFuturesPosition(position, positionMarkStore, positionResource)
  return <FuturesPositionCloser {...props} position={valuedPosition} />
})

export const FuturesProductionWorkstation = ({
  enabled,
  executionState,
  marketClock = null,
  wsConnection,
  sendMessage,
}) => {
  // Reopen on the contract the trader left on, not on an alphabetical default.
  // The restored contract is folded back into the recency list at startup, so
  // the rail lists it from the first frame instead of after the first click.
  const [symbolHistory, setSymbolHistory] = useState(() => {
    const stored = readFuturesSymbolHistory()
    return rememberFuturesSymbol(stored, stored.lastSymbol ?? DEFAULT_FUTURES_SYMBOL)
  })
  const [symbol, setSymbol] = useState(() => (
    readFuturesSymbolHistory().lastSymbol ?? DEFAULT_FUTURES_SYMBOL
  ))
  const [interval, setInterval] = useState(DEFAULT_FUTURES_INTERVAL)
  const [uiScale, setUiScale] = useState(() => readUiScale())
  const [draftPrice, setDraftPrice] = useState(null)
  // Where the working price came from, when it came off a surface rather than a
  // keyboard. It rides beside the price rather than inside it so a typed price
  // stays exactly what it has always been: the operator's own number, with no
  // reading and no age to state about it.
  const [draftPriceReading, setDraftPriceReading] = useState(null)
  const [gestureRequest, setGestureRequest] = useState(null)
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
  const accountSynchronizing = executionState?.connected === true
    && Object.values(executionState?.accountResources ?? {}).some(resource => (
      resource?.status === 'idle' || resource?.status === 'loading'
    ))

  // Dragging an order lifts it off the book: the cancellation is sent when the
  // drag begins, and from that moment the desk owes the operator a replacement.
  // The whole transaction lives here rather than in the chart, because it must
  // outlive a contract change and a chart that stops being live.
  const orderDrag = useFuturesOrderDrag({
    tradingPaused: executionState?.tradingPaused === true,
    maxOrderNotionalUsdt: executionState?.maxOrderNotionalUsdt ?? null,
    tickSize: selectedContract?.filters?.price?.tickSize ?? null,
    // The floor the ticket already refuses a placement against. A drag lowers
    // the price and keeps the quantity, so it is the one gesture on this desk
    // that walks an order under it without typing anything.
    minNotionalUsdt: selectedContract?.filters?.minimumNotional ?? null,
    cancelOrder: executionState?.cancelOrderAndConfirm,
    placeOrder: executionState?.placeOrderAndConfirm,
  })

  // The ticket owns the price-to-notional conversion, so a size pick carries the
  // quantity and the ticket values it at the price the operator is working at.
  const handleSizePick = useCallback((quantity) => {
    sizeSequenceRef.current += 1
    setSizeRequest({ id: sizeSequenceRef.current, quantity })
  }, [])

  const handleDraftPriceChange = useCallback((price, reading = null) => {
    setDraftPrice(price)
    setDraftPriceReading(reading ?? null)
  }, [])

  const handleSymbolChange = useCallback((nextSymbol) => {
    setDraftPrice(null)
    setDraftPriceReading(null)
    setGestureRequest(null)
    setOrderEditor(null)
    setSizeRequest(null)
    setSymbol(nextSymbol)
    setSymbolHistory(previous => rememberFuturesSymbol(previous, nextSymbol))
  }, [])

  // The account review is read when a history view is opened, for the endpoint
  // that view is made of, and after that only when the operator asks for it. The
  // dock issues it, because the dock is what knows which view is on screen —
  // reading here, before any view is open, paid for both endpoints and for a
  // review the operator may never look at. Selecting a view a read already
  // covers renders what is held; the stream keeps it current.

  const handleToggleFavorite = useCallback((favoriteSymbol) => {
    setSymbolHistory(previous => toggleFuturesFavorite(previous, favoriteSymbol))
  }, [])

  const handleRemoveRecent = useCallback((recentSymbol) => {
    if (recentSymbol === symbol) return
    setSymbolHistory(previous => removeFuturesRecentSymbol(previous, recentSymbol))
  }, [symbol])

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
  //
  // And again when the backend connection opens. The desk can mount before the
  // local socket is open, and a command sent then never leaves — it is
  // remembered as unsent, and nothing automatic sends it again. Until now the
  // read landed anyway, by accident: `sendCommand` is rebuilt when the socket
  // changes, which rebuilds `loadSymbolConfig`, which re-ran this effect. An
  // accident is not a guarantee, and under the desk's rule — nothing is retuned
  // in Binance's own app while this runs — this read is the only reading of the
  // contract the session gets. A read that fails on the exchange is asked for
  // again by the backend, on the account pass behind it.
  const loadSymbolConfig = executionState?.loadSymbolConfig
  const executionConnected = executionState?.connected === true
  useEffect(() => {
    if (!enabled || typeof loadSymbolConfig !== 'function') return
    loadSymbolConfig(symbol)
  }, [enabled, executionConnected, loadSymbolConfig, symbol])

  // And then held at the desk's own default rather than at whatever the account
  // was left on: a flat contract above 1× is brought down to 1×, once per
  // contract per session. The multiple only — the margin mode is the operator's
  // choice, and `setMarginType` is deliberately not wired here: nothing
  // automatic may reach that command.
  const executionPositions = executionState?.positions
  useFuturesContractDefaults({
    enabled,
    paused: executionState?.tradingPaused === true,
    symbol,
    config: executionState?.symbolConfigs?.[symbol] ?? null,
    positions: executionPositions,
    // `ready`, not "succeeded once": a snapshot held from before a dropped
    // connection is a reading, not a confirmation, and a contract that went
    // into a position while the desk was disconnected would read as flat.
    positionsRead: executionState?.accountResources?.positions?.status === 'ready',
    setLeverage: executionState?.setLeverage,
  })

  const editorBalanceResource = executionState?.accountResources?.balances ?? {
    status: executionState?.balances == null ? 'loading' : 'ready',
    lastSuccessfulAt: executionState?.balances == null ? null : 0,
  }
  const editorAvailableUsdt = isFuturesBalanceConfirmed(editorBalanceResource)
    && typeof executionState?.balances?.USDT?.available === 'string'
    ? executionState.balances.USDT.available
    : null
  const editorPositionsResource = executionState?.accountResources?.positions ?? null
  const positionsSnapshotUpdatedAt = Number.isSafeInteger(editorPositionsResource?.updatedAt)
    ? editorPositionsResource.updatedAt
    : null
  const positionsSnapshotSuccessfulAt = Number.isSafeInteger(
    editorPositionsResource?.lastSuccessfulAt,
  )
    ? editorPositionsResource.lastSuccessfulAt
    : null
  const editorPositionsConfirmed = editorPositionsResource === null
    ? Array.isArray(executionPositions)
    : editorPositionsResource.status === 'ready'
      || (editorPositionsResource.status === 'loading'
        && Number.isFinite(editorPositionsResource.lastSuccessfulAt))
  const positionsHaveAuthoritativeReading = editorPositionsResource !== null
    && editorPositionsConfirmed
  const marginRiskSnapshotCoherent = editorPositionsResource === null
    ? editorPositionsConfirmed
    : editorPositionsConfirmed
      && positionsSnapshotUpdatedAt !== null
      && positionsSnapshotUpdatedAt === positionsSnapshotSuccessfulAt

  const handleTradingGesture = useCallback((gesture) => {
    gestureSequenceRef.current += 1
    setDraftPrice(gesture.price)
    setDraftPriceReading(gesture.reading ?? null)
    setGestureRequest({ ...gesture, id: gestureSequenceRef.current })
  }, [])

  // The drag's two ends. Lifting answers whether the order actually left the
  // book; dropping is what puts one back, at the new price or at the old one.
  const handleOrderLift = useCallback(order => orderDrag.lift(order), [orderDrag])

  // The order is carried through rather than inferred: several drags can be
  // outstanding at once, so the obligation this discharges is the one made for
  // the order the chart names, not the one lifted most recently.
  const handleOrderDrop = useCallback(({ order, price, restored }) => {
    // A dragged price is the operator's own placement, not a reading taken off
    // a surface, so it clears whatever reading the draft was carrying.
    if (!restored && typeof price === 'string') {
      setDraftPrice(price)
      setDraftPriceReading(null)
    }
    return orderDrag.drop({ order, price, restored })
  }, [orderDrag])

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
            // Display coordinates belong to the chart. Keep the exchange's
            // ordinary price intact here so every object handed to an action
            // still carries the order that was actually read.
            // The exchange's own leg, kept beside the derived one: a one-way
            // account reports BOTH, and an order placed with the LONG a label
            // was derived from is refused by Binance.
            exchangePositionSide: order.positionSide ?? null,
            positionSide: intent.positionSide,
            positionEffect: intent.positionEffect,
            intentLabel: intent.label,
            tone: intent.tone,
          }
        })
      : []
  ), [executionOpenOrders, symbol])

  const ownedPositions = useMemo(() => (
    Array.isArray(executionPositions)
      ? executionPositions.filter(position => position.symbol === symbol)
      : []
  ), [executionPositions, symbol])

  const orderEditorPositionQuantity = useMemo(() => {
    if (!orderEditor || !editorPositionsConfirmed || !Array.isArray(executionPositions)) return null
    const intent = describeFuturesOrderIntent(orderEditor.order)
    if (intent.positionEffect !== 'EXIT') return null
    const position = executionPositions.find((candidate) => {
      if (candidate.symbol !== orderEditor.order.symbol) return false
      const description = describeFuturesPosition(candidate)
      return description.positionSide === intent.positionSide
        && description.absoluteQuantity !== null
        && description.absoluteQuantity > 0
    })
    return position?.quantity ?? null
  }, [editorPositionsConfirmed, executionPositions, orderEditor])

  // Keep the close panel attached to the account row that is being refreshed.
  // The opening row is retained only for a transient gap in the live positions
  // read; the identity-based panel key below keeps its operator-owned drafts
  // mounted while valuation and quantity props change.
  const positionCloserTarget = positionCloser?.position
  const currentClosePosition = useMemo(
    () => currentRawPosition(executionPositions, positionCloserTarget),
    [executionPositions, positionCloserTarget],
  )
  const closePosition = currentClosePosition
    ?? (positionsHaveAuthoritativeReading ? null : positionCloserTarget)

  // The panel is opened from a row, but it stays open while the account keeps
  // refreshing. It reads the live position rather than the snapshot it was
  // opened with, so the margin it shows is never one adjustment behind.
  const marginEditorTarget = marginEditor?.position
  const currentMarginPosition = useMemo(
    () => currentRawPosition(executionPositions, marginEditorTarget),
    [executionPositions, marginEditorTarget],
  )
  const marginPosition = currentMarginPosition
    ?? (positionsHaveAuthoritativeReading ? null : marginEditorTarget)

  // A successful account reading is the authority on whether a leg still
  // exists. Clear the action state as well as hiding its panel, otherwise a
  // later position with the same symbol and side would revive the old draft.
  useEffect(() => {
    if (!positionsHaveAuthoritativeReading) return
    if (positionCloserTarget && currentClosePosition === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPositionCloser(null)
    }
    if (marginEditorTarget && currentMarginPosition === null) {
      setMarginEditor(null)
    }
  }, [
    currentClosePosition,
    currentMarginPosition,
    marginEditorTarget,
    positionCloserTarget,
    positionsHaveAuthoritativeReading,
  ])

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

  // What is behind the orders the chart is about to draw. The same reading the
  // dock is given, from the same helper, so the two surfaces cannot disagree
  // about whether the account has been read.
  const orderAvailability = describeFuturesOrderAvailability(executionState?.accountResources)

  const tradingRail = (
    <FuturesTradingTicket
      state={executionState}
      selectedSymbol={symbol}
      selectedContract={selectedContract}
      tickSizes={tickSizes}
      leverage={executionState?.symbolConfigs?.[symbol]?.leverage ?? null}
      marginMode={executionState?.symbolConfigs?.[symbol]?.marginType ?? null}
      onLeverageEdit={handleLeverageEdit}
      onMarginModeChange={executionState?.setMarginType}
      draftPrice={draftPrice}
      draftPriceReading={draftPriceReading}
      gestureRequest={gestureRequest}
      sizeRequest={sizeRequest}
      onDraftPriceChange={handleDraftPriceChange}
      onSymbolChange={handleSymbolChange}
      onOrderEdit={handleOrderEdit}
      onPositionClose={handlePositionClose}
    />
  )

  const portfolioDock = (
    <FuturesPortfolioDock
      selectedSymbol={symbol}
      positions={executionState?.positions}
      positionMarkStore={executionState?.positionMarkStore}
      openOrders={executionState?.openOrders}
      accountResources={executionState?.accountResources}
      tickSizes={tickSizes}
      marginCalls={executionState?.marginCalls}
      history={executionState?.history}
      settledMoney={executionState?.settledMoney}
      settledWindow={executionState?.settledIncomeWindow}
      settledIncome={executionState?.settledIncome}
      feeReserve={executionState?.feeReserve}
      tradeRoundIndex={executionState?.tradeRoundIndex}
      onClosePosition={handlePositionClose}
      onCancelOrder={executionState?.cancelOrder}
      onOrderEdit={handleOrderEdit}
      onMarginEdit={handleMarginEdit}
      onLeverageEdit={handleLeverageEdit}
      onSymbolChange={handleSymbolChange}
      onSizePick={handleSizePick}
      onLoadHistory={executionState?.loadHistory}
      onRefreshAccount={executionState?.refresh}
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
        marketClock={marketClock}
        state={workstationState}
        selectedSymbol={symbol}
        selectedInterval={interval}
        draftPrice={draftPrice}
        ownedOrders={ownedOrders}
        ownedPositions={ownedPositions}
        orderAvailability={orderAvailability}
        onRefreshAccount={executionState?.refresh}
        candleHistory={workstationState.candleHistory}
        onLoadHistory={workstationState.loadCandleHistory}
        tradingRail={tradingRail}
        portfolioDock={portfolioDock}
        symbolHistory={symbolHistory}
        accountSynchronizing={accountSynchronizing}
        uiScale={uiScale}
        onRemoveRecent={handleRemoveRecent}
        onToggleFavorite={handleToggleFavorite}
        onUiScaleChange={handleUiScaleChange}
        onDraftPriceChange={handleDraftPriceChange}
        onTradingGesture={handleTradingGesture}
        onOrderLift={handleOrderLift}
        onOrderDrop={handleOrderDrop}
        onOrderCancel={executionState?.cancelOrder}
        onOrderEdit={handleOrderEdit}
        onRetry={workstationState.retry}
        onTapeConfigurationChange={workstationState.configureTape}
        onDepthReadingChange={workstationState.configureDepth}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={setInterval}
      />
      {/* An order the drag lifted and could not put back is the one thing that
          may not wait in a panel: it is stated over the workspace, with the
          control that places it again. */}
      <FuturesOrderDragAlert
        alerts={orderDrag.alerts}
        busy={orderDrag.replacementInFlight}
        onRetry={orderDrag.retry}
        onDismiss={orderDrag.dismiss}
      />
      {/* Keyed by the identity each panel edits. The panels seed their price,
          size and amount from props once, so replacing live data for that same
          identity rerenders without discarding operator-owned draft state. */}
      {orderEditor ? (
        <FuturesOrderEditor
          key={`${orderEditor.order.symbol}:${orderEditor.order.orderKind ?? 'REGULAR'}:${orderEditor.order.orderId ?? orderEditor.order.clientOrderId}`}
          order={orderEditor.order}
          contract={orderEditor.order.symbol === symbol ? selectedContract : null}
          maxOrderNotionalUsdt={executionState?.maxOrderNotionalUsdt ?? null}
          availableUsdt={editorAvailableUsdt}
          positionQuantity={orderEditorPositionQuantity}
          anchor={orderEditor.anchor}
          onSubmit={executionState?.modifyOrder}
          onCancelOrder={executionState?.cancelOrder}
          onClose={closeOrderEditor}
        />
      ) : null}
      {positionCloser && closePosition ? (
        <LiveFuturesPositionCloser
          key={`${positionCloser.position.symbol}:${positionCloser.position.positionSide}`}
          position={closePosition}
          positionMarkStore={executionState?.positionMarkStore}
          positionResource={executionState?.accountResources?.positions}
          contract={closePosition.symbol === symbol ? selectedContract : null}
          anchor={positionCloser.anchor}
          onCloseMarket={(_valuedPosition, options) => (
            executionState?.closePosition?.(closePosition, options)
          )}
          onCloseLimit={close => executionState?.placeOrder?.({
            symbol: close.symbol,
            side: close.side,
            positionSide: closePosition.positionSide,
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
          riskSnapshotCoherent={marginRiskSnapshotCoherent}
          contract={marginPosition.symbol === symbol ? selectedContract : null}
          availableUsdt={editorAvailableUsdt}
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
          // The mode decides which changes the exchange will take at all: it
          // refuses a lower multiple while an isolated position is open.
          marginMode={leverageConfig?.marginType ?? null}
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
