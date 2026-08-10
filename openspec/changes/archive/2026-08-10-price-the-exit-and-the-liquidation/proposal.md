## Why

Both position panels answer a question the operator did not ask.

The **close panel** offers four percentage buttons — 25, 50, 75, 100 — which is
four of the hundred sizes a position can be cut to, each costing a click to find
out it was the wrong one. Under them it spends two of its four summary cells on
`Side: SELL · reduce-only`: the side is already in the panel's heading, and every
close this panel sends is reduce-only. Nothing on it says what the exit would
actually settle — how much of the position is left, what comes off the table, or
what the slice would realize.

The **margin panel** shows a bar, a maintenance amount titled `Liq. floor`, the
spare margin, and a liquidation risk percentage. The operator reported reading
`Liq. floor 152.79` as a liquidation price — it is a USDT amount — and asked why
the liquidation price never seemed to move while they added margin. It never
moved because it was never there. The panel's whole purpose is to move that price
and it was the one number missing from it.

Its Add control had a second defect the operator found first: adding was bounded
by `min(available, margin already committed)`, so a wallet holding 258 426 USDT
offered the same ceiling as *removing* margin — around 2 549 — and a bound with
no name on it reads as a refusal. Adding margin and removing it are bounded by
different facts, and the panel was treating them as one.

## What Changes

- The close panel's percentage buttons become **one slider spanning the whole
  position**, working in percent so every stop it lands on is still floored to
  the contract's lot step. The exact size stays typeable beside it, and typing
  moves the slider.
- Its summary states **what the exit settles**: the size the position is left
  holding, the value coming off the table, and the profit that size would realize
  — at the mark for a market exit, at the level for a limit one. The side and the
  reduce-only guarantee move to where they are worth reading: beside the limit
  price, which rests on one side of the book, and on the apply button.
- The margin panel states the **liquidation price, and where the transfer would
  move it**, at the contract's tick. `Liq. floor` and the duplicated spare figure
  leave the legend; the bar still draws both and its label still names them.
- **Adding is bounded by the wallet**, removing by the margin above the
  liquidation floor, and the readout names which bound it is showing.
- Both panels share one slider style, since a close panel measuring percent and a
  margin panel measuring USDT need the same gesture and not two of them.

## Decisions

**The projected liquidation price is arithmetic, not a second guess at Binance's
formula.** Moving margin does not change the position's size, so the liquidation
price moves by the amount transferred spread over the quantity: the exchange
closes the position when the loss eats the margin, and the loss per unit of price
is the quantity. The maintenance requirement is itself a share of the notional at
the liquidation price, which bends the answer by that rate — under a percent of
the move — so the reading is labelled a projection and the exchange stays the
authority on the exact price. A position the exchange reports no liquidation
price for gets no invented one: the spare margin is stated instead.

**Estimated PnL is priced where the exit is priced.** A market close is valued at
the mark and a limit close at the level, because choosing the level is the point
of choosing a limit. Neither figure carries the exchange's fees and a market exit
pays whatever the book pays, so both are labelled estimates.

**Naming the bound is the fix, not raising it.** The Add ceiling now spans the
available balance, which makes a realistic top-up a small part of the track. That
is the honest shape of the fact — it is Binance's own bound in Binance's own
dialog — and the exact amount is typed, not dragged, once the operator knows what
the number they are looking at is.

**Nothing new is refused.** Both panels keep every refusal they had. The slider
that stretches past its bound still cannot submit past it, and the exchange still
gives the refusals only it can give.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: the close panel's size is chosen on a slider and
  the panel states what the exit would settle.
- `futures-workstation-presentation`: a margin panel states the liquidation price
  it would move to, and an amount control names the bound it spans.

## Impact

- `src/utils/futuresOrderPresentation.js`: `projectLiquidationPrice`,
  `describeFuturesCloseOutcome`.
- `src/utils/futuresOrderDraft.js`: `calculateFuturesClosePercent`,
  `remainingFuturesQuantity` — both on decimal atoms, because `Number('0.15')`
  over `0.5` is 29.999…% and a slider computed that way drifts a stop on every
  read.
- `src/components/features/futures/FuturesPositionCloser.jsx`,
  `FuturesPositionMarginEditor.jsx` (now given the contract, for its tick),
  `FuturesProductionWorkstation.jsx`,
  `FuturesProductionExecutionTicket.css`.
- No new exchange call, no new command, no new rate-limit weight: every figure is
  derived from the account read the panels already hold.
- Lands while `adjust-isolated-position-margin` is still open on live
  confirmation. Its section 10 made the effect of a margin transfer legible; this
  is the operator's answer to it, so the margin requirements here are stated on
  `futures-workstation-presentation` rather than opened as a second delta on the
  capability that change is still creating.
