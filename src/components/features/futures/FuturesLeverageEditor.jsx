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
// operator's own money an entry is *required* to put behind it, and therefore how
// small a move against them closes the position that entry opens. It does not
// re-price a position already open, whose liquidation is computed from the margin
// already behind it. Nothing on the desk stated the multiple and nothing could set
// it: /fapi/v3/positionRisk stopped reporting it, so both readings are asked for.
export const FuturesLeverageEditor = ({
  symbol,
  leverage = null,
  maxLeverage = null,
  maxNotionalValue = null,
  marginMode = null,
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

  const openQuantity = Math.abs(Number(openPosition?.quantity))
  const holdsPosition = Number.isFinite(openQuantity) && openQuantity > 0
  const lowering = current !== null && chosen < current

  // The one change Binance refuses outright, refused here instead — the desk
  // holds every input the exchange's own rule names. `-4161
  // ISOLATED_LEVERAGE_REJECT_WITH_POSITION`: *"Leverage reduction is not
  // supported in Isolated Margin Mode with open positions."* Raising it is
  // allowed, and so is either direction in cross.
  //
  // Found the way these are always found: the operator lowered 2× to 1× on an
  // isolated contract they were holding, and got a code back from a signed
  // request the desk could have answered itself.
  const refusedWhileOpen = holdsPosition && marginMode === 'ISOLATED' && lowering

  // A change that never left the renderer must not look like one that landed:
  // the panel closing is the only confirmation this control has, so it stays open
  // and says so instead.
  const submit = (event) => {
    event.preventDefault()
    if (chosen === current || refusedWhileOpen) return
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

      {/* One status line, and a failed send owns it.
          What it says about an open position is what the desk's own arithmetic
          says. The liquidation price it draws — and checks against the
          exchange's own figure on every account pass — is computed from the
          margin standing behind the position, the contract's maintenance rate
          and, in cross, the whole wallet. The multiple is in none of those
          terms. What it does set is the margin a position is *required* to
          hold, which is why it moves free margin and not the price the exchange
          closes at.
          The panel used to promise the opposite, and on 2026-08-21 the operator
          raised 1× to 2× on a position they were holding, was told its
          liquidation was moving closer, and watched nothing move. */}
      {unsent ? (
        <p role="status" className="is-riskier">
          Local backend connection unavailable — the leverage was not changed.
        </p>
      ) : refusedWhileOpen ? (
        <p role="status" className="is-riskier">
          {`${symbol} is open in isolated margin — Binance will not lower the multiple while a position is open. Raising it is allowed; lowering it needs the position closed.`}
        </p>
      ) : holdsPosition ? (
        <p role="status">
          {marginMode === 'ISOLATED'
            ? `${symbol} is open — the multiple sets what an entry is required to hold. The margin already walled off behind this position does not move with it, so its liquidation price stays where it is.`
            : marginMode === 'CROSSED'
              ? `${symbol} is open in cross margin — the multiple sets what the position is required to hold, and frees or commits wallet margin. Liquidation is the whole wallet's and does not move with it.`
              : `${symbol} is open — the multiple sets what an entry is required to hold; it does not move the liquidation price of a position already open.`}
        </p>
      ) : null}

      <div className="futures-order-editor-actions">
        <button
          type="submit"
          className="is-apply"
          disabled={chosen === current || refusedWhileOpen}
        >
          {chosen === current
            ? `Already ${chosen}×`
            : refusedWhileOpen ? `Held at ${current}×` : `Set ${chosen}×`}
        </button>
      </div>
    </form>
  )
}

export default FuturesLeverageEditor
