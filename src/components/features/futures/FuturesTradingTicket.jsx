import { memo, useEffect, useRef, useState } from 'react'
import {
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  deriveFuturesLimitOrderDraft,
  evaluateFuturesOrderRisk,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
  quantizeFuturesNotionalUsdt,
} from '../../../utils/futuresOrderDraft.js'
import {
  describeFuturesOrderIntent,
  describeFuturesPosition,
  orderNotionalUsdt,
  totalOrderNotionalUsdt,
  formatSignedPercent,
  formatSignedUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import { describeFuturesOrderConfirmation } from '../../../utils/futuresOrderConfirmation.js'
import { formatExchangePrice, formatUsdtAmount } from '../../../utils/futuresPriceFormat.js'
import { deriveFuturesReadiness } from '../../../utils/futuresReadiness.js'
import FuturesOrderConfirmation from './FuturesOrderConfirmation.jsx'
import './FuturesProductionExecutionTicket.css'

const SIZE_ANCHORS = Object.freeze([0, 25, 50, 75, 100])
const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/

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

const DRAFT_REASON_MESSAGES = Object.freeze({
  INVALID_DRAFT_INPUT: 'Price or Binance symbol filters are unavailable',
  BELOW_MINIMUM_QUANTITY: 'Size is below the Binance minimum quantity',
  ABOVE_MAXIMUM_QUANTITY: 'Size is above the Binance maximum quantity',
  BELOW_MINIMUM_NOTIONAL: 'Size is below the Binance minimum notional',
})

const SEND_FAILED_MESSAGE = 'Local backend connection unavailable — reconnect.'

const isExactPositiveDecimal = value => (
  typeof value === 'string' && value.length <= 42 && EXACT_POSITIVE_DECIMAL.test(value)
)
const exactText = value => (typeof value === 'string' && value.length > 0 ? value : '—')

// Every contract on this desk settles in USDT, so the quote half of the name is
// the same four characters on every row of a column that has none to spare. The
// whole name stays on the cell and on every control that acts on the contract.
const contractLabel = (symbol) => {
  if (typeof symbol !== 'string' || symbol.length === 0) return '—'
  return symbol.length > 4 && symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol
}

// What the order is worth is what it is read against; the contract count is what
// the exchange works in, and it stays a hover away rather than taking a column.
const orderSizeTitle = (order) => (
  Number(order?.origQty) > 0 ? `${order.origQty} contracts` : undefined
)

// An order rests at its trigger where it has one, and the exchange pads the
// price it sends: `8.1200000` is nine characters of which three carry
// information, and in this column it wrapped onto a second line. A price of
// zero is not a price — an order carrying neither reads as absent rather than
// as resting at the cheapest level in the column.
const orderPriceText = (order, tickSize) => {
  const price = order?.triggerPrice ?? order?.price
  return Number(price) > 0 ? formatExchangePrice(price, tickSize) : '—'
}

const FuturesTradingTicket = ({
  state,
  selectedSymbol = 'BTCUSDT',
  selectedContract = null,
  draftPrice = null,
  gestureRequest = null,
  orderAmendRequest = null,
  sizeRequest = null,
  onDraftPriceChange,
  onOrderEdit,
  onPositionClose,
}) => {
  const safeState = state ?? {}
  const balances = safeState.balances ?? null
  const balanceResource = safeState.accountResources?.balances ?? {
    status: balances === null ? 'loading' : 'ready',
    data: balances,
    lastSuccessfulAt: balances === null ? null : Date.now(),
    error: null,
  }
  const openOrders = Array.isArray(safeState.openOrders) ? safeState.openOrders : []
  const positions = Array.isArray(safeState.positions) ? safeState.positions : []
  const [tab, setTab] = useState('trade')
  // Sizing starts at zero, never at a share of the balance: a size the operator
  // never chose is a size they will not read on the confirmation either.
  const [sizePercent, setSizePercent] = useState(0)
  const [customNotionalUsdt, setCustomNotionalUsdt] = useState(null)
  const [localPrice, setLocalPrice] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [pendingOrder, setPendingOrder] = useState(null)
  const handledGestureRef = useRef(null)
  const handledAmendmentRef = useRef(null)
  const handledSizeRef = useRef(null)
  const feedbackSymbolRef = useRef(selectedSymbol)

  const price = typeof draftPrice === 'string' ? draftPrice : localPrice
  const updatePrice = (nextPrice) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(nextPrice)
    else setLocalPrice(nextPrice)
  }

  const selectedContractTradable = selectedContract?.symbol === selectedSymbol
    && selectedContract?.tradable === true
  const tickSize = selectedContract?.filters?.price?.tickSize
  const stepSize = selectedContract?.filters?.quantity?.stepSize
  const minQuantity = selectedContract?.filters?.quantity?.min
  const maxQuantity = selectedContract?.filters?.quantity?.max
  const minNotionalUsdt = selectedContract?.filters?.minimumNotional
  // Only the selected contract's filters are loaded, so another symbol's rows
  // are cleaned of float noise but never rounded to a foreign tick.
  const tickOf = symbol => (symbol === selectedSymbol ? tickSize ?? null : null)
  const hasFilters = isExactPositiveDecimal(tickSize)
    && isExactPositiveDecimal(stepSize)
    && isExactPositiveDecimal(minQuantity)
    && isExactPositiveDecimal(maxQuantity)
    && isExactPositiveDecimal(minNotionalUsdt)

  const availableUsdt = typeof balances?.USDT?.available === 'string'
    ? balances.USDT.available
    : null
  const sizingBudget = availableUsdt !== null && isExactPositiveDecimal(availableUsdt)
    ? availableUsdt
    : null
  const sizingReady = balanceResource.status === 'ready'
    && sizingBudget !== null
    && hasFilters
  // Whole USDT only: a slider that reports 66030.478842815 makes the operator
  // read noise instead of a size.
  const rawNotionalUsdt = sizingReady
    ? customNotionalUsdt ?? calculateFuturesNotionalForPercent(sizingBudget, sizePercent) ?? ''
    : ''
  const notionalUsdt = quantizeFuturesNotionalUsdt(rawNotionalUsdt) ?? rawNotionalUsdt
  const displayedSizePercent = customNotionalUsdt === null
    ? sizePercent
    : calculateFuturesNotionalPercent(customNotionalUsdt, sizingBudget) ?? 0

  const deriveDraft = candidatePrice => deriveFuturesLimitOrderDraft({
    notionalUsdt,
    price: candidatePrice,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotionalUsdt,
    leverage: 1,
  })
  const orderDraft = deriveDraft(price)
  const amountWithinBudget = isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)

  const tradingPaused = safeState.tradingPaused === true
  const readinessInput = {
    startupReady: safeState.startupReady !== false,
    connected: safeState.connected === true,
    selectedContractTradable,
    hasFilters,
    tradingPaused,
    balanceResource,
    availableUsdt,
    notionalUsdt,
    maxOrderNotionalUsdt: safeState.maxOrderNotionalUsdt,
  }
  const readiness = deriveFuturesReadiness(readinessInput)
  const sizingControlsReady = sizingReady && deriveFuturesReadiness({
    ...readinessInput,
    exposureIncreasing: false,
  }).ready
  const deriveSubmissionReadiness = (action, draft) => deriveFuturesReadiness({
    ...readinessInput,
    draftRequired: true,
    draftValid: draft.ok,
    amountWithinBudget,
    exposureIncreasing: action.positionEffect === 'ENTRY',
  })
  const canSubmitAction = action => deriveSubmissionReadiness(action, orderDraft).ready

  const resolveSubmitBlockReason = (action, draft) => {
    if (!readiness.ready) return readiness.reason
    if (!sizingReady) return 'No confirmed available USDT balance to size the order.'
    // Sizing starts at zero, so an unsized draft is the ordinary case, not a
    // broken contract: say so instead of blaming the exchange filters.
    if (!isExactPositiveDecimal(notionalUsdt)) return 'Order size is 0 — choose a size first.'
    if (!draft.ok) return DRAFT_REASON_MESSAGES[draft.reason] ?? 'Order draft is invalid.'
    const submissionReadiness = deriveSubmissionReadiness(action, draft)
    if (!submissionReadiness.ready) return submissionReadiness.reason
    return SEND_FAILED_MESSAGE
  }

  const submitLimitOrder = (action, candidatePrice) => {
    const draft = deriveDraft(candidatePrice)
    const submissionReadiness = deriveSubmissionReadiness(action, draft)
    if (!submissionReadiness.ready || !draft.ok || typeof safeState.placeOrder !== 'function') {
      setFeedback({
        tone: 'ignored',
        title: `${action.label} NOT sent`,
        detail: resolveSubmitBlockReason(action, draft),
      })
      return false
    }
    const accepted = safeState.placeOrder({
      symbol: selectedSymbol,
      side: action.side,
      orderType: 'LIMIT',
      price: draft.price,
      quantity: draft.quantity,
      ...(action.positionEffect === 'EXIT' ? { reduceOnly: true } : {}),
    })
    setFeedback(accepted
      ? {
          tone: 'submitted',
          title: `${action.label} submitted`,
          detail: `LIMIT ${draft.quantity} @ ${draft.price}`,
        }
      : { tone: 'ignored', title: `${action.label} NOT sent`, detail: SEND_FAILED_MESSAGE })
    return accepted
  }

  // Readiness is re-derived by submitLimitOrder at this moment, not at the
  // moment the order was staged, so a balance or connection that lapsed while
  // the panel was open still blocks the send.
  const confirmPendingOrder = () => {
    if (!pendingOrder) return
    setPendingOrder(null)
    submitLimitOrder(pendingOrder.action, pendingOrder.price)
  }

  // Cancelling says so out loud: silence after a gesture is indistinguishable
  // from an order that was quietly sent.
  const cancelPendingOrder = () => {
    if (!pendingOrder) return
    setPendingOrder(null)
    setFeedback({
      tone: 'ignored',
      title: `${pendingOrder.action.label} cancelled`,
      detail: 'Nothing was sent to the exchange.',
    })
  }

  // A gesture prepares the order; it does not send it.
  //
  // Alt+right ("exit LONG") and Ctrl+right ("enter SHORT") are the same SELL at
  // the same price for the same size, so a slipped modifier produces an order
  // that looks exactly right while doing the opposite thing to the position.
  // The operator confirms the consequence instead, in a panel at the cursor.
  useEffect(() => {
    if (!gestureRequest || handledGestureRef.current === gestureRequest.id) return
    handledGestureRef.current = gestureRequest.id
    const action = ORDER_ACTIONS.find(candidate => (
      candidate.side === gestureRequest.side
      && candidate.positionSide === gestureRequest.positionSide
      && candidate.positionEffect === gestureRequest.positionEffect
    ))
    if (!action) return
    const candidatePrice = normalizeFuturesDraftPrice(gestureRequest.price, tickSize)
      ?? gestureRequest.price
    const draft = deriveDraft(candidatePrice)
    // An order that cannot be sent is refused here, not staged and then refused
    // on confirmation: the operator learns the reason while the price is fresh.
    if (!draft.ok || !deriveSubmissionReadiness(action, draft).ready) {
      setPendingOrder(null)
      setFeedback({
        tone: 'ignored',
        title: `${action.label} NOT sent`,
        detail: resolveSubmitBlockReason(action, draft),
      })
      return
    }
    setFeedback(null)
    setPendingOrder({
      action,
      symbol: selectedSymbol,
      price: draft.price,
      quantity: draft.quantity,
      notionalUsdt,
      anchor: gestureRequest.anchor ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureRequest])

  // Ctrl/Alt-dragging an order line reprices it through Binance's native
  // amendment — one call, so a rejection leaves the order exactly where it was.
  // Skipped while paused so a drag cannot touch the book at all.
  useEffect(() => {
    if (!orderAmendRequest || handledAmendmentRef.current === orderAmendRequest.id) return
    handledAmendmentRef.current = orderAmendRequest.id
    if (tradingPaused) {
      setFeedback({
        tone: 'ignored',
        title: 'Order move NOT applied',
        detail: 'Trading is paused — resume to move orders.',
      })
      return
    }
    if (typeof safeState.modifyOrder !== 'function') return
    const target = openOrders.find(order => (
      order.clientOrderId === orderAmendRequest.clientOrderId
      || String(order.orderId) === String(orderAmendRequest.orderId)
    ))
    if (!target) {
      setFeedback({
        tone: 'ignored',
        title: 'Order move NOT applied',
        detail: 'The dragged order is no longer open.',
      })
      return
    }
    const nextPrice = normalizeFuturesDraftPrice(orderAmendRequest.price, tickSize)
      ?? orderAmendRequest.price
    const remaining = Number(target.origQty) - Number(target.z ?? target.executedQty ?? 0)
    if (!Number.isFinite(remaining) || remaining <= 0) {
      setFeedback({
        tone: 'ignored',
        title: 'Order move NOT applied',
        detail: 'The dragged order has no remaining quantity.',
      })
      return
    }
    // A price-only drag still changes the notional, so the ceiling is checked
    // against the order the drag would leave working, not the one it replaces.
    const risk = evaluateFuturesOrderRisk({
      quantity: target.origQty,
      price: nextPrice,
      maxOrderNotionalUsdt: safeState.maxOrderNotionalUsdt,
      exposureIncreasing: target.reduceOnly !== true,
    })
    if (!risk.ok) {
      setFeedback({
        tone: 'ignored',
        title: 'Order move NOT applied',
        detail: risk.reason === 'ABOVE_ORDER_CAP'
          ? `Moved order would be ${risk.notionalUsdt} USDT, above the local ${risk.capUsdt} USDT limit.`
          : 'The moved order could not be valued, so the order limit could not be checked.',
      })
      return
    }
    const accepted = safeState.modifyOrder({
      symbol: target.symbol,
      side: target.side,
      orderId: target.orderId,
      origClientOrderId: target.orderId ? undefined : target.clientOrderId,
      price: nextPrice,
      quantity: target.origQty,
    })
    setFeedback(accepted
      ? {
          tone: 'submitted',
          title: 'Order move submitted',
          detail: `${target.symbol} ${target.side} → ${nextPrice}`,
        }
      : { tone: 'ignored', title: 'Order move NOT applied', detail: SEND_FAILED_MESSAGE })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderAmendRequest])

  // Sizing the ticket from an open position: the quantity comes from the dock,
  // the price from wherever the operator is working, so "the whole position"
  // means the whole position at the limit they are about to place.
  useEffect(() => {
    if (!sizeRequest || handledSizeRef.current === sizeRequest.id) return
    handledSizeRef.current = sizeRequest.id
    const priceNumber = Number(price)
    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      setFeedback({
        tone: 'ignored',
        title: 'Size NOT applied',
        detail: 'Pick a price first — the position is sized at the price you trade at.',
      })
      return
    }
    // Floored to whole USDT, so a full-position exit can never round up past
    // the position it is closing.
    const notional = quantizeFuturesNotionalUsdt((sizeRequest.quantity * priceNumber).toFixed(2))
    if (notional === null) {
      setFeedback({
        tone: 'ignored',
        title: 'Size NOT applied',
        detail: 'The position size could not be valued at this price.',
      })
      return
    }
    setCustomNotionalUsdt(notional)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeRequest])

  // Feedback and sizing belong to one symbol's trading session; a symbol change
  // clears both, so a size chosen for the previous contract cannot be inherited
  // by the next one and fired by a gesture.
  useEffect(() => {
    if (feedbackSymbolRef.current === selectedSymbol) return
    feedbackSymbolRef.current = selectedSymbol
    setFeedback(null)
    setSizePercent(0)
    setCustomNotionalUsdt(null)
    // An order staged for the previous contract must never be confirmable
    // against the new one.
    setPendingOrder(null)
  }, [selectedSymbol])

  // Recomputed on every render rather than frozen at staging time, so the
  // projected position keeps up with account updates that land while the
  // operator is still reading the panel.
  const pendingConfirmation = pendingOrder
    ? describeFuturesOrderConfirmation({
      action: pendingOrder.action,
      symbol: pendingOrder.symbol,
      price: pendingOrder.price,
      quantity: pendingOrder.quantity,
      notionalUsdt: pendingOrder.notionalUsdt,
      positions,
    })
    : null

  const gestureAction = ORDER_ACTIONS.find(candidate => (
    candidate.side === gestureRequest?.side
    && candidate.positionSide === gestureRequest?.positionSide
    && candidate.positionEffect === gestureRequest?.positionEffect
  )) ?? null
  const draftReason = orderDraft.ok
    ? (!amountWithinBudget && sizingReady ? 'Order size exceeds the available balance' : null)
    : (price ? DRAFT_REASON_MESSAGES[orderDraft.reason] ?? null : 'Pick a chart or order-book price')
  const selectedOpenOrders = openOrders.filter(order => order.symbol === selectedSymbol)
  const lastError = safeState.lastError ?? null
  const unresolvedCommand = safeState.unresolvedCommand ?? null
  const accountFailures = Object.entries(safeState.accountResources ?? {})
    .filter(([, resource]) => resource?.status === 'error' || resource?.status === 'stale')
  const orderResourceStates = ['regularOrders', 'algoOrders']
    .map(resource => safeState.accountResources?.[resource])
    .filter(Boolean)
  const orderSyncUnavailable = orderResourceStates.some(resource => (
    resource.status === 'error' && resource.lastSuccessfulAt == null
  ))
  const orderSyncPartial = orderResourceStates.some(resource => (
    resource.status === 'error' || resource.status === 'stale'
  ))
  // What the resting orders come to, summed from the same list the operator
  // reads them in and priced by the same helper as every row of it.
  //
  // Not the exchange's order margin: that is what the orders cost to hold, a
  // fraction of their value at leverage and nothing at all for reduce-only
  // exits, and it is not the number the operator is checking against their
  // orders. Until the orders have synchronized once there is no total to state,
  // on the same terms as the balance beside it — an empty list means nothing is
  // resting and reads as zero.
  const workingOrdersUsdt = orderSyncUnavailable ? null : totalOrderNotionalUsdt(openOrders)

  return (
    <aside className="futures-production-execution-ticket" aria-label="Futures trading ticket">
      {/* The market and the symbol are already stated by the identity bar and
          the market header; this rail only has to answer "can I trade now?". */}
      <header className="futures-production-execution-header">
        <div className="futures-production-readiness">
          <span className={`futures-production-live is-${readiness.tone}`}>{readiness.label}</span>
          {readiness.ready ? null : <small role="status">{readiness.reason}</small>}
        </div>
        <button
          type="button"
          className={`futures-production-pause-toggle${tradingPaused ? ' is-paused' : ''}`}
          disabled={safeState.connected !== true || typeof safeState.setTradingPaused !== 'function'}
          onClick={() => safeState.setTradingPaused?.(!tradingPaused)}
        >
          {tradingPaused ? 'Resume trading' : 'Pause trading'}
        </button>
      </header>

      {feedback ? (
        <div
          className={`futures-production-feedback is-${feedback.tone}`}
          role="status"
          aria-label="Futures gesture feedback"
        >
          <div>
            <strong>{feedback.title}</strong>
            <span>{feedback.detail}</span>
          </div>
          <button type="button" aria-label="Dismiss feedback" onClick={() => setFeedback(null)}>
            ×
          </button>
        </div>
      ) : null}

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
                  <strong>{`${displayedSizePercent}%`}</strong>
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
                disabled={!sizingControlsReady}
                style={{ '--futures-size-fill': `${displayedSizePercent}%` }}
                onChange={(event) => {
                  setCustomNotionalUsdt(null)
                  setSizePercent(Number(event.target.value))
                }}
              />
            </label>
            <div className="futures-production-size-anchors" aria-label="Order size anchors">
              {SIZE_ANCHORS.map(value => (
                <button
                  type="button"
                  key={value}
                  className={displayedSizePercent === value ? 'is-selected' : ''}
                  disabled={!sizingControlsReady}
                  onClick={() => {
                    setCustomNotionalUsdt(null)
                    setSizePercent(value)
                  }}
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
                disabled={!sizingControlsReady}
                value={notionalUsdt}
                onChange={event => setCustomNotionalUsdt(event.target.value)}
              />
            </label>
            <dl className="futures-production-order-summary">
              <div><dt>Price</dt><dd>{orderDraft.ok ? orderDraft.price : exactText(price)}</dd></div>
              <div><dt>Quantity</dt><dd>{orderDraft.ok ? orderDraft.quantity : '—'}</dd></div>
              {/* Six and seven figures: the cents never change a decision and
                  cost a glance on every read, so funds are stated whole. */}
              <div>
                <dt>Available</dt>
                <dd title={availableUsdt ?? undefined}>
                  {availableUsdt ? `${formatUsdtAmount(availableUsdt, 0)} USDT` : '—'}
                </dd>
              </div>
              <div>
                <dt>On order</dt>
                <dd title={workingOrdersUsdt === null
                  ? undefined
                  : `${formatUsdtAmount(workingOrdersUsdt)} USDT across ${openOrders.length} working order${openOrders.length === 1 ? '' : 's'}`}
                >
                  {workingOrdersUsdt === null
                    ? '—'
                    : `${formatUsdtAmount(workingOrdersUsdt, 0)} USDT`}
                </dd>
              </div>
            </dl>
            {draftReason ? <p className="futures-production-draft-reason" role="status">{draftReason}</p> : null}
            <div className="futures-production-manual-actions" aria-label="Manual Futures orders">
              {ORDER_ACTIONS.map(action => (
                <button
                  type="button"
                  key={action.key}
                  className={`is-${action.positionSide.toLowerCase()} is-${action.positionEffect.toLowerCase()}`}
                  disabled={!canSubmitAction(action)}
                  onClick={() => submitLimitOrder(action, price)}
                >
                  {action.label}
                </button>
              ))}
            </div>
            <div className="futures-production-shortcuts" aria-label="Futures mouse shortcuts">
              <span><kbd>Alt</kbd><b>×2 left</b><em>LONG entry</em></span>
              <span><kbd>Alt</kbd><b>×2 right</b><em>LONG exit</em></span>
              <span><kbd>Ctrl</kbd><b>×2 right</b><em>SHORT entry</em></span>
              <span><kbd>Ctrl</kbd><b>×2 left</b><em>SHORT exit</em></span>
              <small>Ctrl/Alt + drag an order line to move it</small>
            </div>
          </section>
        ) : tab === 'orders' ? (
          <section className="futures-production-orders" role="tabpanel" aria-label="Current Futures orders">
            <header className="futures-production-portfolio-heading">
              <div>
                <strong>Open orders</strong>
                <span>{openOrders.length} account-wide · {selectedOpenOrders.length} {selectedSymbol}</span>
              </div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            {orderSyncUnavailable ? (
              <p role="alert">Open orders unavailable — synchronization has not completed successfully.</p>
            ) : orderSyncPartial ? (
              <p role="status">Open orders are partially synchronized; last confirmed data remains visible.</p>
            ) : null}
            {openOrders.length === 0 && !orderSyncUnavailable
              ? <p>No active Futures orders.</p>
              : (
                <div className="futures-production-order-rows" role="table" aria-label="Working orders">
                  {/* The columns are named once at the head instead of every row
                      carrying its own unit: six rows of `10983 USDT` in a rail
                      this narrow is six repetitions of one word, and the word is
                      what pushed the value into the cancel control. */}
                  <div className="futures-production-order-head" role="row">
                    <span role="columnheader">Symbol</span>
                    <span role="columnheader">Side</span>
                    <span role="columnheader">Price</span>
                    <span role="columnheader" title="What the order is worth, in USDT">USDT</span>
                    <span role="columnheader" />
                  </div>
                  {openOrders.map((order) => {
                    const intent = describeFuturesOrderIntent(order)
                    const isAlgo = order.orderKind === 'ALGO'
                    return (
                      <div
                        className={`futures-production-order-row is-${intent.tone}${order.symbol === selectedSymbol ? ' is-current-symbol' : ''}`}
                        role="row"
                        key={`${order.orderKind ?? 'REGULAR'}:${order.symbol}:${order.orderId}`}
                        onDoubleClick={event => (isAlgo ? undefined : onOrderEdit?.(order, {
                          x: event.clientX,
                          y: event.clientY,
                        }))}
                      >
                        <span role="cell"><strong title={order.symbol}>{contractLabel(order.symbol)}</strong></span>
                        <span role="cell">
                          <span className={`futures-production-side is-${intent.tone}`}>
                            {intent.label}
                          </span>
                        </span>
                        <span role="cell">
                          <code>{orderPriceText(order, tickOf(order.symbol))}</code>
                        </span>
                        <span role="cell" title={orderSizeTitle(order)}>
                          <b>{orderNotionalUsdt(order) ?? '—'}</b>
                        </span>
                        <span role="cell">
                          {isAlgo ? (
                            <em title="Managed on Binance">ALGO</em>
                          ) : (
                            <button
                              type="button"
                              className="futures-production-order-cancel"
                              aria-label={`Cancel ${order.symbol} ${intent.side} order at ${order.price}`}
                              title="Cancel order"
                              onClick={() => safeState.cancelOrder?.({
                                symbol: order.symbol,
                                orderId: order.orderId,
                              })}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            {openOrders.length > 0 ? (
              <p className="futures-production-order-hint">
                Double-click a row or its chart line to change price and amount.
              </p>
            ) : null}
            {selectedOpenOrders.length > 0 ? (
              <button
                type="button"
                className="futures-production-cancel-all"
                onClick={() => safeState.cancelAll?.(selectedSymbol)}
              >
                Cancel all {selectedSymbol}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="futures-production-positions" role="tabpanel" aria-label="Open positions">
            <header className="futures-production-portfolio-heading">
              <div><strong>Positions</strong><span>{positions.length} open</span></div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            {positions.length === 0
              ? <p>No open positions.</p>
              : positions.map((position) => {
                const presentation = describeFuturesPosition(position)
                return (
                <article
                  className={`is-${presentation.tone}`}
                  key={`${position.symbol}:${position.positionSide}`}
                >
                  <header>
                    <strong>{position.symbol}</strong>
                    <span className={`futures-production-side is-${presentation.tone}`}>
                      {presentation.positionSide}
                    </span>
                  </header>
                  <div className={`futures-production-position-pnl is-${presentation.pnlTone}`}>
                    <strong>{formatSignedUsdt(presentation.unrealizedPnl)} USDT</strong>
                    <em>{formatSignedPercent(presentation.roePercent)}</em>
                  </div>
                  <dl>
                    <div><dt>Qty</dt><dd>{exactText(position.quantity)}</dd></div>
                    <div>
                      <dt>Entry</dt>
                      <dd>{formatExchangePrice(position.entryPrice, tickOf(position.symbol))}</dd>
                    </div>
                    <div>
                      <dt>Mark</dt>
                      <dd>{formatExchangePrice(position.markPrice, tickOf(position.symbol))}</dd>
                    </div>
                    <div>
                      <dt>Liq.</dt>
                      <dd>{formatExchangePrice(position.liquidationPrice, tickOf(position.symbol))}</dd>
                    </div>
                  </dl>
                  <div>
                    <button
                      type="button"
                      onClick={event => onPositionClose?.(position, {
                        x: event.clientX,
                        y: event.clientY,
                      })}
                    >
                      Close position
                    </button>
                  </div>
                </article>
                )
              })}
          </section>
        )}

        {/* An unconfirmed submission outranks every other status: the order may
            be live, and nothing else on this card is more urgent to read. It
            carries no control at all — a retry here is what creates the second
            order. */}
        {unresolvedCommand ? (
          <section
            className="futures-production-backend-card is-unresolved"
            role="alert"
            aria-label="Futures command outcome unconfirmed"
          >
            <strong>{unresolvedCommand.code}</strong>
            <code>{unresolvedCommand.message}</code>
          </section>
        ) : accountFailures.length > 0 ? (
          <section className="futures-production-backend-card is-rejected" aria-label="Futures account synchronization errors">
            {accountFailures.map(([resourceName, resource]) => (
              <div key={`${resourceName}:${resource.error?.code ?? resource.status}`}>
                <strong>{resourceName} · {resource.status}</strong>
                <code>{resource.error?.message ?? 'Synchronization failed.'}</code>
              </div>
            ))}
            <button type="button" onClick={() => safeState.refresh?.(selectedSymbol)}>
              Retry account sync
            </button>
          </section>
        ) : lastError ? (
          <section className="futures-production-backend-card is-rejected" aria-label="Futures command rejection">
            <strong>{lastError.code}</strong>
            <code>{lastError.message}</code>
          </section>
        ) : safeState.lastExecution ? (
          <section className="futures-production-backend-card is-ack" aria-label="Last Futures execution">
            <strong>
              {safeState.lastExecution.symbol} {safeState.lastExecution.side}
              {' · '}
              {safeState.lastExecution.status}
            </strong>
            <code>
              {safeState.lastExecution.type ?? 'LIMIT'} {safeState.lastExecution.origQty}
              {safeState.lastExecution.price && safeState.lastExecution.price !== '0'
                ? ` @ ${safeState.lastExecution.price}`
                : ''}
            </code>
          </section>
        ) : null}
      </div>
      {pendingConfirmation ? (
        <FuturesOrderConfirmation
          confirmation={pendingConfirmation}
          anchor={pendingOrder.anchor}
          onConfirm={confirmPendingOrder}
          onCancel={cancelPendingOrder}
        />
      ) : null}
    </aside>
  )
}

export default memo(FuturesTradingTicket)
