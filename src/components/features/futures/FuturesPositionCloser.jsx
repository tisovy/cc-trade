import { useMemo, useState } from 'react'
import {
  calculateFuturesClosePercent,
  calculateFuturesCloseQuantityForPercent,
  deriveFuturesCloseQuantity,
  normalizeFuturesDraftPrice,
  remainingFuturesQuantity,
} from '../../../utils/futuresOrderDraft.js'
import {
  describeFuturesCloseOutcome,
  describeFuturesPosition,
  formatSignedUsdt,
  formatUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import { formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 262

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
  const rawQuantity = position?.quantity
  const exactOpenQuantity = presentation.absoluteQuantity === null
    ? ''
    : typeof rawQuantity === 'string'
      ? rawQuantity.replace(/^-/, '')
      : String(presentation.absoluteQuantity)
  // Keep the exchange decimal exact for validation, but retain the compact
  // field presentation the panel already had (`0.500` opens as `0.5`).
  const openQuantity = exactOpenQuantity.includes('.')
    ? exactOpenQuantity.replace(/0+$/, '').replace(/\.$/, '')
    : exactOpenQuantity
  const [orderType, setOrderType] = useState('MARKET')
  const [price, setPrice] = useState(() => (
    formatExchangePrice(position?.markPrice, tickSize, '')
  ))
  const [quantity, setQuantity] = useState(openQuantity)
  const [unsent, setUnsent] = useState(null)
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

  // A slider where four percentage buttons used to be. Closing is a decision
  // about how much, and the answer is rarely a quarter: the buttons could only
  // offer four of the hundred sizes the position can be cut to, and each one cost
  // a click to find out it was the wrong one. The slider still works in percent,
  // so every stop it lands on is floored to the contract's lot step exactly as
  // the buttons were, and the exact size stays typeable beside it.
  const closePercent = calculateFuturesClosePercent({ openQuantity, quantity })
  const applyPercent = (percent) => {
    // Dragged to the far left the panel holds no size rather than a size of zero,
    // so the status line asks for one instead of the exchange refusing it.
    if (!Number.isSafeInteger(percent) || percent <= 0) {
      setQuantity('')
      return
    }
    const next = calculateFuturesCloseQuantityForPercent({ openQuantity, percent, stepSize })
    if (next !== null) setQuantity(next)
  }

  // What the exit would actually do, which is what the panel used to spend two
  // cells not saying: the size left behind, the money coming off the table, and
  // the profit that comes with it. A market exit follows the position surface's
  // resolved live valuation (with the exchange mark as a compatibility
  // fallback); a limit stays at the operator's normalized draft price.
  const valuationPrice = Number(position?.valuationPrice)
  const marketPrice = Number.isFinite(valuationPrice) && valuationPrice > 0
    ? position.valuationPrice
    : position?.markPrice
  const exitPrice = orderType === 'MARKET' ? marketPrice : normalizedPrice
  const outcome = describeFuturesCloseOutcome({
    positionSide: presentation.positionSide,
    entryPrice: position?.entryPrice,
    quantity: draft.ok ? draft.quantity : null,
    exitPrice,
  })
  const leaves = draft.ok
    ? remainingFuturesQuantity({ openQuantity, quantity: draft.quantity })
    : null
  const pnlTone = outcome.realizedPnl === null || outcome.realizedPnl === 0
    ? 'flat'
    : outcome.realizedPnl > 0 ? 'positive' : 'negative'

  // Closing is the command an operator most needs to be sure about, so the panel
  // stays open when it could not be sent: a panel that vanished on a dead socket
  // read exactly like a position that had been closed.
  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    const sent = orderType === 'MARKET'
      // The position keeps its signed quantity: the side of the exit is read
      // from it, never from the size the operator typed.
      ? onCloseMarket?.(position, { quantity: draft.quantity })
      : onCloseLimit?.({
        symbol: position.symbol,
        side,
        price: normalizedPrice,
        quantity: draft.quantity,
      })
    if (sent === false) {
      setUnsent('Local backend connection unavailable — the position was not closed.')
      return
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

      {/* The side is stated where it is worth knowing: a limit close rests on one
          book or the other, and the level is read against it. On a market exit it
          is only a restatement of the header, and it sat in the summary saying
          nothing. Both exits stay reduce-only — a close can never open the
          opposite position — which the apply button carries. */}
      {orderType === 'LIMIT' ? (
        <label>
          <span>Close price · {side} reduce-only</span>
          <input
            aria-label="Close price"
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => { setUnsent(null); setPrice(event.target.value) }}
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
          onChange={(event) => { setUnsent(null); setQuantity(event.target.value) }}
        />
      </label>

      <label className="futures-production-size-slider futures-editor-slider">
        <span>
          <span>Close</span>
          {/* Not an `output`: that element carries the status role, and the line
              that states why a close is refused must stay the only status here. */}
          <span className="futures-editor-slider-value" aria-live="polite">
            <strong>{closePercent === null ? '—' : `${closePercent}%`}</strong>
            <b>of {openQuantity || '—'}</b>
          </span>
        </span>
        <input
          aria-label="Close size, percent of the position"
          type="range"
          min="0"
          max="100"
          step="1"
          value={closePercent ?? 0}
          style={{ '--futures-size-fill': `${closePercent ?? 0}%` }}
          onChange={event => applyPercent(Number(event.target.value))}
        />
      </label>

      <dl className="futures-order-editor-summary">
        <div><dt>Open</dt><dd>{openQuantity || '—'}</dd></div>
        <div>
          <dt title="What the position would still hold once this close fills.">Leaves</dt>
          <dd>{leaves ?? '—'}</dd>
        </div>
        <div>
          <dt title="The size being closed, valued at the close price.">Value, USDT</dt>
          <dd>{formatUsdt(outcome.notional)}</dd>
        </div>
        <div>
          <dt title="What this size would realize at the close price. Fees are not in it, and a market exit pays whatever the book pays.">
            Est. PnL
          </dt>
          <dd className={`is-${pnlTone}`}>{formatSignedUsdt(outcome.realizedPnl)}</dd>
        </div>
      </dl>
      {unsent ? (
        <p role="status" className="is-unsent">{unsent}</p>
      ) : canSubmit ? null : (
        <p role="status">
          {draft.ok ? 'Enter a close price.' : CLOSE_REASONS[draft.reason] ?? 'Close size is invalid.'}
        </p>
      )}

      <div className="futures-order-editor-actions">
        <button
          type="submit"
          className="is-apply"
          title={`${side} ${draft.ok ? draft.quantity : openQuantity} · reduce-only`}
          disabled={!canSubmit}
        >
          {orderType === 'MARKET' ? 'Close at market' : 'Place close limit'}
        </button>
      </div>
    </form>
  )
}

export default FuturesPositionCloser
