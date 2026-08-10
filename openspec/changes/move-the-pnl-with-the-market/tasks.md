## 1. The Estimate

- [ ] 1.1 Re-price an open position against the newest traded price for its contract, keeping the confirmed mark reading beside it.
- [ ] 1.2 Bound the repaint to one frame per 200 ms per contract, coalescing whatever arrived in between.
- [ ] 1.3 Leave the liquidation price and the margin readings on the mark, and prove by test that they do not move with the tape.

## 2. The Reading Says Which It Is

- [ ] 2.1 Present an estimated PnL distinguishably from a confirmed one, on the dock's position rows and on the ticket's.
- [ ] 2.2 State the rule once where the operator can find it — the estimate is the last trade, the confirmation is the mark, the liquidation is always the mark.
- [ ] 2.3 Prove by test that a confirmed mark replaces the estimate and is presented as confirmed.

## 3. Only Where The Desk Can Afford It

- [ ] 3.1 Re-price only the contracts holding an open position; the desk already subscribes to their marks for the same reason.
- [ ] 3.2 Prove by test that the repaint touches the position rows and not the workspace around them.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data that the PnL moves during a sharp move rather than stepping once a second, and that the confirmed figure still matches Binance.
