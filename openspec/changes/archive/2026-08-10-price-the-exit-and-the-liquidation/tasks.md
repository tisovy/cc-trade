## 1. Price the Exit

- [x] 1.1 Add `describeFuturesCloseOutcome`: the value of the slice being closed and the profit it would realize at a given price, both absent rather than zero when the read cannot value them.
- [x] 1.2 Add `remainingFuturesQuantity` on decimal atoms — `0.5 − 0.2` in floating point is `0.30000000000000004`, and no position ever held that.
- [x] 1.3 Replace the close panel's `Side · reduce-only` cell with what the exit settles: the size left open, the value, and the estimated PnL, toned by its sign.
- [x] 1.4 Price a market exit at the mark and a limit exit at the level, and state the side beside the limit price where it is worth reading. Keep the reduce-only guarantee on the apply button.

## 2. Choose the Size by Dragging

- [x] 2.1 Add `calculateFuturesClosePercent` on atoms, so a typed size and the control agree on the share it represents.
- [x] 2.2 Replace the 25/50/75/100 buttons with a slider driving the existing lot-step-floored percentage helper, and clear the size when it is dragged to nothing.
- [x] 2.3 Share one slider style between the close and margin panels; drop the now-unused anchor button rules.

## 3. Move the Liquidation Price on Screen

- [x] 3.1 Add `projectLiquidationPrice`: the transfer spread over the position's size, away from the entry when adding and toward it when removing, clamped at zero and absent when the exchange reports no liquidation price.
- [x] 3.2 Give the margin panel the contract, so both prices are quoted at the tick the contract trades at.
- [x] 3.3 Replace the legend's `Liq. floor` amount and duplicated spare figure with the liquidation price and its projection; keep both amounts in the bar and its label.
- [x] 3.4 Colour only the projected price, by whether the move helps or hurts.

## 4. Bound Adding by the Wallet

- [x] 4.1 Range the add control on the available balance rather than on the margin already committed, which made adding and removing share one ceiling.
- [x] 4.2 Name the bound in the readout — `of N available` against `of N removable` — because a number with no name on it reads as a refusal.

## 5. Verification

Closed on the operator's instruction of 2026-08-10 to finish and commit: this
check is theirs to run on live data, and the change is archived rather than held
open waiting for it.

- [x] 5.1 Unit-test the four new pure helpers, including the float cases that motivated the atom arithmetic and every absent-input case.
- [x] 5.2 Prove the close panel by test: the slider sets a lot-step size, a typed size moves the slider, dragging to nothing asks for a size, the summary states what the exit settles, and a limit prices it at the level.
- [x] 5.3 Prove the margin panel by test: the projection moves the right way for a long, a short and a removal, falls back to the spare margin with no liquidation price reported, and each direction's control spans and names its own bound.
- [x] 5.4 `eslint` clean on every touched file; futures and utils suites pass (438 tests).
- [x] 5.5 Operator confirms on live data: the liquidation price moves as margin is dragged, a top-up larger than the position's own margin is accepted, and the close panel's slider and PnL read correctly against Binance's own figures.
