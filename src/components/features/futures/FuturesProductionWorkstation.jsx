import { useState } from 'react'
import useFuturesProductionWorkstation from '../../../hooks/useFuturesProductionWorkstation.js'
import FuturesProductionExecutionTicket from './FuturesProductionExecutionTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

export const FuturesProductionWorkstation = ({
  enabled,
  wsConnection,
  sendMessage,
  executionState,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('1m')
  const workstationState = useFuturesProductionWorkstation({
    enabled,
    symbol,
    interval,
    wsConnection,
    sendMessage,
  })

  return (
    <div className="futures-production-workstation" data-testid="futures-production-workstation">
      <FuturesWorkstationView
        identity="USDⓈ-M PRODUCTION · REAL MONEY"
        state={workstationState}
        selectedSymbol={symbol}
        selectedInterval={interval}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
      />
      <details className="futures-workstation-safety-drawer" open>
        <summary>
          <strong>Phase 7 production safety drawer</strong>
          <span>1x · 10 USDT/order · 50 USDT/day · durable recovery</span>
        </summary>
        <div className="futures-workstation-safety-content">
          <FuturesProductionExecutionTicket
            state={executionState}
            onPrepareOrderIntent={executionState.prepareOrderIntent}
            onPlaceOrder={executionState.placeOrder}
            onPrepareCancelAllOpenOrdersIntent={executionState.prepareCancelAllOpenOrdersIntent}
            onCancelAllOpenOrders={executionState.cancelAllOpenOrders}
            onPrepareClosePositionsIntent={executionState.prepareClosePositionsIntent}
            onClosePositions={executionState.closePositions}
            onPrepareEngageKillSwitchIntent={executionState.prepareEngageKillSwitchIntent}
            onEngageKillSwitch={executionState.engageKillSwitch}
            onPrepareDisengageKillSwitchIntent={executionState.prepareDisengageKillSwitchIntent}
            onDisengageKillSwitch={executionState.disengageKillSwitch}
          />
        </div>
      </details>
    </div>
  )
}

export default FuturesProductionWorkstation
