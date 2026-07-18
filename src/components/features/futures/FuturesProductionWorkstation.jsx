import { useCallback, useEffect, useRef, useState } from 'react'
import useFuturesProductionWorkstationConnection from '../../../hooks/useFuturesProductionWorkstationConnection.js'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import { FUTURES_PRODUCTION_EXECUTION_STATES } from '../../../utils/futuresProductionExecutionProtocol.js'
import FuturesProductionExecutionTicket from './FuturesProductionExecutionTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

const PORTFOLIO_MUTATION_STATES = new Set([
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_OPEN,
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_FILLED,
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CANCELED,
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_CLOSED,
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_MARGIN_ADJUSTED,
  FUTURES_PRODUCTION_EXECUTION_STATES.CONFIRMED_ORDER_AMENDED,
])

export const FuturesProductionWorkstation = ({
  enabled,
  executionState,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('1m')
  const [draftPrice, setDraftPrice] = useState(null)
  const [gestureRequest, setGestureRequest] = useState(null)
  const [orderAmendRequest, setOrderAmendRequest] = useState(null)
  const gestureSequenceRef = useRef(0)
  const amendmentSequenceRef = useRef(0)
  const initialPortfolioRefreshRef = useRef(null)
  const mutationPortfolioRefreshRef = useRef(executionState?.attempt?.requestId ?? null)
  const { wsConnection, sendMessage } = useFuturesProductionWorkstationConnection({ enabled })
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

  useEffect(() => {
    const fingerprint = executionState?.account?.fingerprint
    const refreshPortfolio = executionState?.refreshPortfolio
    if (!enabled
      || executionState?.connected !== true
      || executionState?.subscribed !== true
      || executionState?.submissionLocked === true
      || typeof fingerprint !== 'string'
      || typeof refreshPortfolio !== 'function'
      || executionState?.portfolio?.state === 'live'
      || executionState?.portfolio?.state === 'truncated'
      || initialPortfolioRefreshRef.current === fingerprint) return
    if (refreshPortfolio() === true) initialPortfolioRefreshRef.current = fingerprint
  }, [
    enabled,
    executionState?.account?.fingerprint,
    executionState?.connected,
    executionState?.portfolio?.state,
    executionState?.refreshPortfolio,
    executionState?.submissionLocked,
    executionState?.subscribed,
  ])

  useEffect(() => {
    const attempt = executionState?.attempt
    const requestId = attempt?.requestId
    const refreshPortfolio = executionState?.refreshPortfolio
    if (typeof requestId !== 'string'
      || !PORTFOLIO_MUTATION_STATES.has(attempt?.state)
      || mutationPortfolioRefreshRef.current === requestId
      || executionState?.connected !== true
      || executionState?.subscribed !== true
      || executionState?.submissionLocked === true
      || typeof refreshPortfolio !== 'function') return
    if (refreshPortfolio() === true) mutationPortfolioRefreshRef.current = requestId
  }, [
    executionState?.attempt,
    executionState?.connected,
    executionState?.refreshPortfolio,
    executionState?.submissionLocked,
    executionState?.subscribed,
  ])

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
        key={symbol}
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
