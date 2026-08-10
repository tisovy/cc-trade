import { useEffect, useRef } from 'react'
import { formatUsdtAmount } from '../../../utils/futuresPriceFormat.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 236

// The last thing an operator sees before real money moves.
//
// Two of the four shortcuts produce an identical SELL — Alt+right closes a long,
// Ctrl+right opens a short — so this panel never leads with the side. It leads
// with what the order does to the position, because that is the only part a
// slipped modifier changes. It opens at the cursor, is dragged by its header,
// and a click anywhere outside it cancels: nothing is sent by walking away.
export const FuturesOrderConfirmation = ({
  confirmation,
  anchor,
  onConfirm,
  onCancel,
}) => {
  const confirmButtonRef = useRef(null)
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose: onCancel,
    minHeight: 190,
  })

  // Focus lands on the send button, so Enter releases the order and Escape
  // abandons it without the operator reaching for the mouse at all.
  useEffect(() => {
    confirmButtonRef.current?.focus?.()
  }, [])

  if (!confirmation) return null

  const positionLine = confirmation.positionBeforeUsdt === null
    || confirmation.positionAfterUsdt === null
    ? '—'
    : `${formatUsdtAmount(confirmation.positionBeforeUsdt, 0)} → ${formatUsdtAmount(confirmation.positionAfterUsdt, 0)}`

  return (
    <div
      className={`futures-order-editor futures-order-confirm is-${confirmation.tone}`}
      ref={panelRef}
      style={style}
      role="alertdialog"
      aria-label={`Confirm ${confirmation.headline} on ${confirmation.symbol}`}
    >
      <header className="futures-order-editor-handle" {...handleProps}>
        <strong>{confirmation.symbol}</strong>
        <button type="button" aria-label="Cancel order" onClick={() => onCancel?.()}>×</button>
      </header>

      <strong className={`futures-order-confirm-headline is-${confirmation.tone}`}>
        {confirmation.headline}
      </strong>

      {/* The terms, beside the direction and at the same weight. An operator
          who sizes in USDT never has to think in multiples, which is how an
          entry gets carried at a leverage nobody chose — so the multiple is
          stated here, in the yellow this desk reserves for liquidation, in the
          last second before the order goes. It is a reading and not a control:
          nothing on the panel that sends an order also changes its terms. */}
      <strong
        className="futures-order-confirm-leverage"
        title={confirmation.leverage === null
          ? 'The exchange has not reported the leverage of this contract'
          : `This position will be carried at ${confirmation.leverage}× leverage`}
      >
        {confirmation.leverage === null ? 'LEV ?' : `${confirmation.leverage}×`}
      </strong>

      <dl className="futures-order-editor-summary">
        <div><dt>Price</dt><dd>{confirmation.price}</dd></div>
        <div>
          <dt>Size</dt>
          <dd title={`${confirmation.quantity} contracts`}>
            {confirmation.notionalUsdt ? `${confirmation.notionalUsdt} USDT` : '—'}
          </dd>
        </div>
        <div><dt>Position</dt><dd>{positionLine}</dd></div>
      </dl>

      {confirmation.warning ? (
        <p className="futures-order-confirm-warning" role="alert">{confirmation.warning.message}</p>
      ) : null}

      <div className="futures-order-editor-actions">
        <button type="button" className="is-apply" ref={confirmButtonRef} onClick={() => onConfirm?.()}>
          Send · Enter
        </button>
        <button type="button" onClick={() => onCancel?.()}>Cancel · Esc</button>
      </div>
    </div>
  )
}

export default FuturesOrderConfirmation
