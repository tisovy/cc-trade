import { useCallback, useRef, useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import FuturesProductionExecutionTicket from './FuturesProductionExecutionTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

export const FuturesProductionWorkstation = ({
  enabled,
  executionState,
  wsConnection,
  sendMessage,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('1m')
  const [draftPrice, setDraftPrice] = useState(null)
  const [gestureRequest, setGestureRequest] = useState(null)
  const [orderAmendRequest, setOrderAmendRequest] = useState(null)
  const gestureSequenceRef = useRef(0)
  const amendmentSequenceRef = useRef(0)
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

  const handleSymbolChange = useCallback((nextSymbol) => {
    setDraftPrice(null)
    setGestureRequest(null)
    setOrderAmendRequest(null)
    setSymbol(nextSymbol)
  }, [])

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

  const ownedOrders = Array.isArray(executionState?.portfolio?.openOrders)
    ? executionState.portfolio.openOrders.filter(order => order.symbol === symbol)
    : []

  const tradingRail = (
    <FuturesProductionExecutionTicket
      state={executionState}
      selectedSymbol={symbol}
      selectedContract={selectedContract}
      draftPrice={draftPrice}
      gestureRequest={gestureRequest}
      orderAmendRequest={orderAmendRequest}
      onDraftPriceChange={setDraftPrice}
      onRefreshPortfolio={executionState.refreshPortfolio}
      onPrepareOrderIntent={executionState.prepareOrderIntent}
      onPlaceOrder={executionState.placeOrder}
      onPrepareMarginAdjustment={executionState.prepareMarginAdjustment}
      onAdjustMargin={executionState.adjustMargin}
      onPrepareOrderAmendment={executionState.prepareOrderAmendment}
      onAmendOrder={executionState.amendOrder}
      onPrepareCancelAllOpenOrdersIntent={executionState.prepareCancelAllOpenOrdersIntent}
      onCancelAllOpenOrders={executionState.cancelAllOpenOrders}
      onPrepareClosePositionsIntent={executionState.prepareClosePositionsIntent}
      onClosePositions={executionState.closePositions}
      onPrepareEngageKillSwitchIntent={executionState.prepareEngageKillSwitchIntent}
      onEngageKillSwitch={executionState.engageKillSwitch}
      onPrepareDisengageKillSwitchIntent={executionState.prepareDisengageKillSwitchIntent}
      onDisengageKillSwitch={executionState.disengageKillSwitch}
    />
  )

  return (
    <div className="futures-production-workstation" data-testid="futures-production-workstation">
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={workstationState}
        selectedSymbol={symbol}
        selectedInterval={interval}
        draftPrice={draftPrice}
        ownedOrders={ownedOrders}
        tradingRail={tradingRail}
        onDraftPriceChange={setDraftPrice}
        onTradingGesture={handleTradingGesture}
        onOrderDrag={handleOrderDrag}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={setInterval}
      />
    </div>
  )
}

export default FuturesProductionWorkstation
