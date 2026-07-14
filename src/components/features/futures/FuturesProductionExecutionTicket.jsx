import { useRef, useState } from 'react'
import {
  FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
  FUTURES_PRODUCTION_EXECUTION_ACTIONS,
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
  FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
} from '../../../utils/futuresProductionExecutionProtocol.js'
import './FuturesProductionExecutionTicket.css'

const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/
const SYMBOL = /^[A-Z0-9]{2,20}$/

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactText = (value) => typeof value === 'string' && value.length > 0 ? value : '—'
const exactSymbolList = (value) => Array.isArray(value)
  && value.length > 0
  && value.every((symbol) => typeof symbol === 'string' && SYMBOL.test(symbol))
  ? value.join(', ')
  : '—'

const isExactPositiveDecimal = (value) => {
  if (typeof value !== 'string' || value.length > 42 || !EXACT_POSITIVE_DECIMAL.test(value)) return false
  const [integer, fraction = ''] = value.split('.')
  return integer.length + fraction.length <= 40 && fraction.length <= 18
}

const blockEnterActivation = (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
}

const ConfirmationControl = ({
  action,
  disabled,
  buttonLabel,
  onConfirm,
}) => {
  const [confirmation, setConfirmation] = useState('')
  const exactConfirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action]
  const matches = confirmation === exactConfirmation

  return (
    <div className="futures-production-confirmation">
      <label>
        <span>Type exactly: <code>{exactConfirmation}</code></span>
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck="false"
          maxLength={exactConfirmation.length}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          onKeyDown={blockEnterActivation}
        />
      </label>
      <button
        type="button"
        className="is-final"
        disabled={disabled || !matches}
        onClick={() => onConfirm(confirmation)}
        onKeyDown={blockEnterActivation}
      >
        {buttonLabel}
      </button>
    </div>
  )
}

const FuturesProductionExecutionTicket = ({
  state,
  onPrepareOrderIntent,
  onPlaceOrder,
  onPrepareCancelAllOpenOrdersIntent,
  onCancelAllOpenOrders,
  onPrepareClosePositionsIntent,
  onClosePositions,
  onPrepareEngageKillSwitchIntent,
  onEngageKillSwitch,
  onPrepareDisengageKillSwitchIntent,
  onDisengageKillSwitch,
}) => {
  const safeState = isRecord(state) ? state : {}
  const account = isRecord(safeState.account) ? safeState.account : null
  const caps = isRecord(safeState.caps) ? safeState.caps : null
  const killSwitch = isRecord(safeState.killSwitch) ? safeState.killSwitch : null
  const capabilities = isRecord(safeState.capabilities) ? safeState.capabilities : null
  const intent = isRecord(safeState.intent) ? safeState.intent : null
  const attempt = isRecord(safeState.attempt) ? safeState.attempt : null
  const reconciliation = isRecord(safeState.reconciliation) ? safeState.reconciliation : null
  const recovery = isRecord(safeState.recovery) ? safeState.recovery : null
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [side, setSide] = useState('BUY')
  const [quantity, setQuantity] = useState('')
  const [price, setPrice] = useState('')
  const [reduceOnly, setReduceOnly] = useState(false)
  const actionGuardRef = useRef({ key: null, locked: false })
  const backendRevision = typeof safeState.revision === 'string' ? safeState.revision : null
  const intentId = typeof intent?.requestId === 'string' ? intent.requestId : null
  const guardKey = `${backendRevision ?? ''}:${intentId ?? ''}`
  const transportReady = safeState.connected === true && safeState.subscribed === true
  const backendLocked = safeState.submissionLocked === true
  const hasExactOrderDraft = SYMBOL.test(symbol)
    && ['BUY', 'SELL'].includes(side)
    && isExactPositiveDecimal(quantity)
    && isExactPositiveDecimal(price)

  const claimAction = (callback, payload) => {
    if (typeof callback !== 'function') return false
    if (actionGuardRef.current.key !== guardKey) {
      actionGuardRef.current = { key: guardKey, locked: false }
    }
    if (actionGuardRef.current.locked) return false
    actionGuardRef.current.locked = true
    let accepted = false
    try {
      accepted = payload === undefined ? callback() === true : callback(payload) === true
    } catch {
      accepted = false
    }
    if (!accepted) actionGuardRef.current.locked = false
    return accepted
  }

  const canPrepare = (capability) => transportReady
    && capabilities?.[capability] === true
    && intent === null
    && !backendLocked
  const canFinalize = (kind, capability) => transportReady
    && capabilities?.[capability] === true
    && intent?.kind === kind
    && !backendLocked
  const canPrepareOrder = canPrepare('placeOrder')
    && hasExactOrderDraft
    && (killSwitch?.engaged !== true || reduceOnly)

  const handlePrepareOrder = () => {
    if (!canPrepareOrder) return
    claimAction(onPrepareOrderIntent, {
      symbol,
      side,
      quantity,
      price,
      reduceOnly,
    })
  }

  const attemptAcknowledgement = exactText(attempt?.acknowledgement)
  const isUnknown = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN
  const isPartial = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL

  return (
    <aside
      className="futures-production-execution-ticket"
      aria-label="USDⓈ-M production real-order execution"
      onKeyDownCapture={blockEnterActivation}
    >
      <header className="futures-production-execution-header">
        <div>
          <span className="futures-production-execution-market">USDⓈ-M PRODUCTION · REAL ORDERS</span>
          <strong>{exactText(safeState.mode).toUpperCase()}</strong>
        </div>
        <span className={`futures-production-live is-${safeState.liveAuthorized === true && killSwitch?.engaged === false ? 'armed' : 'blocked'}`}>
          {safeState.liveAuthorized !== true
            ? 'LIVE BLOCKED'
            : killSwitch?.engaged === false ? 'LIVE ARMED' : 'LIVE LOCKED'}
        </span>
      </header>

      <div className="futures-production-execution-body">
        <dl className="futures-production-status-grid" aria-label="Backend production identity and mode">
          <div><dt>Configuration</dt><dd>{safeState.configured === true ? 'CONFIGURED' : 'DISABLED'}</dd></div>
          <div><dt>Account alias</dt><dd>{exactText(account?.alias)}</dd></div>
          <div className="is-wide"><dt>Account fingerprint</dt><dd>{exactText(account?.fingerprint)}</dd></div>
        </dl>

        <dl className="futures-production-status-grid" aria-label="Backend production caps">
          <div className="is-wide"><dt>Allowed symbols</dt><dd>{exactSymbolList(caps?.allowedSymbols)}</dd></div>
          <div><dt>Maximum leverage</dt><dd>{caps ? `${caps.maxLeverage}×` : '—'}</dd></div>
          <div><dt>Maximum order notional</dt><dd>{caps ? `${caps.maxOrderNotionalUsdt} USDT` : '—'}</dd></div>
          <div><dt>Maximum daily notional</dt><dd>{caps ? `${caps.maxDailyNotionalUsdt} USDT` : '—'}</dd></div>
          <div><dt>Minimum available balance</dt><dd>{caps ? `${caps.minAvailableBalanceUsdt} USDT` : '—'}</dd></div>
          <div><dt>Minimum liquidation distance</dt><dd>{caps ? `${caps.minLiquidationDistanceBps} bps` : '—'}</dd></div>
          <div><dt>Daily used · {exactText(caps?.utcDay)} UTC</dt><dd>{caps ? `${caps.dailyUsedNotionalUsdt} USDT` : '—'}</dd></div>
        </dl>

        <dl className="futures-production-status-grid" aria-label="Backend kill switch">
          <div><dt>Kill switch</dt><dd>{killSwitch?.engaged === true ? 'ENGAGED' : killSwitch ? 'DISENGAGED' : '—'}</dd></div>
          <div><dt>Kill policy</dt><dd>{exactText(killSwitch?.policy)}</dd></div>
        </dl>

        {intent ? (
          <section className="futures-production-backend-card" aria-label="Backend production intent">
            <strong>ONE-USE INTENT</strong>
            <dl>
              <div><dt>Kind</dt><dd>{exactText(intent.kind)}</dd></div>
              <div><dt>Request</dt><dd>{exactText(intent.requestId)}</dd></div>
              <div><dt>Revision</dt><dd>{exactText(intent.revision)}</dd></div>
              <div><dt>Expires</dt><dd>{String(intent.expiresAt)}</dd></div>
            </dl>
          </section>
        ) : null}

        {attempt ? (
          <section
            className={`futures-production-backend-card futures-production-attempt is-${attempt.acknowledgement}`}
            aria-label="Backend production attempt"
          >
            <div className="futures-production-card-heading">
              <strong>{attemptAcknowledgement.toUpperCase()}</strong>
              <code>{exactText(attempt.state)}</code>
            </div>
            <dl>
              <div><dt>Kind</dt><dd>{exactText(attempt.kind)}</dd></div>
              <div><dt>Request</dt><dd>{exactText(attempt.requestId)}</dd></div>
              <div><dt>Code</dt><dd>{exactText(attempt.code)}</dd></div>
              <div><dt>Observed</dt><dd>{String(attempt.observedAt)}</dd></div>
            </dl>
            {Array.isArray(attempt.items) && attempt.items.length > 0 ? (
              <ul aria-label="Backend production item outcomes">
                {attempt.items.map((item, index) => (
                  <li key={`${item.symbol ?? 'account'}:${index}`}>
                    <code>{exactText(item.symbol)}</code>
                    <strong>{exactText(item.outcome).toUpperCase()}</strong>
                    <small>{exactText(item.code)}</small>
                  </li>
                ))}
              </ul>
            ) : null}
            {isUnknown ? (
              <p className="futures-production-non-success" role="status">
                UNKNOWN — not success or rejection. Backend reconciliation and recovery own the outcome.
              </p>
            ) : null}
            {isPartial ? (
              <p className="futures-production-non-success" role="status">
                PARTIAL — incomplete and never treated as success. Review every backend item outcome.
              </p>
            ) : null}
          </section>
        ) : null}

        {reconciliation ? (
          <section className="futures-production-backend-card" aria-label="Backend production reconciliation">
            <strong>RECONCILIATION</strong>
            <dl>
              <div><dt>Required</dt><dd>{reconciliation.required ? 'YES' : 'NO'}</dd></div>
              <div><dt>State</dt><dd>{exactText(reconciliation.state)}</dd></div>
              <div><dt>Next attempt</dt><dd>{reconciliation.nextAttemptAt ?? '—'}</dd></div>
            </dl>
          </section>
        ) : null}

        {recovery ? (
          <section className="futures-production-backend-card" aria-label="Backend production recovery">
            <strong>RECOVERY</strong>
            <dl>
              <div><dt>Required</dt><dd>{recovery.required ? 'YES' : 'NO'}</dd></div>
              <div><dt>State</dt><dd>{exactText(recovery.state)}</dd></div>
              <div><dt>Code</dt><dd>{exactText(recovery.code)}</dd></div>
            </dl>
          </section>
        ) : null}

        <section className="futures-production-action is-arm" aria-label="Arm production live trading action">
          <h3>ARM LIVE · 1× / 10 USDT / 50 USDT DAILY</h3>
          <p>
            Removes only the persistent new-exposure block. It does not place, cancel, or close anything.
          </p>
          <button
            type="button"
            disabled={!canPrepare('disengageKillSwitch')}
            onClick={() => claimAction(onPrepareDisengageKillSwitchIntent)}
          >
            Prepare ARM LIVE intent
          </button>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH ? (
            <ConfirmationControl
              key={intent.requestId}
              action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH}
              disabled={!canFinalize(
                FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH,
                'disengageKillSwitch',
              )}
              buttonLabel="ARM LIVE FUTURES"
              onConfirm={(confirmation) => claimAction(onDisengageKillSwitch, confirmation)}
            />
          ) : null}
        </section>

        <section className="futures-production-action" aria-label="Production order action">
          <h3>REAL LIMIT ORDER</h3>
          <div className="futures-production-order-fields">
            <label>
              <span>Symbol</span>
              <input
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck="false"
                maxLength={20}
                value={symbol}
                onChange={(event) => setSymbol(event.target.value.toUpperCase())}
              />
            </label>
            <label>
              <span>Side</span>
              <select value={side} onChange={(event) => setSide(event.target.value)}>
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </label>
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
              />
            </label>
            <label className="futures-production-checkbox">
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(event) => setReduceOnly(event.target.checked)}
              />
              <span>Reduce only</span>
            </label>
          </div>
          <button
            type="button"
            disabled={!canPrepareOrder}
            onClick={handlePrepareOrder}
          >
            Prepare real order intent
          </button>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER ? (
            <ConfirmationControl
              key={intent.requestId}
              action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER}
              disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER, 'placeOrder')}
              buttonLabel="Place real futures order"
              onConfirm={(confirmation) => claimAction(onPlaceOrder, confirmation)}
            />
          ) : null}
        </section>

        <section className="futures-production-action" aria-label="Cancel all production open orders action">
          <h3>CANCEL ALL OPEN ORDERS</h3>
          <button
            type="button"
            disabled={!canPrepare('cancelAllOpenOrders')}
            onClick={() => claimAction(onPrepareCancelAllOpenOrdersIntent)}
          >
            Prepare cancel-all intent
          </button>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS ? (
            <ConfirmationControl
              key={intent.requestId}
              action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS}
              disabled={!canFinalize(
                FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS,
                'cancelAllOpenOrders',
              )}
              buttonLabel="Cancel all real futures orders"
              onConfirm={(confirmation) => claimAction(onCancelAllOpenOrders, confirmation)}
            />
          ) : null}
        </section>

        <section className="futures-production-action" aria-label="Close all production positions action">
          <h3>REDUCE / CLOSE POSITIONS</h3>
          <button
            type="button"
            disabled={!canPrepare('closePositions')}
            onClick={() => claimAction(onPrepareClosePositionsIntent)}
          >
            Prepare close-positions intent
          </button>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS ? (
            <ConfirmationControl
              key={intent.requestId}
              action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS}
              disabled={!canFinalize(
                FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS,
                'closePositions',
              )}
              buttonLabel="Close all real futures positions"
              onConfirm={(confirmation) => claimAction(onClosePositions, confirmation)}
            />
          ) : null}
        </section>

        <section className="futures-production-action is-kill" aria-label="Production kill switch action">
          <h3>ENGAGE KILL SWITCH</h3>
          <button
            type="button"
            disabled={!canPrepare('engageKillSwitch')}
            onClick={() => claimAction(onPrepareEngageKillSwitchIntent)}
          >
            Prepare kill-switch intent
          </button>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH ? (
            <ConfirmationControl
              key={intent.requestId}
              action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH}
              disabled={!canFinalize(
                FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH,
                'engageKillSwitch',
              )}
              buttonLabel="Engage real futures kill switch"
              onConfirm={(confirmation) => claimAction(onEngageKillSwitch, confirmation)}
            />
          ) : null}
        </section>
      </div>
    </aside>
  )
}

export default FuturesProductionExecutionTicket
export { FuturesProductionExecutionTicket }
