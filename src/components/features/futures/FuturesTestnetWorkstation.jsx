import { useState } from 'react'
import useFuturesTestnetWorkstation from '../../../hooks/useFuturesTestnetWorkstation.js'
import FuturesReadOnlyPanel from './FuturesReadOnlyPanel.jsx'
import FuturesTestnetExecutionTicket from './FuturesTestnetExecutionTicket.jsx'
import FuturesWorkstationView from './FuturesWorkstationView.jsx'

export const FuturesTestnetWorkstation = ({
  enabled,
  wsConnection,
  sendMessage,
  readOnlyState,
  executionState,
}) => {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('1m')
  const workstationState = useFuturesTestnetWorkstation({
    enabled,
    symbol,
    interval,
    wsConnection,
    sendMessage,
  })

  return (
    <div className="futures-testnet-workstation" data-testid="futures-testnet-workstation">
      <FuturesWorkstationView
        identity="USDⓈ-M TESTNET · SIMULATED FUNDS"
        state={workstationState}
        selectedSymbol={symbol}
        selectedInterval={interval}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
      />
      <details className="futures-workstation-safety-drawer" open>
        <summary>
          <strong>Phase 5/6 safety drawer</strong>
          <span>Frozen BTCUSDT risk readout + reduce-only execution</span>
        </summary>
        <div className="futures-workstation-safety-content">
          <FuturesReadOnlyPanel state={readOnlyState} />
          <FuturesTestnetExecutionTicket
            state={executionState}
            onPrepareIntent={executionState.prepareIntent}
            onPlaceOrder={executionState.placeOrder}
          />
        </div>
      </details>
    </div>
  )
}

export default FuturesTestnetWorkstation
