import { useMemo, useState } from 'react'
import {
  describeFuturesPosition,
  describeFuturesPositionMargin,
  formatUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 250

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Margin is money that is already the operator's — moving it in or out changes
// no exposure, only the distance to liquidation. So this panel refuses nothing
// on policy: the two bounds below are facts (you cannot spend what the wallet
// does not hold, or withdraw what the position does not hold), and Binance
// remains the authority on the exact removable amount, which is smaller than
// the committed margin by the maintenance requirement.
export const FuturesPositionMarginEditor = ({
  position,
  availableUsdt = null,
  anchor,
  onSubmit,
  onClose,
}) => {
  const presentation = describeFuturesPosition(position)
  const marginState = describeFuturesPositionMargin(position)
  const [direction, setDirection] = useState('ADD')
  const [amount, setAmount] = useState('')
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose,
  })

  const available = toFiniteNumber(availableUsdt)
  const draft = useMemo(() => {
    if (!marginState.adjustable) {
      return {
        ok: false,
        reason: marginState.marginMode === 'CROSS' ? 'CROSS_MARGIN' : 'MARGIN_UNKNOWN',
      }
    }
    const requested = toFiniteNumber(amount)
    if (requested === null || requested <= 0) return { ok: false, reason: 'NO_AMOUNT' }
    if (direction === 'ADD' && available !== null && requested > available) {
      return { ok: false, reason: 'ABOVE_AVAILABLE', requested }
    }
    if (direction === 'REMOVE' && requested > marginState.margin) {
      return { ok: false, reason: 'ABOVE_COMMITTED', requested }
    }
    return { ok: true, requested }
  }, [amount, available, direction, marginState])

  const refusal = draft.ok ? null : {
    CROSS_MARGIN: 'Cross margin — this position is backed by the whole account, so margin cannot be moved into or out of it.',
    MARGIN_UNKNOWN: 'The account read carries no margin for this position, so it cannot be adjusted.',
    NO_AMOUNT: 'Enter an amount in USDT.',
    ABOVE_AVAILABLE: `Only ${formatUsdt(available)} USDT is available to add.`,
    ABOVE_COMMITTED: `Only ${formatUsdt(marginState.margin)} USDT is committed to this position.`,
  }[draft.reason] ?? 'This adjustment is invalid.'

  // What the position would hold if the exchange applies it in full. Shown as
  // an expectation, not a promise: Binance may remove less than asked.
  const resultingMargin = draft.ok
    ? direction === 'ADD'
      ? marginState.margin + draft.requested
      : marginState.margin - draft.requested
    : null

  const submit = (event) => {
    event.preventDefault()
    if (!draft.ok) return
    onSubmit?.({
      symbol: position.symbol,
      positionSide: position.positionSide,
      direction,
      amount: String(draft.requested),
    })
    onClose?.()
  }

  return (
    <form
      className={`futures-order-editor is-${presentation.tone}`}
      ref={panelRef}
      style={style}
      aria-label={`Adjust ${position.symbol} ${presentation.positionSide} position margin`}
      onSubmit={submit}
    >
      <header className="futures-order-editor-handle" {...handleProps}>
        <strong>{position.symbol}</strong>
        <span className={`futures-order-editor-side is-${presentation.tone}`}>
          MARGIN {presentation.positionSide}
        </span>
        <button type="button" aria-label="Close margin panel" onClick={() => onClose?.()}>×</button>
      </header>

      <div className="futures-order-editor-modes" role="group" aria-label="Margin direction">
        <button
          type="button"
          className={direction === 'ADD' ? 'is-selected' : ''}
          aria-pressed={direction === 'ADD'}
          onClick={() => setDirection('ADD')}
        >
          Add
        </button>
        <button
          type="button"
          className={direction === 'REMOVE' ? 'is-selected' : ''}
          aria-pressed={direction === 'REMOVE'}
          onClick={() => setDirection('REMOVE')}
        >
          Remove
        </button>
      </div>

      <label>
        <span>Amount, USDT</span>
        <input
          aria-label="Margin amount in USDT"
          type="text"
          inputMode="decimal"
          disabled={!marginState.adjustable}
          value={amount}
          onChange={event => setAmount(event.target.value)}
        />
      </label>

      <dl className="futures-order-editor-summary">
        <div>
          <dt>Margin</dt>
          <dd>{marginState.margin === null ? '—' : `${formatUsdt(marginState.margin)} ${marginState.marginMode === 'CROSS' ? 'cross' : 'isolated'}`}</dd>
        </div>
        <div>
          <dt>{direction === 'ADD' ? 'Available' : 'After'}</dt>
          <dd>
            {direction === 'ADD'
              ? (available === null ? '—' : formatUsdt(available))
              : (resultingMargin === null ? '—' : formatUsdt(resultingMargin))}
          </dd>
        </div>
      </dl>
      {draft.ok ? null : <p role="status">{refusal}</p>}

      <div className="futures-order-editor-actions">
        <button type="submit" className="is-apply" disabled={!draft.ok}>
          {direction === 'ADD' ? 'Add margin' : 'Remove margin'}
        </button>
      </div>
    </form>
  )
}

export default FuturesPositionMarginEditor
