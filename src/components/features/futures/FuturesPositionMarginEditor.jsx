import { useMemo, useState } from 'react'
import {
  describeFuturesPosition,
  describeFuturesPositionMargin,
  formatUsdt,
  projectLiquidationPrice,
} from '../../../utils/futuresOrderPresentation.js'
import { formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 264

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const MODE_MEANING = Object.freeze({
  ISOLATED: 'margin is this position’s own',
  CROSS: 'margin is shared with the whole account',
})

// Margin is money that is already the operator's — moving it in or out changes
// no exposure, only the distance to liquidation. So this panel refuses nothing
// on policy: its bounds are facts (you cannot spend what the wallet does not
// hold, withdraw what the position does not hold, or take out the margin that
// is keeping the position alive), and Binance remains the authority on the
// exact removable amount, which is smaller still.
export const FuturesPositionMarginEditor = ({
  position,
  contract = null,
  availableUsdt = null,
  riskSnapshotCoherent = false,
  anchor,
  onSubmit,
  onClose,
}) => {
  const presentation = describeFuturesPosition(position)
  const marginState = describeFuturesPositionMargin(position)
  const tickSize = contract?.filters?.price?.tickSize ?? null
  const [direction, setDirection] = useState('ADD')
  const [amount, setAmount] = useState('')
  const [unsent, setUnsent] = useState(null)
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose,
  })

  const available = toFiniteNumber(availableUsdt)
  const typed = toFiniteNumber(amount)
  const requestedAmount = typed !== null && typed > 0 ? typed : null
  const accountUnrealizedPnl = toFiniteNumber(position?.markUnrealizedPnl)
    ?? toFiniteNumber(position?.unrealizedPnl)
    ?? toFiniteNumber(position?.unRealizedProfit)
  const removalRiskKnown = riskSnapshotCoherent === true
    && accountUnrealizedPnl !== null
    && marginState.maintenanceMargin !== null
    && marginState.maintenanceMargin > 0
    && marginState.marginBalance !== null
    && marginState.marginBalance > 0
    && marginState.liquidationBuffer !== null

  const draft = useMemo(() => {
    if (!marginState.adjustable) {
      return {
        ok: false,
        reason: marginState.marginMode === 'CROSS' ? 'CROSS_MARGIN' : 'MARGIN_UNKNOWN',
      }
    }
    if (direction === 'ADD' && (available === null || available < 0)) {
      return { ok: false, reason: 'AVAILABLE_UNKNOWN' }
    }
    if (direction === 'REMOVE' && !removalRiskKnown) {
      return { ok: false, reason: 'RISK_UNKNOWN' }
    }
    if (direction === 'REMOVE'
      && (marginState.removable === null || marginState.removable < 0)) {
      return { ok: false, reason: 'REMOVABLE_UNKNOWN' }
    }
    if (requestedAmount === null) return { ok: false, reason: 'NO_AMOUNT' }
    if (direction === 'ADD' && requestedAmount > available) {
      return { ok: false, reason: 'ABOVE_AVAILABLE', requested: requestedAmount }
    }
    if (direction === 'REMOVE' && requestedAmount > marginState.margin) {
      return { ok: false, reason: 'ABOVE_COMMITTED', requested: requestedAmount }
    }
    // The one bound that is about liquidation rather than arithmetic: below the
    // maintenance requirement the position is closed by the exchange, so an
    // amount that reaches it is not a transfer, it is a liquidation.
    if (direction === 'REMOVE' && requestedAmount > marginState.removable) {
      return { ok: false, reason: 'ABOVE_REMOVABLE', requested: requestedAmount }
    }
    return { ok: true, requested: requestedAmount }
  }, [available, direction, marginState, removalRiskKnown, requestedAmount])

  const refusal = draft.ok ? null : {
    CROSS_MARGIN: 'Cross margin — this position is backed by the whole account, so margin cannot be moved into or out of it.',
    MARGIN_UNKNOWN: 'The account read carries no margin for this position, so it cannot be adjusted.',
    AVAILABLE_UNKNOWN: 'Available USDT has not been confirmed, so margin cannot be added.',
    RISK_UNKNOWN: 'The current account risk reading is incomplete or mixes generations, so margin cannot be removed.',
    REMOVABLE_UNKNOWN: 'The account read does not establish a removable amount, so margin cannot be removed.',
    NO_AMOUNT: 'Enter an amount in USDT.',
    ABOVE_AVAILABLE: `Only ${formatUsdt(available)} USDT is available to add.`,
    ABOVE_COMMITTED: `Only ${formatUsdt(marginState.margin)} USDT is committed to this position.`,
    ABOVE_REMOVABLE: marginState.removable > 0
      ? `Only ${formatUsdt(marginState.removable)} USDT stands above the liquidation floor, and Binance may release less.`
      : 'This position is already at its liquidation floor — nothing can be taken out of it.',
  }[draft.reason] ?? 'This adjustment is invalid.'

  // What the position would hold if the exchange applies it in full. Shown as
  // an expectation, not a promise: Binance may remove less than asked. The
  // buffer moves by exactly the amount transferred — the notional does not
  // change, so neither does the maintenance requirement under it.
  const delta = requestedAmount === null
    ? null
    : direction === 'ADD' ? requestedAmount : -requestedAmount
  const resultingMargin = delta === null || marginState.margin === null
    ? null
    : marginState.margin + delta
  const resultingBuffer = delta === null || marginState.liquidationBuffer === null
    ? null
    : marginState.liquidationBuffer + delta

  // The reading the operator actually needs while moving margin: not how much
  // money exists, but how much of this position's margin is spare. Everything
  // in it is read from the exchange.
  const meter = useMemo(() => {
    const { maintenanceMargin, liquidationBuffer } = marginState
    if (maintenanceMargin === null || liquidationBuffer === null) return null
    const buffer = Math.max(0, liquidationBuffer)
    const added = direction === 'ADD' ? (requestedAmount ?? 0) : 0
    const asked = direction === 'REMOVE' ? (requestedAmount ?? 0) : 0
    const removed = Math.min(asked, buffer)
    const scale = maintenanceMargin + buffer + added
    if (!(scale > 0)) return null
    const share = value => `${Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2)}%`
    return {
      breached: asked > buffer,
      maintenance: share(maintenanceMargin),
      remaining: share(buffer - removed),
      removed: removed > 0 ? share(removed) : null,
      added: added > 0 ? share(added) : null,
      label: `Margin ${formatUsdt(marginState.marginBalance)} USDT: `
        + `${formatUsdt(maintenanceMargin)} held as maintenance, `
        + `${formatUsdt(buffer)} spare above liquidation`,
    }
  }, [direction, marginState, requestedAmount])

  // Liquidation arrives when the maintenance requirement is the whole of the
  // margin balance. Stated as a proportion it is the one reading that moves
  // legibly on a healthy position, where a few hundred USDT against thousands
  // changes the bar by a sliver.
  const riskPercent = balance => (
    marginState.maintenanceMargin === null || balance === null || !(balance > 0)
      ? null
      : (marginState.maintenanceMargin / balance) * 100
  )
  const riskNow = riskPercent(marginState.marginBalance)
  const riskAfter = delta === null || marginState.marginBalance === null
    ? null
    : riskPercent(marginState.marginBalance + delta)

  // The reading the whole panel exists to move, and the one it never showed: the
  // price the exchange closes this position at. A percentage answers "how close";
  // only the price answers "closes me where", which is the number the operator is
  // watching on the chart while they decide how much to move.
  const liquidationNow = toFiniteNumber(position?.liquidationPrice)
  const liquidationAfter = projectLiquidationPrice({
    liquidationPrice: position?.liquidationPrice,
    quantity: position?.quantity,
    positionSide: presentation.positionSide,
    marginDelta: delta,
  })

  // The same control as the order ticket's size: dragging is how the effect on
  // the bar becomes visible at all. Typing past the range stretches it, so the
  // two controls never disagree about the value.
  //
  // The two directions are bounded by different facts, and the panel had been
  // treating them as one: adding was capped at the margin already committed, so a
  // wallet holding 258k offered the same ceiling as taking margin out, and the
  // ceiling read as a refusal. Adding is bounded by the wallet — the readout says
  // which bound it is showing, because a number with no name is what made this
  // look like a limit on the position.
  const sliderCeiling = direction === 'ADD'
    ? (available ?? 0)
    : (marginState.removable ?? marginState.margin ?? 0)
  const sliderMax = Math.max(1, Math.round(Math.max(sliderCeiling, requestedAmount ?? 0)))
  const sliderValue = Math.min(Math.round(requestedAmount ?? 0), sliderMax)

  // The panel closes only on a delivered command: a margin move that never left
  // the renderer leaves the liquidation price exactly where it was, and a closed
  // panel would say otherwise.
  const submit = (event) => {
    event.preventDefault()
    if (!draft.ok) return
    const sent = onSubmit?.({
      symbol: position.symbol,
      positionSide: position.positionSide,
      direction,
      amount: String(draft.requested),
    })
    if (sent === false) {
      setUnsent('Local backend connection unavailable — the margin was not moved.')
      return
    }
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

      {/* The two modes are not two styles of the same thing: only one of them
          can be adjusted at all, so the panel says which this is in words. */}
      {marginState.marginMode ? (
        <p className={`futures-margin-mode is-${marginState.marginMode.toLowerCase()}`}>
          <strong>{marginState.marginMode}</strong>
          <span>{MODE_MEANING[marginState.marginMode]}</span>
        </p>
      ) : null}

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

      {meter ? (
        <div className={`futures-margin-meter${meter.breached ? ' is-breached' : ''}`}>
          <div className="futures-margin-meter-track" role="img" aria-label={meter.label}>
            <span className="is-maintenance" style={{ width: meter.maintenance }} />
            <span className="is-spare" style={{ width: meter.remaining }} />
            {meter.removed ? <span className="is-removed" style={{ width: meter.removed }} /> : null}
            {meter.added ? <span className="is-added" style={{ width: meter.added }} /> : null}
          </div>
          {/* One reading under the bar, in the units the position is watched in.
              It used to carry two: the maintenance requirement — a USDT amount
              titled "Liq. floor", which reads as a price and is not one — and the
              spare margin, which the slider's own readout already states. Both
              are still in the bar: it is drawn to their proportion, and its label
              names them. */}
          <div className="futures-margin-meter-legend">
            {liquidationNow === null || liquidationNow <= 0 ? (
              <span className="is-spare">
                Spare {formatUsdt(Math.max(0, marginState.liquidationBuffer))}
                {resultingBuffer === null
                  ? null
                  : ` → ${formatUsdt(Math.max(0, resultingBuffer))}`}
              </span>
            ) : (
              <span
                className="is-liquidation"
                title="Where the exchange closes this position. The price after the transfer is projected from the amount moved; Binance sets the exact one."
              >
                Liq. price <b>{formatExchangePrice(liquidationNow, tickSize)}</b>
                {liquidationAfter === null ? null : (
                  <>
                    {' → '}
                    <strong className={delta > 0 ? 'is-safer' : 'is-riskier'}>
                      {formatExchangePrice(liquidationAfter, tickSize)}
                    </strong>
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* Directly under the drawing it moves: the slider is what makes the
          effect of an adjustment visible, so nothing is put between them. */}
      <label className="futures-production-size-slider futures-editor-slider">
        <span>
          <span>{direction === 'ADD' ? 'Add' : 'Remove'}</span>
          {/* Deliberately not an `output`: that element carries the status role,
              and this panel already has one — the line that states why an
              adjustment is refused, which must stay the only status here. */}
          <span className="futures-editor-slider-value" aria-live="polite">
            <strong>{sliderValue}</strong>
            <b>of {sliderMax} {direction === 'ADD' ? 'available' : 'removable'}</b>
          </span>
        </span>
        <input
          aria-label={`Margin amount to ${direction === 'ADD' ? 'add' : 'remove'}, USDT`}
          type="range"
          min="0"
          max={sliderMax}
          step="1"
          value={sliderValue}
          disabled={!marginState.adjustable}
          style={{ '--futures-size-fill': `${(sliderValue / sliderMax) * 100}%` }}
          onChange={event => setAmount(event.target.value)}
        />
      </label>

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
          <dd>{formatUsdt(marginState.margin)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatUsdt(available)}</dd>
        </div>
        <div>
          <dt>Margin after</dt>
          <dd>{formatUsdt(resultingMargin)}</dd>
        </div>
        {/* Liquidation risk stated the way Binance states it: the maintenance
            requirement as a share of the margin balance, closed out at 100%.
            On a healthy position this is the reading that actually moves. */}
        <div>
          <dt title="Maintenance requirement ÷ margin balance. Liquidation at 100%.">
            Liq. risk
          </dt>
          <dd>
            {riskNow === null ? '—' : `${riskNow.toFixed(2)}%`}
            {riskAfter === null ? null : ` → ${riskAfter.toFixed(2)}%`}
          </dd>
        </div>
      </dl>
      {unsent
        ? <p role="status" className="is-unsent">{unsent}</p>
        : draft.ok ? null : <p role="status">{refusal}</p>}

      <div className="futures-order-editor-actions">
        <button type="submit" className="is-apply" disabled={!draft.ok}>
          {direction === 'ADD' ? 'Add margin' : 'Remove margin'}
        </button>
      </div>
    </form>
  )
}

export default FuturesPositionMarginEditor
