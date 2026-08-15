import { useMemo, useState } from 'react'
import {
  calculateFuturesExitBudget,
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  evaluateFuturesLimitSubmission,
  normalizeFuturesDraftPrice,
  quantizeFuturesNotionalUsdt,
} from '../../../utils/futuresOrderDraft.js'
import {
  describeFuturesOrderIntent,
  orderNotionalUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 250

const DRAFT_REASONS = Object.freeze({
  INVALID_DRAFT_INPUT: 'Enter a price and an amount.',
  BELOW_MINIMUM_QUANTITY: 'Amount is below the exchange minimum quantity.',
  ABOVE_MAXIMUM_QUANTITY: 'Amount is above the exchange maximum quantity.',
  BELOW_MINIMUM_NOTIONAL: 'Amount is below the exchange minimum notional.',
})

// Double-clicking an order opens this panel over the chart. It is deliberately
// modeless and draggable: the trader keeps watching price while retyping the
// order, and clicking anywhere outside dismisses it without touching the order.
export const FuturesOrderEditor = ({
  order,
  contract = null,
  maxOrderNotionalUsdt = null,
  availableUsdt = null,
  positionQuantity = null,
  anchor,
  onSubmit,
  onCancelOrder,
  onClose,
}) => {
  const intent = describeFuturesOrderIntent(order)
  const filters = contract?.filters ?? null
  const [price, setPrice] = useState(() => String(order.price ?? ''))
  const [notional, setNotional] = useState(() => orderNotionalUsdt(order) ?? '')
  // Holds what did not happen, not merely that something did not: "not changed"
  // and "not cancelled" are different facts about a live order.
  const [unsent, setUnsent] = useState(null)
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose,
  })

  const sizingMaximumUsdt = useMemo(() => {
    if (intent.positionEffect === 'ENTRY') return availableUsdt
    const rawQuantity = typeof positionQuantity === 'string'
      ? positionQuantity
      : Number.isFinite(positionQuantity) ? String(positionQuantity) : null
    if (rawQuantity === null || !filters) return null
    return calculateFuturesExitBudget({
      positionQuantity: rawQuantity.replace(/^[+-]/, ''),
      price,
      tickSize: filters.price?.tickSize,
    })
  }, [availableUsdt, filters, intent.positionEffect, positionQuantity, price])
  const sizingEnabled = calculateFuturesNotionalForPercent(sizingMaximumUsdt, 0) !== null
  const sizingPercent = sizingEnabled
    ? calculateFuturesNotionalPercent(notional, sizingMaximumUsdt)
    : null

  // An amendment can raise exposure just as a new order can — the audit's case
  // was exactly this panel growing a 160 USDT order to 10 000. It is measured
  // against the notional it *will* have, and only a reduce-only order is exempt.
  const draft = useMemo(() => {
    if (!filters) return { ok: false, reason: 'INVALID_DRAFT_INPUT' }
    return evaluateFuturesLimitSubmission({
      notionalUsdt: quantizeFuturesNotionalUsdt(notional) ?? notional,
      price: normalizeFuturesDraftPrice(price, filters.price?.tickSize) ?? price,
      tickSize: filters.price?.tickSize,
      stepSize: filters.quantity?.stepSize,
      minQuantity: filters.quantity?.min,
      maxQuantity: filters.quantity?.max,
      minNotionalUsdt: filters.minimumNotional,
      leverage: 1,
      maxOrderNotionalUsdt,
      // Asked of the intent rather than of `reduceOnly`: a close-position order
      // carries `reduceOnly` false and can still only take exposure off.
      exposureIncreasing: !intent.reducesPosition,
    })
  }, [filters, intent.reducesPosition, maxOrderNotionalUsdt, notional, price])

  const refusal = draft.ok
    ? null
    : draft.reason === 'ABOVE_ORDER_CAP'
      ? `${draft.notionalUsdt} USDT is above the local ${draft.capUsdt} USDT order limit.`
      : draft.reason === 'UNPRICEABLE_ORDER'
        ? 'This amendment cannot be valued, so the order limit cannot be checked.'
        : DRAFT_REASONS[draft.reason] ?? 'Order draft is invalid.'

  // A panel that closes is this desk's way of saying "done". It may only say it
  // when the command actually left the renderer: a closed socket used to close
  // the panel exactly as a delivered amendment did, and the operator read the
  // one as the other.
  const submit = (event) => {
    event.preventDefault()
    if (!draft.ok) return
    const sent = onSubmit?.({
      symbol: order.symbol,
      side: intent.side,
      orderId: order.orderId,
      origClientOrderId: order.orderId ? undefined : order.clientOrderId,
      price: draft.price,
      quantity: draft.quantity,
    })
    if (sent === false) {
      setUnsent('Local backend connection unavailable — the order was not changed.')
      return
    }
    onClose?.()
  }

  return (
    <form
      className={`futures-order-editor is-${intent.tone}`}
      ref={panelRef}
      style={style}
      aria-label={`Edit ${order.symbol} ${intent.side} order`}
      onSubmit={submit}
    >
      <header className="futures-order-editor-handle" {...handleProps}>
        <strong>{order.symbol}</strong>
        <span className={`futures-order-editor-side is-${intent.tone}`}>
          {intent.side} {intent.label}
        </span>
        <button type="button" aria-label="Close order editor" onClick={() => onClose?.()}>×</button>
      </header>

      <label>
        <span>Price</span>
        <input
          aria-label="Order price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => { setUnsent(null); setPrice(event.target.value) }}
        />
      </label>
      <label>
        <span>Amount, USDT</span>
        <input
          aria-label="Order amount in USDT"
          type="text"
          inputMode="decimal"
          value={notional}
          onChange={(event) => { setUnsent(null); setNotional(event.target.value) }}
        />
      </label>
      <label className="futures-production-size-slider futures-editor-slider">
        <span>
          <span>Size</span>
          <span className="futures-editor-slider-value" aria-live="polite">
            <strong>{sizingPercent === null ? '—' : `${sizingPercent}%`}</strong>
            <b>{intent.positionEffect === 'EXIT' ? 'of position' : 'of available'}</b>
          </span>
        </span>
        <input
          aria-label="Working order size percent"
          type="range"
          min="0"
          max="100"
          step="0.5"
          value={sizingPercent ?? 0}
          disabled={!sizingEnabled}
          style={{ '--futures-size-fill': `${sizingPercent ?? 0}%` }}
          onChange={(event) => {
            const sizedNotional = calculateFuturesNotionalForPercent(
              sizingMaximumUsdt,
              Number(event.target.value),
            )
            if (sizedNotional === null) return
            setUnsent(null)
            setNotional(sizedNotional)
          }}
        />
      </label>

      <dl className="futures-order-editor-summary">
        <div><dt>Quantity</dt><dd>{draft.ok ? draft.quantity : '—'}</dd></div>
        <div><dt>Filled</dt><dd>{order.z ?? '0'}</dd></div>
      </dl>
      {unsent ? (
        <p role="status" className="is-unsent">{unsent}</p>
      ) : draft.ok ? null : (
        <p role="status">
          {filters
            ? refusal
            : `Open ${order.symbol} to edit this order — its exchange filters are not loaded.`}
        </p>
      )}

      <div className="futures-order-editor-actions">
        <button type="submit" className="is-apply" disabled={!draft.ok}>Apply</button>
        <button
          type="button"
          className="is-cancel-order"
          onClick={() => {
            const sent = onCancelOrder?.({ symbol: order.symbol, orderId: order.orderId })
            if (sent === false) {
              setUnsent('Local backend connection unavailable — the order was not cancelled.')
              return
            }
            onClose?.()
          }}
        >
          Cancel order
        </button>
      </div>
    </form>
  )
}

export default FuturesOrderEditor
