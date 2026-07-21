import { memo, useCallback, useMemo, useRef, useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import FuturesTradingTicket from './FuturesTradingTicket.jsx'
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

  const executionOpenOrders = executionState?.openOrders
  const ownedOrders = useMemo(() => (
    Array.isArray(executionOpenOrders)
      ? executionOpenOrders
        .filter(order => order.symbol === symbol)
        .map(order => ({
          ...order,
          orderKind: 'REGULAR',
          positionEffect: order.positionSide === 'SHORT'
            ? (order.side === 'SELL' ? 'ENTRY' : 'EXIT')
            : (order.side === 'BUY' && order.reduceOnly !== true ? 'ENTRY' : 'EXIT'),
        }))
      : []
  ), [executionOpenOrders, symbol])

  const tradingRail = (
    <FuturesTradingTicket
      state={executionState}
      selectedSymbol={symbol}
      selectedContract={selectedContract}
      draftPrice={draftPrice}
      gestureRequest={gestureRequest}
      orderAmendRequest={orderAmendRequest}
      onDraftPriceChange={setDraftPrice}
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
        onRetry={workstationState.retry}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={setInterval}
      />
    </div>
  )
}

const MemoizedFuturesProductionWorkstation = memo(FuturesProductionWorkstation)
MemoizedFuturesProductionWorkstation.displayName = 'FuturesProductionWorkstation'

export default MemoizedFuturesProductionWorkstation
