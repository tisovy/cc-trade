import { useEffect, useRef, useState } from 'react'
import {
  FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS,
  FUTURES_TESTNET_EXECUTION_STATES,
} from '../../../utils/futuresTestnetExecutionProtocol.js'
import './FuturesTestnetExecutionTicket.css'

const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const exactText = (value) => typeof value === 'string' && value.length > 0 ? value : '—'

const recoveryText = (attempt) => {
  if (!isRecord(attempt)) return null
  if (attempt.state === FUTURES_TESTNET_EXECUTION_STATES.RECONCILING) {
    return 'Backend reconciliation in progress.'
  }
  if (attempt.state === FUTURES_TESTNET_EXECUTION_STATES.RESULT_UNKNOWN) {
    return 'Result unknown. Backend recovery remains active.'
  }
  if (attempt.state === FUTURES_TESTNET_EXECUTION_STATES.RECONCILIATION_UNAVAILABLE) {
    return 'Backend recovery is unavailable. New submission remains blocked.'
  }
  if (attempt.state === FUTURES_TESTNET_EXECUTION_STATES.CONFIRMED_OPEN) {
    return 'Order confirmed open. Cancellation is available only in the external Binance Futures Testnet interface.'
  }
  return null
}

const blockEnterActivation = (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
}

const FuturesTestnetExecutionTicket = ({
  state,
  onPrepareIntent,
  onPlaceOrder,
}) => {
  const safeState = isRecord(state) ? state : {}
  const capability = isRecord(safeState.capability) ? safeState.capability : null
  const intent = isRecord(safeState.intent) ? safeState.intent : null
  const attempt = isRecord(safeState.attempt) ? safeState.attempt : null
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const actionGuardRef = useRef(false)
  const backendRevision = typeof safeState.revision === 'string' ? safeState.revision : null
  const intentId = typeof intent?.requestId === 'string' ? intent.requestId : null

  useEffect(() => {
    actionGuardRef.current = false
  }, [backendRevision, intentId])

  const capabilityEnabled = capability?.enabled === true
  const capabilityLabel = capability === null
    ? 'Awaiting backend capability'
    : capabilityEnabled
      ? 'Execution enabled'
      : 'Execution disabled'
  const transportReady = safeState.connected === true && safeState.subscribed === true
  const backendLocked = safeState.submissionLocked === true
  const hasExactInputs = quantity.length <= 42
    && price.length <= 42
    && EXACT_POSITIVE_DECIMAL.test(quantity)
    && EXACT_POSITIVE_DECIMAL.test(price)
  const canPrepare = transportReady && capabilityEnabled && intent === null && !backendLocked
  const canPlace = transportReady && capabilityEnabled && intent !== null && hasExactInputs && !backendLocked
  const recovery = recoveryText(attempt)

  const handlePrepare = () => {
    if (!canPrepare || actionGuardRef.current || typeof onPrepareIntent !== 'function') return
    actionGuardRef.current = true
    if (onPrepareIntent() !== true) actionGuardRef.current = false
  }

  const handlePlace = () => {
    if (!canPlace || actionGuardRef.current || typeof onPlaceOrder !== 'function') return
    actionGuardRef.current = true
    if (onPlaceOrder({
      quantity,
      price,
    }) !== true) actionGuardRef.current = false
  }

  return (
    <aside className="futures-testnet-execution-ticket" aria-label="USDⓈ-M testnet reduce-only execution">
      <header className="futures-testnet-execution-header">
        <div>
          <span className="futures-testnet-execution-market">USDⓈ-M TESTNET · REDUCE ONLY</span>
          <strong>{exactText(safeState.symbol)}</strong>
        </div>
        <span
          className={`futures-testnet-execution-capability is-${capabilityEnabled ? 'enabled' : 'disabled'}`}
          role="status"
        >
          {capabilityLabel}
        </span>
      </header>

      <div className="futures-testnet-execution-body">
        <div className="futures-testnet-execution-backend-state">
          <span>Backend capability</span>
          <code>{exactText(capability?.code)}</code>
        </div>

        <dl className="futures-testnet-execution-fixed-facts" aria-label="Fixed order facts">
          <div><dt>Order</dt><dd>LIMIT / GTC</dd></div>
          <div><dt>Position</dt><dd>ONE-WAY / BOTH</dd></div>
          <div><dt>Margin</dt><dd>ISOLATED</dd></div>
          <div><dt>Protection</dt><dd>REDUCE ONLY</dd></div>
          <div><dt>Working type</dt><dd>NOT APPLICABLE</dd></div>
          <div><dt>Price protect</dt><dd>OFF</dd></div>
        </dl>

        {intent ? (
          <section className="futures-testnet-execution-intent" aria-label="Backend execution intent">
            <div><span>One-use intent</span><code>{exactText(intent.requestId)}</code></div>
            <div><span>Client order ID</span><code>{exactText(intent.clientOrderId)}</code></div>
            <div><span>Reduce side</span><code>{exactText(intent.side)}</code></div>
            <div><span>Observed leverage</span><code>{String(intent.leverage)}×</code></div>
            <div><span>Expires at</span><code>{String(intent.expiresAt)}</code></div>
          </section>
        ) : null}

        {attempt ? (
          <section
            className={`futures-testnet-execution-attempt is-${attempt.acknowledgement}`}
            aria-label="Backend execution result"
          >
            <div className="futures-testnet-execution-attempt-heading">
              <strong>{exactText(attempt.acknowledgement).toUpperCase()}</strong>
              <code>{exactText(attempt.state)}</code>
            </div>
            <p>{exactText(attempt.message)}</p>
            <small>{exactText(attempt.code)}</small>
            {attempt.order ? (
              <div className="futures-testnet-execution-order-state">
                <span>Order {exactText(attempt.order.orderId)}</span>
                <strong>{exactText(attempt.order.status)}</strong>
              </div>
            ) : null}
            {recovery ? <p className="futures-testnet-execution-recovery">{recovery}</p> : null}
          </section>
        ) : null}

        <div className="futures-testnet-execution-fields">
          <label>
            <span>Exact quantity</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck="false"
              maxLength={42}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              onKeyDown={blockEnterActivation}
            />
          </label>
          <label>
            <span>Exact limit price</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              spellCheck="false"
              maxLength={42}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              onKeyDown={blockEnterActivation}
            />
          </label>
        </div>

        <div className="futures-testnet-execution-actions">
          <button
            type="button"
            disabled={!canPrepare}
            onClick={handlePrepare}
            onKeyDown={blockEnterActivation}
          >
            Prepare one-use intent
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={!canPlace}
            onClick={handlePlace}
            onKeyDown={blockEnterActivation}
          >
            Place testnet reduce-only order
          </button>
        </div>

        {attempt?.acknowledgement === FUTURES_TESTNET_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN ? (
          <p className="futures-testnet-execution-unknown" role="status">
            Unknown is not success or rejection. Backend recovery owns the result.
          </p>
        ) : null}
      </div>
    </aside>
  )
}

export default FuturesTestnetExecutionTicket
export { FuturesTestnetExecutionTicket }
