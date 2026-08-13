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
// More than one at a time is the point: the desk can owe an order for two
// drags at once, and one statement that could only name one of them was the
// reason the second drag used to be refused outright.
const EMPTY_ALERTS = Object.freeze([])

export const FuturesOrderDragAlert = ({
  alerts = EMPTY_ALERTS,
  busy = false,
  onRetry,
  onDismiss,
}) => {
  if (alerts.length === 0) return null
  return (
    <div className="futures-order-drag-alerts">
      {alerts.map((alert) => {
        const retryPrice = alert.retryPrice ?? null
        return (
          <section
            key={alert.id}
            className={`futures-order-drag-alert is-${alert.tone}`}
            role="alert"
            aria-label={alert.order?.symbol
              ? `Futures order drag outcome for ${alert.order.symbol}`
              : 'Futures order drag outcome'}
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
                  onClick={() => onRetry?.(alert.id)}
                >
                  {busy ? 'Placing…' : `Place it again at ${retryPrice}`}
                </button>
              )}
              <button
                type="button"
                className="futures-order-drag-alert-dismiss"
                aria-label={alert.order?.symbol
                  ? `Dismiss drag outcome for ${alert.order.symbol}`
                  : 'Dismiss drag outcome'}
                onClick={() => onDismiss?.(alert.id)}
              >
                ×
              </button>
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default memo(FuturesOrderDragAlert)
