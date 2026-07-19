import { memo, useCallback, useEffect, useRef, useState } from 'react'
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
const BINANCE_CLIENT_ORDER_ID = /^[.A-Z:/a-z0-9_-]{1,36}$/
const SIZE_ANCHORS = Object.freeze([0, 25, 50, 75, 100])
const ORDER_ACTIONS = Object.freeze([
  Object.freeze({
    key: 'LONG_ENTRY', side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', label: 'LONG entry',
  }),
  Object.freeze({
    key: 'LONG_EXIT', side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', label: 'LONG exit',
  }),
  Object.freeze({
    key: 'SHORT_ENTRY', side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', label: 'SHORT entry',
  }),
  Object.freeze({
    key: 'SHORT_EXIT', side: 'BUY', positionSide: 'SHORT', positionEffect: 'EXIT', label: 'SHORT exit',
  }),
])

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactText = value => typeof value === 'string' && value.length > 0 ? value : '—'
const DRAFT_REASON_MESSAGES = Object.freeze({
  INVALID_DRAFT_INPUT: 'Price or Binance symbol filters are unavailable',
  BELOW_MINIMUM_QUANTITY: 'Size is below the Binance minimum quantity',
  ABOVE_MAXIMUM_QUANTITY: 'Size is above the Binance maximum quantity',
  BELOW_MINIMUM_NOTIONAL: 'Size is below the Binance minimum notional',
})
const isExactPositiveDecimal = value => {
  if (typeof value !== 'string' || value.length > 42 || !EXACT_POSITIVE_DECIMAL.test(value)) return false
  const [integer, fraction = ''] = value.split('.')
  return integer.length + fraction.length <= 40 && fraction.length <= 18
}

const deriveExecutionReadiness = ({
  account,
  backendLocked,
  capabilities,
  caps,
  killSwitch,
  portfolio,
  recovery,
  safeState,
  selectedContractTradable,
  symbolConfiguration,
  hasSymbolMetadata,
  positionEffect,
  selectedSymbol,
  transportReady,
}) => {
  const capabilityCode = exactText(capabilities?.code)
  if (safeState.connected !== true) return Object.freeze({
    tone: 'attention', label: 'OFFLINE', reason: 'Execution connection unavailable — reconnect the local backend.',
  })
  if (safeState.subscribed !== true) return Object.freeze({
    tone: 'loading', label: 'SYNC', reason: 'Loading private Futures account state…',
  })
  if (safeState.configured == null) return Object.freeze({
    tone: 'loading', label: 'SYNC', reason: 'Loading private Futures account state…',
  })
  if (safeState.configured === false) return Object.freeze({
    tone: 'attention',
    label: 'SETUP',
    reason: 'Futures execution profile unavailable — configure FUTURES_PRODUCTION_* and restart (Spot BK/BS are not reused).',
  })
  if (!account) return Object.freeze({
    tone: 'loading', label: 'VERIFY', reason: 'Verifying Futures account configuration…',
  })
  if (recovery?.required === true) return Object.freeze({
    tone: 'attention', label: 'RESYNC', reason: 'Private account recovery is required — wait for a safe resync.',
  })
  if (!caps) return Object.freeze({
    tone: 'attention', label: 'LIMITS', reason: 'Trading limits are unavailable — refresh private account state.',
  })
  if (capabilityCode.includes('ACCOUNT_IDENTITY_REJECTED')) return Object.freeze({
    tone: 'attention',
    label: 'ACCOUNT',
    reason: 'Binance rejected Futures account access — verify the USDⓈ-M API permission/IP, Hedge Mode, and single-asset margin.',
  })
  if (!hasSymbolMetadata) return Object.freeze({
    tone: 'attention', label: 'METADATA', reason: 'Binance symbol metadata is unavailable — retry the contract refresh.',
  })
  if (!selectedContractTradable) {
    return Object.freeze({
      tone: 'attention',
      label: 'SYMBOL',
      reason: `${selectedSymbol} is not an active USDⓈ-M perpetual contract — select a tradable contract.`,
    })
  }
  if (!symbolConfiguration) return Object.freeze({
    tone: 'loading',
    label: 'CONFIG',
    reason: `${selectedSymbol} Futures configuration is unavailable — refresh private account state or reselect the contract.`,
  })
  if (positionEffect !== 'EXIT' && symbolConfiguration.marginType !== 'ISOLATED') return Object.freeze({
    tone: 'attention', label: 'MARGIN', reason: `${selectedSymbol} uses Cross margin — switch it to Isolated on Binance.`,
  })
  if (positionEffect !== 'EXIT' && symbolConfiguration.isAutoAddMargin !== false) return Object.freeze({
    tone: 'attention', label: 'AUTO ADD', reason: `${selectedSymbol} auto-add margin is enabled — disable it on Binance.`,
  })
  if (positionEffect !== 'EXIT' && symbolConfiguration.leverage !== caps.maxLeverage) return Object.freeze({
    tone: 'attention', label: 'LEVERAGE', reason: `${selectedSymbol} leverage is ${symbolConfiguration.leverage}× — set it to ${caps.maxLeverage}× on Binance.`,
  })
  if (safeState.liveAuthorized !== true) return Object.freeze({
    tone: 'attention', label: 'LOCKED', reason: 'Live Futures execution is disabled in the production configuration.',
  })
  if (positionEffect !== 'EXIT'
    && typeof portfolio?.availableBalanceUsdt !== 'string') return Object.freeze({
    tone: 'loading', label: 'BALANCE', reason: 'Available Futures balance is pending — wait for private account sync.',
  })
  if (backendLocked) return Object.freeze({
    tone: 'loading', label: 'SENDING', reason: 'An execution request is awaiting an authoritative result.',
  })
  if (killSwitch?.engaged === true && positionEffect !== 'EXIT') return Object.freeze({
    tone: 'attention', label: 'LOCKED', reason: 'New exposure is locked — use Advanced safety to arm execution.',
  })
  if (transportReady && capabilities?.placeOrder === true) {
    const ordersResyncing = typeof portfolio?.syncState === 'string'
      && !['live', 'synced'].includes(portfolio.syncState)
    return Object.freeze({
      tone: 'ready',
      label: 'READY',
      reason: ordersResyncing
        ? 'Execution ready; active orders are safely resynchronizing.'
        : 'Gesture execution ready.',
    })
  }
  if (['syncing', 'resyncing', 'degraded'].includes(portfolio?.syncState)) {
    return Object.freeze({
      tone: 'loading', label: 'RESYNC', reason: 'Private order stream unavailable — waiting for REST resync.',
    })
  }
  if (capabilityCode.includes('OPERATION_BUSY')) return Object.freeze({
    tone: 'loading', label: 'BUSY', reason: 'Another Futures operation is still in progress.',
  })
  return Object.freeze({
    tone: 'attention', label: 'CHECK', reason: `Execution checks are incomplete (${capabilityCode}).`,
  })
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
  const allOpenOrders = Array.isArray(portfolio?.openOrders) ? portfolio.openOrders : []
  const openOrders = allOpenOrders.filter(order => order.symbol === selectedSymbol)
  const portfolioSyncState = typeof portfolio?.syncState === 'string'
    ? portfolio.syncState
    : portfolio?.state
  const [tab, setTab] = useState('trade')
  const [sizePercent, setSizePercent] = useState(25)
  const [customNotionalUsdt, setCustomNotionalUsdt] = useState(null)
  const [localPrice, setLocalPrice] = useState('')
  const [marginSelection, setMarginSelection] = useState(null)
  const [marginAmount, setMarginAmount] = useState('')
  const actionGuardRef = useRef({ key: null, locked: false })
  const handledGestureRef = useRef(null)
  const handledOrderAmendmentRef = useRef(null)
  const pendingGestureRef = useRef(null)
  const pendingOrderAmendmentRef = useRef(null)
  const finalizedAutomaticIntentsRef = useRef(new Set())
  const gestureAction = ORDER_ACTIONS.find(candidate => (
    candidate.side === gestureRequest?.side
    && candidate.positionSide === gestureRequest?.positionSide
    && candidate.positionEffect === gestureRequest?.positionEffect
  )) ?? null
  const activeAction = gestureAction ?? ORDER_ACTIONS[0]
  const price = typeof draftPrice === 'string' ? draftPrice : localPrice
  const backendRevision = typeof safeState.revision === 'string' ? safeState.revision : null
  const intentId = typeof intent?.requestId === 'string' ? intent.requestId : null
  const guardKey = `${backendRevision ?? ''}:${intentId ?? ''}`
  const transportReady = safeState.connected === true && safeState.subscribed === true
  const backendLocked = safeState.submissionLocked === true
  const selectedContractTradable = selectedContract?.symbol === selectedSymbol
    && selectedContract?.tradable === true
  const symbolConfiguration = Array.isArray(caps?.symbolConfigurations)
    ? caps.symbolConfigurations.find(configuration => configuration.symbol === selectedSymbol) ?? null
    : null
  const symbolExecutionConfigured = symbolConfiguration?.marginType === 'ISOLATED'
    && symbolConfiguration?.isAutoAddMargin === false
    && symbolConfiguration?.leverage === caps?.maxLeverage
  const symbolConfigurationAllowsGesture = Boolean(symbolConfiguration)
    && (activeAction.positionEffect === 'EXIT' || symbolExecutionConfigured)
  const gestureCanPrepare = transportReady
    && selectedContractTradable
    && symbolConfigurationAllowsGesture
    && capabilities?.placeOrder === true
    && intent === null
    && !backendLocked
  const amendmentCanPrepare = transportReady
    && selectedContractTradable
    && symbolExecutionConfigured
    && capabilities?.amendOrder === true
    && intent === null
    && !backendLocked
  const entryBudget = safeState.configured === true
    && account !== null
    && selectedContractTradable
    && caps !== null
    && typeof portfolio?.availableBalanceUsdt === 'string'
    ? calculateFuturesEntryBudget({
      maximumOrderNotionalUsdt: caps.maxOrderNotionalUsdt,
      maximumDailyNotionalUsdt: caps.maxDailyNotionalUsdt,
      dailyUsedNotionalUsdt: caps.dailyUsedNotionalUsdt,
      availableBalanceUsdt: portfolio.availableBalanceUsdt,
      minimumAvailableBalanceUsdt: caps.minAvailableBalanceUsdt,
      leverage: caps.maxLeverage,
    })
    : null
  const selectedPosition = positions.find(position => (
    position.symbol === selectedSymbol
    && position.positionSide === activeAction.positionSide
  )) ?? null
  const exitBudget = safeState.configured === true && selectedContractTradable && caps !== null
    ? calculateFuturesExitBudget({
      positionQuantity: selectedPosition?.quantity,
      price,
      tickSize: selectedContract.filters?.price?.tickSize,
      maximumOrderNotionalUsdt: caps.maxOrderNotionalUsdt,
      maximumDailyNotionalUsdt: caps.maxDailyNotionalUsdt,
      dailyUsedNotionalUsdt: caps.dailyUsedNotionalUsdt,
    })
    : null
  const sizingBudget = activeAction.positionEffect === 'EXIT' ? exitBudget : entryBudget
  const sizingReady = typeof sizingBudget === 'string'
    && sizingBudget !== '0'
    && isExactPositiveDecimal(sizingBudget)
  const notionalUsdt = sizingReady
    ? customNotionalUsdt ?? calculateFuturesNotionalForPercent(sizingBudget, sizePercent) ?? ''
    : ''
  const currentSizePercent = customNotionalUsdt === null
    ? sizePercent
    : calculateFuturesNotionalPercent(customNotionalUsdt, sizingBudget) ?? 0
  const displayedSizePercent = sizingReady ? currentSizePercent : 0
  const tickSize = selectedContract?.filters?.price?.tickSize
  const stepSize = selectedContract?.filters?.quantity?.stepSize
  const minQuantity = selectedContract?.filters?.quantity?.min
  const maxQuantity = selectedContract?.filters?.quantity?.max
  const minNotionalUsdt = selectedContract?.filters?.minimumNotional
  const leverage = symbolConfiguration?.leverage
  const hasSymbolSizingMetadata = isExactPositiveDecimal(tickSize)
    && isExactPositiveDecimal(stepSize)
    && isExactPositiveDecimal(minQuantity)
    && isExactPositiveDecimal(maxQuantity)
    && isExactPositiveDecimal(minNotionalUsdt)
  const normalizedAmendmentPrice = typeof orderAmendRequest?.price === 'string'
    ? normalizeFuturesDraftPrice(orderAmendRequest.price, tickSize)
    : null
  const readiness = deriveExecutionReadiness({
    account,
    backendLocked,
    capabilities,
    caps,
    killSwitch,
    portfolio,
    recovery,
    safeState,
    selectedContractTradable,
    symbolConfiguration,
    hasSymbolMetadata: Boolean(selectedContract) && hasSymbolSizingMetadata,
    positionEffect: activeAction.positionEffect,
    selectedSymbol,
    transportReady,
  })

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
  useEffect(() => {
    pendingGestureRef.current = null
    pendingOrderAmendmentRef.current = null
    actionGuardRef.current = { key: null, locked: false }
  }, [selectedSymbol])
  useEffect(() => {
    const gestureId = gestureRequest?.id
    if (gestureId === null || gestureId === undefined || handledGestureRef.current === gestureId) return
    if (!gestureAction || typeof gestureRequest.price !== 'string') return
    handledGestureRef.current = gestureId
    if (!isExactPositiveDecimal(notionalUsdt)) return
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
      || !isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)
      || (killSwitch?.engaged === true && gestureAction.positionEffect !== 'EXIT')) return
    const accepted = claimAction(onPrepareOrderIntent, {
      symbol: selectedSymbol,
      side: gestureAction.side,
      positionSide: gestureAction.positionSide,
      positionEffect: gestureAction.positionEffect,
      quantity: candidateDraft.quantity,
      price: candidateDraft.price,
    })
    if (accepted) pendingGestureRef.current = Object.freeze({
      gestureId,
      label: gestureAction.label,
      positionSide: gestureAction.positionSide,
      symbol: selectedSymbol,
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
    sizingBudget,
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
      || !BINANCE_CLIENT_ORDER_ID.test(orderAmendRequest.clientOrderId)
      || !isExactPositiveDecimal(normalizedAmendmentPrice)) return
    const accepted = claimAction(onPrepareOrderAmendment, {
      symbol: orderAmendRequest.symbol,
      positionSide: orderAmendRequest.positionSide,
      clientOrderId: orderAmendRequest.clientOrderId,
      price: normalizedAmendmentPrice,
    })
    if (accepted) pendingOrderAmendmentRef.current = Object.freeze({
      amendmentId,
      clientOrderId: orderAmendRequest.clientOrderId,
      positionSide: orderAmendRequest.positionSide,
      symbol: orderAmendRequest.symbol,
    })
  }, [
    amendmentCanPrepare,
    claimAction,
    onPrepareOrderAmendment,
    orderAmendRequest,
    normalizedAmendmentPrice,
    selectedSymbol,
  ])

  useEffect(() => {
    const intentRequestId = intent?.requestId
    if (typeof intentRequestId !== 'string'
      || finalizedAutomaticIntentsRef.current.has(intentRequestId)
      || !transportReady
      || backendLocked) return

    let pending = null
    let capability = null
    let confirmation = null
    let finalize = null
    if (intent.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER) {
      pending = pendingGestureRef.current
      capability = capabilities?.placeOrder
      confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.PLACE_ORDER
      ]
      finalize = onPlaceOrder
    } else if (intent.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT) {
      pending = pendingOrderAmendmentRef.current
      capability = capabilities?.amendOrder
      confirmation = FUTURES_PRODUCTION_EXECUTION_CONFIRMATIONS[
        FUTURES_PRODUCTION_EXECUTION_ACTIONS.AMEND_ORDER
      ]
      finalize = onAmendOrder
    }
    if (!pending
      || pending.symbol !== selectedSymbol
      || capability !== true
      || typeof finalize !== 'function') return

    const finalized = finalizedAutomaticIntentsRef.current
    finalized.add(intentRequestId)
    if (finalized.size > 32) finalized.delete(finalized.values().next().value)
    claimAction(finalize, confirmation)
  }, [
    backendLocked,
    capabilities?.amendOrder,
    capabilities?.placeOrder,
    claimAction,
    intent,
    onAmendOrder,
    onPlaceOrder,
    selectedSymbol,
    transportReady,
  ])

  const handleNotionalChange = value => {
    setCustomNotionalUsdt(value)
  }

  const selectSizePercent = value => {
    setCustomNotionalUsdt(null)
    setSizePercent(value)
  }

  const amountWithinBudget = isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)
  const draftReason = !caps
    ? 'Trading limits are unavailable — refresh private account state'
    : !selectedContract || !hasSymbolSizingMetadata
    ? 'Binance symbol metadata is unavailable — retry the contract refresh'
    : !selectedContractTradable
    ? `${selectedSymbol} is not an active USDⓈ-M perpetual contract — select a tradable contract`
    : !symbolConfiguration
    ? `${selectedSymbol} Futures configuration is unavailable — refresh private account state or reselect the contract`
    : !symbolConfigurationAllowsGesture
    ? readiness.reason
    : activeAction.positionEffect === 'ENTRY' && typeof portfolio?.availableBalanceUsdt !== 'string'
    ? 'Available Futures balance is unavailable — wait for private account sync'
    : activeAction.positionEffect === 'EXIT' && !selectedPosition
    ? `No open ${activeAction.positionSide} leg is available for this exit`
    : !price
    ? 'Pick a chart or order-book price'
    : !sizingReady
    ? activeAction.positionEffect === 'ENTRY'
      ? 'No available USDT remains after the safety reserve and policy limits'
      : `The ${activeAction.positionSide} position size cannot be calculated`
    : !isExactPositiveDecimal(notionalUsdt)
    ? 'Choose an order size above 0%'
    : !amountWithinBudget
    ? 'Order size exceeds the available balance or position limit'
    : orderDraft.ok ? null : DRAFT_REASON_MESSAGES[orderDraft.reason] ?? orderDraft.reason
  const isUnknown = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.UNKNOWN
  const isPartial = attempt?.acknowledgement === FUTURES_PRODUCTION_EXECUTION_ACKNOWLEDGEMENTS.PARTIAL
  const marginCanPrepare = canPrepare('adjustMargin')
    && isRecord(marginSelection)
    && positions.some(position => (
      position.symbol === marginSelection.symbol
      && position.positionSide === marginSelection.positionSide
      && position.marginType === 'ISOLATED'
    ))
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
          <strong>
            {symbolConfiguration
              ? `${symbolConfiguration.marginType} · ${symbolConfiguration.leverage}× · HEDGE`
              : safeState.configured === false
                ? 'SETUP REQUIRED'
                : 'CONFIG SYNC'}
          </strong>
        </div>
        <div className="futures-production-readiness">
          <span className={`futures-production-live is-${readiness.tone}`}>{readiness.label}</span>
          <small role="status">{readiness.reason}</small>
        </div>
      </header>

      <div className="futures-production-tabs" role="tablist" aria-label="Futures trading rail tabs">
        <button type="button" role="tab" aria-selected={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
        <button type="button" role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders <span>{openOrders.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'positions'} onClick={() => setTab('positions')}>
          Positions <span>{positions.length}</span>
        </button>
      </div>

      <div className="futures-production-execution-body">
        {tab === 'trade' ? (
          <section className="futures-production-action is-order" aria-label="Futures order size and shortcuts">
            <div className="futures-production-ticket-symbol">
              <strong>{selectedSymbol}</strong>
              <code className={gestureAction ? `is-${gestureAction.positionSide.toLowerCase()}` : ''}>
                {gestureAction ? gestureAction.label : 'Awaiting shortcut'}
              </code>
            </div>
            <label className="futures-production-price-field">
              <span>Selected price</span>
              <input
                aria-label="Exact limit price"
                type="text"
                inputMode="decimal"
                placeholder="Click chart or order book"
                value={price}
                onChange={event => updatePrice(event.target.value)}
              />
            </label>
            <label className="futures-production-size-slider">
              <span>
                <span>Size</span>
                <output aria-live="polite">
                  <strong>{sizingReady ? `${displayedSizePercent}%` : '—%'}</strong>
                  <b>{notionalUsdt ? `${notionalUsdt} USDT` : '— USDT'}</b>
                </output>
              </span>
              <input
                aria-label="Order size percent"
                type="range"
                min="0"
                max="100"
                step="1"
                value={displayedSizePercent}
                disabled={!sizingReady}
                style={{ '--futures-size-fill': `${displayedSizePercent}%` }}
                onChange={event => selectSizePercent(Number(event.target.value))}
              />
            </label>
            <div className="futures-production-size-anchors" aria-label="Order size anchors">
              {SIZE_ANCHORS.map(value => (
                <button
                  type="button"
                  key={value}
                  className={sizingReady && displayedSizePercent === value ? 'is-selected' : ''}
                  disabled={!sizingReady}
                  onClick={() => selectSizePercent(value)}
                >
                  {value}%
                </button>
              ))}
            </div>
            <label className="futures-production-notional-field">
              <span>Notional, USDT</span>
              <input
                aria-label="Order notional USDT"
                type="text"
                inputMode="decimal"
                placeholder="—"
                disabled={!sizingReady}
                value={notionalUsdt}
                onChange={event => handleNotionalChange(event.target.value)}
              />
            </label>
            <dl className="futures-production-order-summary">
              <div><dt>Price</dt><dd>{orderDraft.ok ? orderDraft.price : exactText(price)}</dd></div>
              <div><dt>Quantity</dt><dd>{orderDraft.ok ? orderDraft.quantity : '—'}</dd></div>
              <div><dt>Est. margin</dt><dd>{orderDraft.ok ? `${orderDraft.estimatedMarginUsdt} USDT` : '—'}</dd></div>
              <div><dt>Available</dt><dd>{portfolio?.availableBalanceUsdt ? `${portfolio.availableBalanceUsdt} USDT` : '—'}</dd></div>
              <div><dt>{activeAction.positionEffect === 'EXIT' ? `${activeAction.positionSide} leg` : 'Safe limit'}</dt><dd>{sizingBudget ? `${sizingBudget} USDT` : '—'}</dd></div>
            </dl>
            {draftReason ? <p className="futures-production-draft-reason" role="status">{draftReason}</p> : null}
            <div className="futures-production-shortcuts" aria-label="Futures mouse shortcuts">
              <span><kbd>Alt</kbd><b>×2 left</b><em>LONG entry</em></span>
              <span><kbd>Alt</kbd><b>×2 right</b><em>LONG exit</em></span>
              <span><kbd>Ctrl</kbd><b>×2 right</b><em>SHORT entry</em></span>
              <span><kbd>Ctrl</kbd><b>×2 left</b><em>SHORT exit</em></span>
              <small>Ctrl/Alt + drag an order line to move it</small>
            </div>
            {orderAmendRequest ? (
              <div className="futures-production-order-amendment" role="status">
                <span>Move {orderAmendRequest.positionSide} order</span>
                <strong>{normalizedAmendmentPrice ?? orderAmendRequest.price}</strong>
                <code>{orderAmendRequest.clientOrderId}</code>
              </div>
            ) : null}
            {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER ? (
              <section className={`futures-production-gesture-confirmation is-${activeAction.positionSide.toLowerCase()}`} aria-label="Prepared Futures gesture">
                <header><span>Prepared gesture</span><strong>{activeAction.label}</strong></header>
                <p>{orderDraft.ok ? `${orderDraft.quantity} ${selectedSymbol} @ ${orderDraft.price}` : selectedSymbol}</p>
                <p role="status">Verified shortcut intent · automatic submission is server-authoritative.</p>
              </section>
            ) : null}
            {intent?.kind === FUTURES_PRODUCTION_EXECUTION_INTENT_KINDS.ORDER_AMENDMENT ? (
              <p className="futures-production-automatic-command" role="status">
                Verified drag intent · automatic amendment is server-authoritative.
              </p>
            ) : null}
          </section>
        ) : tab === 'orders' ? (
          <section className="futures-production-orders" role="tabpanel" aria-label="Current Futures orders">
            <header className="futures-production-portfolio-heading">
              <div><strong>Open orders</strong><span>{openOrders.length} active</span></div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={!transportReady || backendLocked || typeof onRefreshPortfolio !== 'function'}
                onClick={() => claimAction(onRefreshPortfolio)}
              >
                ↻
              </button>
            </header>
            {portfolioSyncState !== 'live' ? (
              <p role="status">Active orders are {portfolioSyncState ?? 'loading'}; last confirmed rows are retained.</p>
            ) : null}
            {openOrders.length === 0 ? <p>No active Futures orders.</p> : openOrders.map(order => (
              <article
                className={`${order.symbol === selectedSymbol ? 'is-current-symbol' : ''} is-${order.positionSide.toLowerCase()}`}
                key={`${order.symbol}:${order.orderKind}:${order.orderId}:${order.clientOrderId}`}
              >
                <header>
                  <div><strong>{order.symbol}</strong><span>{order.side} · {order.positionSide}</span></div>
                  <code>
                    {order.status}{order.syncState ? ` · ${order.syncState.toUpperCase()}` : ''}
                  </code>
                </header>
                <dl>
                  <div><dt>Type</dt><dd>{order.orderKind === 'ALGO' ? `ALGO · ${order.type}` : order.type}</dd></div>
                  <div><dt>Price</dt><dd>{order.price}</dd></div>
                  <div><dt>Original qty</dt><dd>{order.originalQuantity}</dd></div>
                  <div><dt>Filled qty</dt><dd>{order.executedQuantity}</dd></div>
                </dl>
                <small>{order.orderKind === 'REGULAR' ? 'Ctrl/Alt + drag its chart line to move' : 'Managed by Binance conditional-order API'}</small>
              </article>
            ))}
          </section>
        ) : (
          <section className="futures-production-positions" role="tabpanel" aria-label="Hedge positions">
            <header className="futures-production-portfolio-heading">
              <div><strong>Hedge positions</strong><span>{positions.length} open legs</span></div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={!transportReady || backendLocked || typeof onRefreshPortfolio !== 'function'}
                onClick={() => claimAction(onRefreshPortfolio)}
              >
                ↻
              </button>
            </header>
            {portfolio?.state !== 'live' ? (
              <p role="status">Private positions are {portfolio?.state ?? 'unavailable'}; last confirmed legs are retained.</p>
            ) : null}
            {positions.length === 0 ? <p>No open LONG or SHORT positions.</p> : positions.map(position => (
              <article
                className={`is-${position.positionSide.toLowerCase()}`}
                key={`${position.symbol}:${position.positionSide}`}
              >
                <header><strong>{position.symbol}</strong><span>{position.positionSide}</span></header>
                <dl>
                  <div><dt>Qty</dt><dd>{exactText(position.quantity)}</dd></div>
                  <div><dt>Margin</dt><dd>{position.marginType} · {position.leverage}×</dd></div>
                  <div><dt>Isolated</dt><dd>{position.marginType === 'ISOLATED' ? `${exactText(position.isolatedMarginUsdt)} USDT` : '—'}</dd></div>
                  <div><dt>UPnL</dt><dd>{exactText(position.unrealizedPnlUsdt)} USDT</dd></div>
                  <div><dt>Liq.</dt><dd>{exactText(position.liquidationPrice)}</dd></div>
                </dl>
                <div>
                  <button
                    type="button"
                    disabled={position.marginType !== 'ISOLATED' || capabilities?.adjustMargin !== true || typeof onPrepareMarginAdjustment !== 'function'}
                    onClick={() => selectMarginAdjustment(position, 'ADD')}
                  >
                    Add margin
                  </button>
                  <button
                    type="button"
                    disabled={position.marginType !== 'ISOLATED' || killSwitch?.engaged === true || capabilities?.adjustMargin !== true || typeof onPrepareMarginAdjustment !== 'function'}
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
            <h3>
              ARM LIVE · {symbolConfiguration
                ? `HEDGE / ${symbolConfiguration.marginType} / ${symbolConfiguration.leverage}×`
                : safeState.configured === false
                  ? 'SETUP REQUIRED'
                  : 'CONFIG SYNC'}
            </h3>
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

const MemoizedFuturesProductionExecutionTicket = memo(FuturesProductionExecutionTicket)
MemoizedFuturesProductionExecutionTicket.displayName = 'FuturesProductionExecutionTicket'

export default MemoizedFuturesProductionExecutionTicket
export { FuturesProductionExecutionTicket }
