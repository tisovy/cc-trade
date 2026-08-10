import { useMemo, useState } from 'react'
import {
  calculateFuturesCloseQuantityForPercent,
  deriveFuturesCloseQuantity,
  normalizeFuturesDraftPrice,
} from '../../../utils/futuresOrderDraft.js'
import { describeFuturesPosition } from '../../../utils/futuresOrderPresentation.js'
import { formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 262
const CLOSE_ANCHORS = Object.freeze([25, 50, 75, 100])

const CLOSE_REASONS = Object.freeze({
  INVALID_CLOSE_QUANTITY: 'Enter the size to close.',
  ABOVE_OPEN_QUANTITY: 'Size is larger than the open position.',
  BELOW_LOT_STEP: 'Size is below the contract lot step.',
})

// Exiting is a decision with two shapes: out now at whatever the book pays, or
// out at a level. Both live in one panel so the choice costs one click, and the
// side is derived from the position rather than typed by the operator.
export const FuturesPositionCloser = ({
  position,
  contract = null,
  anchor,
  onCloseMarket,
  onCloseLimit,
  onClose,
}) => {
  const presentation = describeFuturesPosition(position)
  const filters = contract?.filters ?? null
  const tickSize = filters?.price?.tickSize ?? null
  const stepSize = filters?.quantity?.stepSize ?? null
  const openQuantity = presentation.absoluteQuantity === null
    ? ''
    : String(presentation.absoluteQuantity)
  const [orderType, setOrderType] = useState('MARKET')
  const [price, setPrice] = useState(() => (
    formatExchangePrice(position?.markPrice, tickSize, '')
  ))
  const [quantity, setQuantity] = useState(openQuantity)
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose,
  })

  // Reducing a LONG means selling it back, and vice versa.
  const side = presentation.positionSide === 'LONG' ? 'SELL' : 'BUY'
  const draft = useMemo(() => deriveFuturesCloseQuantity({
    quantity,
    openQuantity,
    stepSize,
  }), [openQuantity, quantity, stepSize])
  const normalizedPrice = normalizeFuturesDraftPrice(price, tickSize) ?? price
  const priceUsable = orderType === 'MARKET'
    || (typeof normalizedPrice === 'string' && Number(normalizedPrice) > 0)
  const canSubmit = draft.ok && priceUsable

  const applyPercent = (percent) => {
    const next = calculateFuturesCloseQuantityForPercent({ openQuantity, percent, stepSize })
    if (next !== null) setQuantity(next)
  }

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    if (orderType === 'MARKET') {
      // The position keeps its signed quantity: the side of the exit is read
      // from it, never from the size the operator typed.
      onCloseMarket?.(position, { quantity: draft.quantity })
    } else {
      onCloseLimit?.({
        symbol: position.symbol,
        side,
        price: normalizedPrice,
        quantity: draft.quantity,
      })
    }
    onClose?.()
  }

  return (
    <form
      className={`futures-order-editor is-${presentation.tone}`}
      ref={panelRef}
      style={style}
      aria-label={`Close ${position.symbol} ${presentation.positionSide} position`}
      onSubmit={submit}
    >
      <header className="futures-order-editor-handle" {...handleProps}>
        <strong>{position.symbol}</strong>
        <span className={`futures-order-editor-side is-${presentation.tone}`}>
          CLOSE {presentation.positionSide}
        </span>
        <button type="button" aria-label="Close position panel" onClick={() => onClose?.()}>×</button>
      </header>

      <div className="futures-order-editor-modes" role="group" aria-label="Close order type">
        <button
          type="button"
          className={orderType === 'MARKET' ? 'is-selected' : ''}
          aria-pressed={orderType === 'MARKET'}
          onClick={() => setOrderType('MARKET')}
        >
          Market
        </button>
        <button
          type="button"
          className={orderType === 'LIMIT' ? 'is-selected' : ''}
          aria-pressed={orderType === 'LIMIT'}
          onClick={() => setOrderType('LIMIT')}
        >
          Limit
        </button>
      </div>

      {orderType === 'LIMIT' ? (
        <label>
          <span>Close price</span>
          <input
            aria-label="Close price"
            type="text"
            inputMode="decimal"
            value={price}
            onChange={event => setPrice(event.target.value)}
          />
        </label>
      ) : null}

      <label>
        <span>Size, {position.symbol.replace(/USDT$/, '') || 'contracts'}</span>
        <input
          aria-label="Close size"
          type="text"
          inputMode="decimal"
          value={quantity}
          onChange={event => setQuantity(event.target.value)}
        />
      </label>
      <div className="futures-order-editor-anchors" aria-label="Close size anchors">
        {CLOSE_ANCHORS.map(percent => (
          <button type="button" key={percent} onClick={() => applyPercent(percent)}>
            {percent}%
          </button>
        ))}
      </div>

      <dl className="futures-order-editor-summary">
        <div><dt>Open</dt><dd>{openQuantity || '—'}</dd></div>
        <div><dt>Side</dt><dd>{side} · reduce-only</dd></div>
      </dl>
      {canSubmit ? null : (
        <p role="status">
          {draft.ok ? 'Enter a close price.' : CLOSE_REASONS[draft.reason] ?? 'Close size is invalid.'}
        </p>
      )}

      <div className="futures-order-editor-actions">
        <button type="submit" className="is-apply" disabled={!canSubmit}>
          {orderType === 'MARKET' ? 'Close at market' : 'Place close limit'}
        </button>
      </div>
    </form>
  )
}

export default FuturesPositionCloser
