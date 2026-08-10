import { memo } from 'react'

// The one thing an operator must not be able to miss.
//
// A drag lifts an order off the book by cancelling it. Almost always the
// replacement lands and there is nothing to say. When it does not — the local
// ceiling refuses it, the exchange refuses it, or Binance never answers — the
// desk owes an order that no longer exists, and saying so in a log or in a
// corner of the rail is the same as not saying it.
//
// So it is stated over the workspace, it names the order, and it carries the
// control that places it again — except after silence, where a second attempt
// is exactly what could leave two orders resting.
export const FuturesOrderDragAlert = ({
  alert = null,
  busy = false,
  onRetry,
  onDismiss,
}) => {
  if (alert === null) return null
  const retryPrice = alert.retryPrice ?? null
  return (
    <section
      className={`futures-order-drag-alert is-${alert.tone}`}
      role="alert"
      aria-label="Futures order drag outcome"
    >
      <div className="futures-order-drag-alert-body">
        <strong>{alert.title}</strong>
        <span>{alert.detail}</span>
      </div>
      <div className="futures-order-drag-alert-actions">
        {retryPrice === null ? null : (
          <button
            type="button"
            className="futures-order-drag-alert-retry"
            disabled={busy || typeof onRetry !== 'function'}
            onClick={() => onRetry?.()}
          >
            {busy ? 'Placing…' : `Place it again at ${retryPrice}`}
          </button>
        )}
        <button
          type="button"
          className="futures-order-drag-alert-dismiss"
          aria-label="Dismiss drag outcome"
          onClick={() => onDismiss?.()}
        >
          ×
        </button>
      </div>
    </section>
  )
}

export default memo(FuturesOrderDragAlert)
