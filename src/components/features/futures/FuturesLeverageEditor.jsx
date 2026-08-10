import { useMemo, useState } from 'react'
import { formatUsdt } from '../../../utils/futuresOrderPresentation.js'
import { formatCompactUsdt } from '../../../utils/futuresPriceFormat.js'
import useFloatingPanel from '../../../hooks/useFloatingPanel.js'

const PANEL_WIDTH = 268
// The stops Binance offers, which are also the ones traders name out loud. Every
// one above the contract's own ceiling is dropped, and the ceiling itself is
// always offered: on a contract capped at 75 there must be a way to reach 75.
const LEVERAGE_STOPS = Object.freeze([1, 2, 3, 5, 10, 20, 25, 50, 75, 100, 125])

const toWholeLeverage = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : null
}

// Leverage does not change what a position is worth — it changes how much of the
// operator's own money is standing behind it, and therefore how small a move
// against them closes it. Nothing on the desk stated it and nothing could set it:
// /fapi/v3/positionRisk stopped reporting it, so both readings are asked for.
export const FuturesLeverageEditor = ({
  symbol,
  leverage = null,
  maxLeverage = null,
  maxNotionalValue = null,
  availableUsdt = null,
  openPosition = null,
  anchor,
  onSubmit,
  onClose,
}) => {
  const current = toWholeLeverage(leverage)
  const ceiling = toWholeLeverage(maxLeverage) ?? 125
  // Until the operator picks, the panel shows what the contract is set to — and
  // keeps showing it as the read lands, which can be after the panel opens. A
  // fixed initial value would leave the slider at 1× beside a `Now` of 20×, with
  // Apply armed to quietly lower the leverage.
  const [picked, setPicked] = useState(null)
  const [unsent, setUnsent] = useState(false)
  // The ceiling is bounded on every render, not only at the moment of the pick.
  // `maxLeverage` arrives with the contract read, which can land after the panel
  // opens: a 100× chosen under the 125× placeholder used to stay on screen and
  // stay armed when the contract answered with 20×.
  const chosen = Math.min(picked ?? current ?? 1, ceiling)
  const setChosen = (value) => {
    setUnsent(false)
    setPicked(value)
  }
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor,
    width: PANEL_WIDTH,
    onClose,
  })

  const stops = useMemo(() => {
    const offered = LEVERAGE_STOPS.filter(stop => stop <= ceiling)
    return offered.includes(ceiling) ? offered : [...offered, ceiling]
  }, [ceiling])

  const available = Number(availableUsdt)
  // What the leverage buys: the largest position this wallet can carry at it. The
  // exchange's bracket may cap it lower, and where it reports that cap it is shown
  // beside this rather than instead of it.
  const buyingPower = Number.isFinite(available) && available > 0
    ? available * chosen
    : null
  const bracketCap = Number(maxNotionalValue)

  // Changing leverage on an open position re-prices its liquidation: the same
  // position backed by half the margin is closed by half the move. Binance refuses
  // the change outright if the position is already too big for the new bracket.
  const openQuantity = Math.abs(Number(openPosition?.quantity))
  const holdsPosition = Number.isFinite(openQuantity) && openQuantity > 0
  const raising = current !== null && chosen > current

  // A change that never left the renderer must not look like one that landed:
  // the panel closing is the only confirmation this control has, so it stays open
  // and says so instead.
  const submit = (event) => {
    event.preventDefault()
    if (chosen === current) return
    const sent = onSubmit?.({ symbol, leverage: chosen })
    if (sent === false) {
      setUnsent(true)
      return
    }
    onClose?.()
  }

  return (
    <form
      className="futures-order-editor"
      ref={panelRef}
      style={style}
      aria-label={`Set ${symbol} leverage`}
      onSubmit={submit}
    >
      <header className="futures-order-editor-handle" {...handleProps}>
        <strong>{symbol}</strong>
        <span className="futures-order-editor-side">LEVERAGE</span>
        <button type="button" aria-label="Close leverage panel" onClick={() => onClose?.()}>×</button>
      </header>

      <div className="futures-order-editor-modes is-leverage" role="group" aria-label="Leverage presets">
        {stops.map(stop => (
          <button
            type="button"
            key={stop}
            className={stop === chosen ? 'is-selected' : ''}
            aria-pressed={stop === chosen}
            onClick={() => setChosen(stop)}
          >
            {stop}×
          </button>
        ))}
      </div>

      <label className="futures-production-size-slider futures-editor-slider">
        <span>
          <span>Leverage</span>
          <span className="futures-editor-slider-value" aria-live="polite">
            <strong>{chosen}×</strong>
            <b>of {ceiling}× max</b>
          </span>
        </span>
        <input
          aria-label="Leverage multiple"
          type="range"
          min="1"
          max={ceiling}
          step="1"
          value={chosen}
          style={{ '--futures-size-fill': `${(chosen / ceiling) * 100}%` }}
          onChange={event => setChosen(toWholeLeverage(event.target.value) ?? 1)}
        />
      </label>

      <dl className="futures-order-editor-summary">
        <div>
          <dt>Now</dt>
          <dd>{current === null ? '—' : `${current}×`}</dd>
        </div>
        {/* Not a promise, an arithmetic consequence: the wallet times the multiple.
            The bracket cap beside it is the exchange's own limit at this leverage. */}
        <div>
          <dt title="Available margin × leverage. The exchange's bracket may cap a position lower.">
            Max position
          </dt>
          <dd title={buyingPower === null ? undefined : `${formatUsdt(buyingPower)} USDT`}>
            {buyingPower === null ? '—' : formatCompactUsdt(buyingPower, '—', 1)}
          </dd>
        </div>
        {Number.isFinite(bracketCap) && bracketCap > 0 ? (
          <div>
            <dt>Bracket cap</dt>
            <dd title={`${formatUsdt(bracketCap)} USDT at this leverage`}>
              {formatCompactUsdt(bracketCap, '—', 1)}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* One status line, and a failed send owns it: raising leverage on a position
          that is already open moves the price the exchange closes it at, but a
          change that never reached the backend has not moved anything. */}
      {unsent ? (
        <p role="status" className="is-riskier">
          Local backend connection unavailable — the leverage was not changed.
        </p>
      ) : holdsPosition ? (
        <p role="status" className={raising ? 'is-riskier' : undefined}>
          {raising
            ? `${symbol} is open — at ${chosen}× the same position stands behind less margin, so its liquidation price moves closer to the mark.`
            : `${symbol} is open — changing leverage moves the liquidation price of the position you are holding.`}
        </p>
      ) : null}

      <div className="futures-order-editor-actions">
        <button type="submit" className="is-apply" disabled={chosen === current}>
          {chosen === current ? `Already ${chosen}×` : `Set ${chosen}×`}
        </button>
      </div>
    </form>
  )
}

export default FuturesLeverageEditor
