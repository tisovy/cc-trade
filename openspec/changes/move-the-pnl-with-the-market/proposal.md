## Why

The operator asked for the PnL to redraw every 200 ms. Redrawing the number the
desk has five times a second would change nothing: unrealized PnL is computed
from the **mark price**, and the mark arrives once a second —
`<symbol>@markPrice@1s` is the fastest mark stream Binance publishes. Four of
those five frames would paint the same figure.

What the operator is actually asking for is a PnL that *moves with the market*,
and that exists — just not on the mark feed. The trade tape and the kline stream
carry the last traded price many times a second, and the desk already receives
both for the contract on screen. Between two marks, the position's value can be
re-priced against the price that is actually printing.

The two prices are not the same number, and that is the whole design problem.
Binance's own PnL, and its liquidation, are the mark's. A desk that quietly
swapped one for the other would show a figure that disagrees with the exchange's
at the moment the operator most wants to trust it.

## What Changes

- **The mark's PnL stays the authority.** Every second, the position's PnL is
  the exchange's own arithmetic on the exchange's own mark, exactly as today.
- **Between marks, the number moves with the last trade.** The position is
  re-priced against the printing price at up to five frames a second, so a
  violent move is visible as it happens rather than in one-second steps.
- **The two are distinguishable at a glance.** The interpolated reading is
  presented as the estimate it is; the confirmed reading is presented as
  confirmed. The operator never has to wonder which one they are reading.
- **The tick is bounded, not chased.** At most one repaint per 200 ms, and the
  work is a multiplication per open position — no re-render of the desk around
  it.

## Trade-offs this accepts

- A number on screen that is not the exchange's own, for up to a second at a
  time. Accepted because the alternative is a number that is a second stale
  during exactly the move the operator is trading, and because it is marked.
- Liquidation distance is **not** re-priced this way. It is a function of the
  mark by definition, and estimating it from the last trade would put a wrong
  distance under a real liquidation.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: an open position's value moves with the market
  between marks, and says which of the two readings it is showing.

## Impact

- `src/utils/futuresPositionMarks.js` and `src/utils/futuresOrderPresentation.js`
  — the estimated re-pricing and its presentation.
- `src/components/features/futures/FuturesPortfolioDock.jsx` and the ticket's
  position rows.
- Depends on `stop-rebuilding-the-desk-on-every-tick`: a 200 ms repaint is only
  worth having if it repaints the number rather than the workspace.
