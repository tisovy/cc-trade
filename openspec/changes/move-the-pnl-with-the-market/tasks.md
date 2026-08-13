## 1. The Estimate

- [x] 1.1 Re-price an open position against the newest traded price for its contract, keeping the confirmed mark reading beside it.
- [x] 1.2 Bound the repaint to one frame per 200 ms per contract, coalescing whatever arrived in between.
- [x] 1.3 Leave the liquidation price and the margin readings on the mark, and prove by test that they do not move with the tape.

## 2. The Reading Says Which It Is

- [x] 2.1 Present an estimated PnL distinguishably from a confirmed one, on the dock's position rows and on the ticket's.
- [x] 2.2 State the rule once where the operator can find it — the estimate is the last trade, the confirmation is the mark, the liquidation is always the mark.
- [x] 2.3 Prove by test that a confirmed mark replaces the estimate and is presented as confirmed.

## 3. Only Where The Desk Can Afford It

- [x] 3.1 Re-price only the contracts holding an open position; the desk already subscribes to their marks for the same reason.
- [x] 3.2 Prove by test that the repaint touches the position rows and not the workspace around them.

## 4. The Price On Screen Is The Print

- [x] 4.1 Move the header's last traded price on every print, before the tape's minimum notional is applied, at a bounded rate.
- [x] 4.2 Read the print ahead of the candle close, keeping the close as what stands in when there is no print.
- [x] 4.3 Prove by test that a print the tape filter drops still moves the price, and that a burst inside one window states it once.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data that the PnL moves during a sharp move rather than stepping once a second, and that the confirmed figure still matches Binance — step 30 п.4–6 in `verify-the-desk-in-one-sitting/runbook.md`, which needs an open position, plus step 12 п.3 for the half that does not (the last price keeps moving with a tape filter set high). Splitting them is what lets the tape half be read for free in part 1.
