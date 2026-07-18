import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS,
  FUTURES_PRODUCTION_EXECUTION_ACTIONS,
  FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS,
  FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS,
} from '../../../utils/futuresProductionExecutionProtocol.js'
import {
  calculateFuturesEntryBudget,
  calculateFuturesExitBudget,
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  deriveFuturesLimitOrderDraft,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
} from '../../../utils/futuresOrderDraft.js'
import './FuturesProductionExecutionTicket.css'

const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/
const SYMBOL = /^[A-Z0-9]{2,20}$/
const OWNED_CLIENT_ORDER_ID = /^cc7-[0-9a-f]{32}$/
const SIZE_ANCHORS = Object.freeze([0, 25, 50, 75, 100])
const ORDER_ACTIONS = Object.freeze([
  Object.freeze({
    key: 'LONG_ENTRY', side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', label: 'Enter LONG',
  }),
  Object.freeze({
    key: 'LONG_EXIT', side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', label: 'Exit LONG',
  }),
  Object.freeze({
    key: 'SHORT_ENTRY', side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', label: 'Enter SHORT',
  }),
  Object.freeze({
    key: 'SHORT_EXIT', side: 'BUY', positionSide: 'SHORT', positionEffect: 'EXIT', label: 'Exit SHORT',
  }),
])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactText = value => typeof value === 'string' && value.length > 0 ? value : '—'
const isExactPositiveDecimal = value => {
  if (typeof value !== 'string' || value.length > 42 || !EXACT_POSITIVE_DECIMAL.test(value)) return false
  const [integer, fraction = ''] = value.split('.')
  return integer.length + fraction.length <= 40 && fraction.length <= 18
}

const deriveTicketDraft = ({
  notionalUsdt,
  price,
  tickSize,
  stepSize,
  minQuantity,
  maxQuantity,
  minNotionalUsdt,
  leverage,
}) => deriveFuturesLimitOrderDraft({
  notionalUsdt,
  price,
  tickSize,
  stepSize,
  minQuantity,
  maxQuantity,
  minNotionalUsdt,
  leverage,
})

const blockEnterActivation = (event) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  event.stopPropagation()
}

const ConfirmationControl = ({ action, disabled, buttonLabel, onConfirm }) => {
  const [confirmation, setConfirmation] = useState('')
  const exactConfirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[action]
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
          onChange={event => setConfirmation(event.target.value)}
          onKeyDown={blockEnterActivation}
        />
      </label>
      <button
        type="button"
        className="is-final"
        disabled={disabled || confirmation !== exactConfirmation}
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
  selectedSymbol = 'BTCUSDT',
  selectedContract = null,
  draftPrice = null,
  gestureRequest = null,
  orderAmendRequest = null,
  onDraftPriceChange,
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
  onRefreshPortfolio,
  onPrepareMarginAdjustment,
  onAdjustMargin,
  onPrepareOrderAmendment,
  onAmendOrder,
}) => {
  const safeState = isRecord(state) ? state : {}
  const account = isRecord(safeState.account) ? safeState.account : null
  const caps = isRecord(safeState.caps) ? safeState.caps : null
  const killSwitch = isRecord(safeState.killSwitch) ? safeState.killSwitch : null
  const capabilities = isRecord(safeState.capabilities) ? safeState.capabilities : null
  const intent = isRecord(safeState.intent) ? safeState.intent : null
  const attempt = isRecord(safeState.attempt) ? safeState.attempt : null
  const recovery = isRecord(safeState.recovery) ? safeState.recovery : null
  const portfolio = isRecord(safeState.portfolio) ? safeState.portfolio : null
  const positions = Array.isArray(portfolio?.positions) ? portfolio.positions : []
  const [tab, setTab] = useState('order')
  const [actionKey, setActionKey] = useState('LONG_ENTRY')
  const [sizePercent, setSizePercent] = useState(25)
  const [customNotionalUsdt, setCustomNotionalUsdt] = useState(null)
  const [localPrice, setLocalPrice] = useState('')
  const [manualGestureSelectionId, setManualGestureSelectionId] = useState(null)
  const [marginSelection, setMarginSelection] = useState(null)
  const [marginAmount, setMarginAmount] = useState('')
  const actionGuardRef = useRef({ key: null, locked: false })
  const handledGestureRef = useRef(null)
  const handledOrderAmendmentRef = useRef(null)
  const gestureAction = ORDER_ACTIONS.find(candidate => (
    candidate.side === gestureRequest?.side
    && candidate.positionSide === gestureRequest?.positionSide
    && candidate.positionEffect === gestureRequest?.positionEffect
  )) ?? null
  const gestureOwnsSelection = gestureAction !== null
    && manualGestureSelectionId !== gestureRequest?.id
  const activeAction = gestureOwnsSelection
    ? gestureAction
    : ORDER_ACTIONS.find(action => action.key === actionKey) ?? ORDER_ACTIONS[0]
  const price = typeof draftPrice === 'string' ? draftPrice : localPrice
  const backendRevision = typeof safeState.revision === 'string' ? safeState.revision : null
  const intentId = typeof intent?.requestId === 'string' ? intent.requestId : null
  const guardKey = `${backendRevision ?? ''}:${intentId ?? ''}`
  const transportReady = safeState.connected === true && safeState.subscribed === true
  const backendLocked = safeState.submissionLocked === true
  const gestureCanPrepare = transportReady
    && capabilities?.placeOrder === true
    && intent === null
    && !backendLocked
  const amendmentCanPrepare = transportReady
    && capabilities?.amendOrder === true
    && intent === null
    && !backendLocked
  const entryBudget = calculateFuturesEntryBudget({
    maximumOrderNotionalUsdt: caps?.maxOrderNotionalUsdt,
    maximumDailyNotionalUsdt: caps?.maxDailyNotionalUsdt,
    dailyUsedNotionalUsdt: caps?.dailyUsedNotionalUsdt,
  })
  const selectedPosition = positions.find(position => (
    position.symbol === selectedSymbol
    && position.positionSide === activeAction.positionSide
  )) ?? null
  const exitBudget = calculateFuturesExitBudget({
    positionQuantity: selectedPosition?.quantity,
    price,
    tickSize: selectedContract?.filters?.price?.tickSize,
    maximumOrderNotionalUsdt: caps?.maxOrderNotionalUsdt,
    maximumDailyNotionalUsdt: caps?.maxDailyNotionalUsdt,
    dailyUsedNotionalUsdt: caps?.dailyUsedNotionalUsdt,
  })
  const sizingBudget = activeAction.positionEffect === 'EXIT' ? exitBudget : entryBudget
  const notionalUsdt = customNotionalUsdt
    ?? calculateFuturesNotionalForPercent(sizingBudget, sizePercent)
    ?? ''
  const tickSize = selectedContract?.filters?.price?.tickSize
  const stepSize = selectedContract?.filters?.quantity?.stepSize
  const minQuantity = selectedContract?.filters?.quantity?.min
  const maxQuantity = selectedContract?.filters?.quantity?.max
  const minNotionalUsdt = selectedContract?.filters?.minimumNotional
  const leverage = caps?.maxLeverage
  const normalizedAmendmentPrice = typeof orderAmendRequest?.price === 'string'
    ? normalizeFuturesDraftPrice(orderAmendRequest.price, tickSize)
    : null

  const updatePrice = useCallback((nextPrice) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(nextPrice)
    else setLocalPrice(nextPrice)
  }, [onDraftPriceChange])

  const deriveDraft = candidatePrice => deriveTicketDraft({
    notionalUsdt,
    price: candidatePrice,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotionalUsdt,
    leverage,
  })
  const orderDraft = deriveDraft(price)

  const claimAction = useCallback((callback, payload) => {
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
  }, [guardKey])

  const canPrepare = capability => transportReady
    && capabilities?.[capability] === true
    && intent === null
    && !backendLocked
  const canFinalize = (kind, capability) => transportReady
    && capabilities?.[capability] === true
    && intent?.kind === kind
    && !backendLocked
  const canPrepareAction = (action, candidateDraft = orderDraft) => canPrepare('placeOrder')
    && SYMBOL.test(selectedSymbol)
    && candidateDraft.ok
    && isExactPositiveDecimal(notionalUsdt)
    && isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)
    && (killSwitch?.engaged !== true || action.positionEffect === 'EXIT')

  const prepareAction = (action, candidatePrice = price) => {
    const candidateDraft = candidatePrice === price ? orderDraft : deriveDraft(candidatePrice)
    if (!canPrepareAction(action, candidateDraft)) return false
    return claimAction(onPrepareOrderIntent, {
      symbol: selectedSymbol,
      side: action.side,
      positionSide: action.positionSide,
      positionEffect: action.positionEffect,
      quantity: candidateDraft.quantity,
      price: candidateDraft.price,
    })
  }

  useEffect(() => {
    const gestureId = gestureRequest?.id
    if (gestureId === null || gestureId === undefined || handledGestureRef.current === gestureId) return
    if (!gestureAction || typeof gestureRequest.price !== 'string') return
    if (!isExactPositiveDecimal(notionalUsdt)) return
    handledGestureRef.current = gestureId
    const candidateDraft = deriveTicketDraft({
      notionalUsdt,
      price: gestureRequest.price,
      tickSize,
      stepSize,
      minQuantity,
      maxQuantity,
      minNotionalUsdt,
      leverage,
    })
    if (!gestureCanPrepare
      || !SYMBOL.test(selectedSymbol)
      || !candidateDraft.ok
      || (killSwitch?.engaged === true && gestureAction.positionEffect !== 'EXIT')) return
    claimAction(onPrepareOrderIntent, {
      symbol: selectedSymbol,
      side: gestureAction.side,
      positionSide: gestureAction.positionSide,
      positionEffect: gestureAction.positionEffect,
      quantity: candidateDraft.quantity,
      price: candidateDraft.price,
    })
  }, [
    claimAction,
    gestureAction,
    gestureRequest,
    killSwitch?.engaged,
    notionalUsdt,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotionalUsdt,
    leverage,
    onPrepareOrderIntent,
    selectedSymbol,
    gestureCanPrepare,
  ])

  useEffect(() => {
    const amendmentId = orderAmendRequest?.id
    if (amendmentId === null
      || amendmentId === undefined
      || handledOrderAmendmentRef.current === amendmentId) return
    handledOrderAmendmentRef.current = amendmentId
    if (!amendmentCanPrepare
      || orderAmendRequest.symbol !== selectedSymbol
      || !['LONG', 'SHORT'].includes(orderAmendRequest.positionSide)
      || typeof orderAmendRequest.clientOrderId !== 'string'
      || !OWNED_CLIENT_ORDER_ID.test(orderAmendRequest.clientOrderId)
      || !isExactPositiveDecimal(normalizedAmendmentPrice)) return
    claimAction(onPrepareOrderAmendment, {
      symbol: orderAmendRequest.symbol,
      positionSide: orderAmendRequest.positionSide,
      clientOrderId: orderAmendRequest.clientOrderId,
      price: normalizedAmendmentPrice,
    })
  }, [
    amendmentCanPrepare,
    claimAction,
    onPrepareOrderAmendment,
    orderAmendRequest,
    normalizedAmendmentPrice,
    selectedSymbol,
  ])

  const handleNotionalChange = value => {
    setCustomNotionalUsdt(value)
    setSizePercent(calculateFuturesNotionalPercent(value, sizingBudget) ?? 0)
  }

  const selectSizePercent = value => {
    setCustomNotionalUsdt(null)
    setSizePercent(value)
  }

  const selectAction = key => {
    setManualGestureSelectionId(gestureRequest?.id ?? null)
    setCustomNotionalUsdt(null)
    setActionKey(key)
  }

  const draftReason = !price
    ? 'Pick a chart or order-book price'
      : !sizingBudget || sizingBudget === '0'
      ? 'Daily/order budget exhausted'
      : orderDraft.ok ? null : orderDraft.reason
  const isUnknown = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN
  const isPartial = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL
  const marginCanPrepare = canPrepare('adjustMargin')
    && isRecord(marginSelection)
    && isExactPositiveDecimal(marginAmount)
    && !(killSwitch?.engaged === true && marginSelection.marginAction === 'REDUCE')

  const selectMarginAdjustment = (position, marginAction) => {
    setMarginSelection({
      symbol: position.symbol,
      positionSide: position.positionSide,
      marginAction,
    })
    setMarginAmount('')
  }

  const prepareMarginAdjustment = () => {
    if (!marginCanPrepare) return false
    return claimAction(onPrepareMarginAdjustment, {
      ...marginSelection,
      amount: marginAmount,
    })
  }

  return (
    <aside
      className="futures-production-execution-ticket"
      aria-label="USDⓈ-M production real-order execution"
      onKeyDownCapture={blockEnterActivation}
    >
      <header className="futures-production-execution-header">
        <div>
          <span className="futures-production-execution-market">FUTURES · USDⓈ-M</span>
          <strong>ISOLATED · 2× · HEDGE</strong>
        </div>
        <span className={`futures-production-live is-${safeState.liveAuthorized === true && killSwitch?.engaged === false ? 'armed' : 'blocked'}`}>
          {safeState.liveAuthorized !== true ? 'BLOCKED' : killSwitch?.engaged === false ? 'ARMED' : 'LOCKED'}
        </span>
      </header>

      <div className="futures-production-tabs" role="tablist" aria-label="Futures trading rail tabs">
        <button type="button" role="tab" aria-selected={tab === 'order'} onClick={() => setTab('order')}>Order</button>
        <button type="button" role="tab" aria-selected={tab === 'positions'} onClick={() => setTab('positions')}>Positions</button>
      </div>

      <div className="futures-production-execution-body">
        {tab === 'order' ? (
          <section className="futures-production-action is-order" aria-label="Production order action">
            <div className="futures-production-ticket-symbol">
              <span>Symbol</span><strong>{selectedSymbol}</strong><code>{activeAction.label}</code>
            </div>
            <div className="futures-production-intent-grid" role="group" aria-label="Hedge order intent">
              {ORDER_ACTIONS.map(action => (
                <button
                  type="button"
                  key={action.key}
                  className={`${action.positionSide === 'LONG' ? 'is-long' : 'is-short'}${activeAction.key === action.key ? ' is-selected' : ''}`}
                  aria-pressed={activeAction.key === action.key}
                  onClick={() => selectAction(action.key)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <label>
              <span>Limit price</span>
              <input
                aria-label="Exact limit price"
                type="text"
                inputMode="decimal"
                value={price}
                onChange={event => updatePrice(event.target.value)}
              />
            </label>
            <label>
              <span>Order notional, USDT</span>
              <input
                aria-label="Order notional USDT"
                type="text"
                inputMode="decimal"
                value={notionalUsdt}
                onChange={event => handleNotionalChange(event.target.value)}
              />
            </label>
            <label className="futures-production-size-slider">
              <span>Size <strong>{sizePercent}%</strong></span>
              <input
                aria-label="Order size percent"
                type="range"
                min="0"
                max="100"
                step="1"
                value={sizePercent}
                onChange={event => selectSizePercent(Number(event.target.value))}
              />
            </label>
            <div className="futures-production-size-anchors" aria-label="Order size anchors">
              {SIZE_ANCHORS.map(value => (
                <button type="button" key={value} onClick={() => selectSizePercent(value)}>{value}%</button>
              ))}
            </div>
            <dl className="futures-production-order-summary">
              <div><dt>Price</dt><dd>{orderDraft.ok ? orderDraft.price : exactText(price)}</dd></div>
              <div><dt>Quantity</dt><dd>{orderDraft.ok ? orderDraft.quantity : '—'}</dd></div>
              <div><dt>Notional</dt><dd>{orderDraft.ok ? `${orderDraft.notionalUsdt} USDT` : '—'}</dd></div>
              <div><dt>Est. margin</dt><dd>{orderDraft.ok ? `${orderDraft.estimatedMarginUsdt} USDT` : '—'}</dd></div>
              <div><dt>{activeAction.positionEffect === 'EXIT' ? 'Leg/cap budget' : 'Safe budget'}</dt><dd>{sizingBudget ? `${sizingBudget} USDT` : '—'}</dd></div>
            </dl>
            {draftReason ? <p className="futures-production-draft-reason" role="status">{draftReason}</p> : null}
            <p className="futures-production-shortcuts">
              Alt: double-left LONG in, double-right LONG out · Ctrl: double-right SHORT in, double-left SHORT out
            </p>
            <p className="futures-production-shortcuts">
              Hold Ctrl or Alt and drag an owned chart order to prepare a move.
            </p>
            {orderAmendRequest ? (
              <div className="futures-production-order-amendment" role="status">
                <span>Move {orderAmendRequest.positionSide} order</span>
                <strong>{normalizedAmendmentPrice ?? orderAmendRequest.price}</strong>
                <code>{orderAmendRequest.clientOrderId}</code>
              </div>
            ) : null}
            <button type="button" disabled={!canPrepareAction(activeAction)} onClick={() => prepareAction(activeAction)}>
              Prepare {activeAction.label}
            </button>
            {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER ? (
              <ConfirmationControl
                key={intent.requestId}
                action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER}
                disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER, 'placeOrder')}
                buttonLabel="Place real futures order"
                onConfirm={confirmation => claimAction(onPlaceOrder, confirmation)}
              />
            ) : null}
            {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT ? (
              <ConfirmationControl
                key={intent.requestId}
                action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER}
                disabled={!canFinalize(
                  FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT,
                  'amendOrder',
                )}
                buttonLabel="Move real futures order"
                onConfirm={confirmation => claimAction(onAmendOrder, confirmation)}
              />
            ) : null}
          </section>
        ) : (
          <section className="futures-production-positions" role="tabpanel" aria-label="Hedge positions">
            <button
              type="button"
              disabled={!transportReady || backendLocked || typeof onRefreshPortfolio !== 'function'}
              onClick={() => claimAction(onRefreshPortfolio)}
            >
              Refresh positions &amp; orders
            </button>
            {portfolio?.state !== 'live' ? (
              <p role="status">Private positions are {portfolio?.state ?? 'unavailable'}.</p>
            ) : positions.length === 0 ? <p>No open LONG or SHORT positions.</p> : positions.map(position => (
              <article key={`${position.symbol}:${position.positionSide}`}>
                <header><strong>{position.symbol}</strong><span>{position.positionSide}</span></header>
                <dl>
                  <div><dt>Qty</dt><dd>{exactText(position.quantity)}</dd></div>
                  <div><dt>Margin</dt><dd>{exactText(position.isolatedMarginUsdt)} USDT</dd></div>
                  <div><dt>UPnL</dt><dd>{exactText(position.unrealizedPnlUsdt)} USDT</dd></div>
                  <div><dt>Liq.</dt><dd>{exactText(position.liquidationPrice)}</dd></div>
                </dl>
                <div>
                  <button
                    type="button"
                    disabled={capabilities?.adjustMargin !== true || typeof onPrepareMarginAdjustment !== 'function'}
                    onClick={() => selectMarginAdjustment(position, 'ADD')}
                  >
                    Add margin
                  </button>
                  <button
                    type="button"
                    disabled={killSwitch?.engaged === true || capabilities?.adjustMargin !== true || typeof onPrepareMarginAdjustment !== 'function'}
                    onClick={() => selectMarginAdjustment(position, 'REDUCE')}
                  >
                    Reduce margin
                  </button>
                </div>
              </article>
            ))}
            {isRecord(marginSelection) ? (
              <section className="futures-production-margin-adjustment" aria-label="Isolated margin adjustment">
                <strong>
                  {marginSelection.marginAction} {marginSelection.symbol} {marginSelection.positionSide}
                </strong>
                <label>
                  <span>Amount, USDT</span>
                  <input
                    aria-label="Isolated margin amount USDT"
                    type="text"
                    inputMode="decimal"
                    value={marginAmount}
                    onChange={event => setMarginAmount(event.target.value)}
                  />
                </label>
                <p>Per-action safety cap: {exactText(caps?.maxOrderNotionalUsdt)} USDT</p>
                <button type="button" disabled={!marginCanPrepare} onClick={prepareMarginAdjustment}>
                  Prepare {marginSelection.marginAction.toLowerCase()} margin
                </button>
                {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT ? (
                  <ConfirmationControl
                    key={intent.requestId}
                    action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.ADJUST_ISOLATED_MARGIN}
                    disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.MARGIN_ADJUSTMENT, 'adjustMargin')}
                    buttonLabel="Adjust real isolated margin"
                    onConfirm={confirmation => claimAction(onAdjustMargin, confirmation)}
                  />
                ) : null}
              </section>
            ) : null}
          </section>
        )}

        {(attempt || recovery?.required) ? (
          <section className={`futures-production-backend-card is-${attempt?.acknowledgement ?? 'recovery'}`} aria-label="Backend production attempt">
            <strong>{exactText(attempt?.acknowledgement ?? recovery?.state).toUpperCase()}</strong>
            <code>{exactText(attempt?.state ?? recovery?.code)}</code>
            {(isUnknown || isPartial) ? <p role="status">Not success. Backend reconciliation remains authoritative.</p> : null}
          </section>
        ) : null}

        <details className="futures-production-advanced-safety">
          <summary>Advanced safety</summary>
          <dl className="futures-production-status-grid" aria-label="Backend production identity and mode">
            <div><dt>Account</dt><dd>{exactText(account?.alias)}</dd></div>
            <div><dt>Fingerprint</dt><dd>{exactText(account?.fingerprint)}</dd></div>
            <div><dt>Daily used</dt><dd>{caps ? `${caps.dailyUsedNotionalUsdt} USDT` : '—'}</dd></div>
            <div><dt>Recovery</dt><dd>{exactText(recovery?.state)}</dd></div>
          </dl>
          <section className="futures-production-action is-arm">
            <h3>ARM LIVE · HEDGE / ISOLATED / 2×</h3>
            <button type="button" disabled={!canPrepare('disengageKillSwitch')} onClick={() => claimAction(onPrepareDisengageKillSwitchIntent)}>
              Prepare ARM LIVE intent
            </button>
            {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH ? (
              <ConfirmationControl
                key={intent.requestId}
                action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.DISENGAGE_KILL_SWITCH}
                disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.DISENGAGE_KILL_SWITCH, 'disengageKillSwitch')}
                buttonLabel="ARM LIVE FUTURES"
                onConfirm={confirmation => claimAction(onDisengageKillSwitch, confirmation)}
              />
            ) : null}
          </section>
          <section className="futures-production-safety-actions">
            <button type="button" disabled={!canPrepare('cancelAllOpenOrders')} onClick={() => claimAction(onPrepareCancelAllOpenOrdersIntent)}>Prepare cancel-all</button>
            <button type="button" disabled={!canPrepare('closePositions')} onClick={() => claimAction(onPrepareClosePositionsIntent)}>Prepare close-all</button>
            <button type="button" disabled={!canPrepare('engageKillSwitch')} onClick={() => claimAction(onPrepareEngageKillSwitchIntent)}>Prepare kill switch</button>
          </section>
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS ? (
            <ConfirmationControl key={intent.requestId} action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.CANCEL_ALL_OPEN_ORDERS} disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CANCEL_ALL_OPEN_ORDERS, 'cancelAllOpenOrders')} buttonLabel="Cancel all real futures orders" onConfirm={confirmation => claimAction(onCancelAllOpenOrders, confirmation)} />
          ) : null}
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS ? (
            <ConfirmationControl key={intent.requestId} action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.CLOSE_POSITIONS} disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.CLOSE_POSITIONS, 'closePositions')} buttonLabel="Close all real futures positions" onConfirm={confirmation => claimAction(onClosePositions, confirmation)} />
          ) : null}
          {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH ? (
            <ConfirmationControl key={intent.requestId} action={FUTURES_PRODUCTION_EXECUTION_ACTIONS.ENGAGE_KILL_SWITCH} disabled={!canFinalize(FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ENGAGE_KILL_SWITCH, 'engageKillSwitch')} buttonLabel="Engage real futures kill switch" onConfirm={confirmation => claimAction(onEngageKillSwitch, confirmation)} />
          ) : null}
        </details>
      </div>
    </aside>
  )
}

export default FuturesProductionExecutionTicket
export { FuturesProductionExecutionTicket }
