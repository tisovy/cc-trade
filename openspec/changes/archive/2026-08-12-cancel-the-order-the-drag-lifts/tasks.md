## 1. The Drag Starts With A Cancellation

- [x] 1.1 Send the cancellation when a drag begins on a working order (`FuturesWorkstationChart.jsx:790`), instead of only drawing lines.
- [x] 1.2 Begin the drag only on a confirmed cancellation: a refusal leaves the order alone and states why, an unknown outcome states that it is unknown and starts nothing.
- [x] 1.3 Give the chart the cancellation's outcome to wait on — `useFuturesTrading` currently reports whether a command was *sent*, and this needs whether it was *answered*.
- [x] 1.4 Keep the paused-trading refusal ahead of the cancellation, so a drag cannot touch the book while trading is paused (today it is checked at the drop, `FuturesTradingTicket.jsx:330`).
- [x] 1.5 Prove by test that a refused cancellation starts no drag and leaves the order drawn, and that a confirmed one removes it from the chart and the order list.

## 2. What Is Dragged Is Drawn

- [x] 2.1 Draw the order being placed at the pointer, carrying its side and size, as the only mark standing for it.
- [x] 2.2 Keep at most one faint, unlabelled marker at the price it was lifted from.
- [x] 2.3 Leave every other order's line, label and handle untouched.
- [x] 2.4 Prove by test that a drag draws one mark for the dragged order and does not disturb the others.

## 3. The Obligation Is Discharged Or Stated

- [x] 3.1 Place the replacement at the drop price, through the placement path with its cap and filter checks — the checks that today guard the amendment (`FuturesTradingTicket.jsx:362`).
- [x] 3.2 Place the order again at the price it was lifted from when the drag is abandoned: modifier released, cancelled, or dropped where it started.
- [x] 3.3 Restore on the paths that end a drag for other reasons — a contract change ends a drag in flight (`FuturesWorkstationChart.jsx:230`) and must not end it by dropping the obligation.
- [x] 3.4 When neither placement succeeds, state it where the operator cannot miss it: the order that is gone, the reason, and a control that places it again. Not a log line.
- [x] 3.5 Present an unresolved placement as unresolved and place nothing further automatically — a second attempt on an unknown outcome is how two orders end up on the book.
- [x] 3.6 Prove by test: a drop places at the new price; an abandoned drag places at the old price; a refused placement raises the stated obligation with a retry; an unresolved placement raises no second attempt.

## 4. The Window Is Made Visible

- [x] 4.1 While the replacement is in flight, show that the level is uncovered rather than showing an order that is not there yet.
- [x] 4.2 Prove by test that nothing presents the replacement as working before the exchange reports it.

## 5. What This Removes

- [x] 5.1 Remove the native-amendment path from the drag (`FuturesTradingTicket.jsx:324`) and its "one call, so a rejection leaves the order where it was" comment, which stops being true here.
- [x] 5.2 Leave the amend panel on the amendment: repricing by typing keeps the single-call behaviour and its safety.
- [x] 5.3 Record in `docs/futures_trading.md` that a drag is now cancel-and-place, with the window it opens, so the operator's own documentation matches the desk.

## 6. Verification

- [x] 6.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:command-path`.
- [ ] 6.2 Operator confirms on live data, on a small order far from the market: picking it up removes it from the book and the screen; dropping it places it at the new price; abandoning puts it back; and a deliberately over-cap drop states that the order is gone and offers to place it again. **Confirmed by the operator on 2026-08-12** — lift, drop and abandon all behaved. The fourth case fired on the exchange's minimum notional rather than the desk's cap, which is the same branch: "APRUSDT BUY 19 @ 0.1983 was cancelled and could not be placed again… Place it again at 0.2655000". The record shows eleven clean cancel→place pairs and no `replaceOrder`.

## 7. Discovered While Implementing

- [x] 7.1 Carry the order's identity on a Futures placement and cancellation refusal (`emitFuturesApiRejection`), so a renderer waiting on one command's answer cannot read another order's refusal as its own.
- [x] 7.2 Refuse the lift itself when the order could not be placed again at the price it already rests at — an order the desk cannot put back must not be taken off the book.
- [x] 7.3 Place the remainder, not the original quantity: a partly filled order that is lifted comes back the size it was still working.
- [x] 7.4 Carry the exchange's own `positionSide` onto the replacement: a one-way account reports `BOTH`, and the derived leg is refused by Binance.
- [x] 7.5 Replace at the tick of the order's own contract, captured when it was lifted: a drag ended by a contract change would otherwise round the old order's price to the new contract's tick, and 0.0308370 against a 0.01 tick is an order at 0.03.
- [x] 7.6 Settle one command on an answer that names no order. A refusal composed before the order was identified — a paused desk, the local cap, an unconfigured adapter — answers one command of that action, and settling every waiting command on it would let a refusal of the ticket's order end the drag's wait for a different one.

## 8. Stated Limits, Not Fixed Here

- [x] 8.1 A drag whose lift is confirmed while the whole workspace unmounts — leaving the Futures market mid-gesture — ends with the order cancelled and no alert, because the surface that would raise it is gone. A contract change is handled (the chart restores the order); leaving the market is not. Carrying an obligation across an unmount needs somewhere outside the workspace to hold it, which is a larger decision than this change.
- [x] 7.7 Draw the lifted order on the plate a resting one is drawn on. Its label and its value were bare children of the handle, so every rule that sizes a handle's text missed them: the value rendered at the desk's body size — 16px inside a 16px plate — and broke out of it. Measured in Chromium: 8.75px on the plate, 16px off it. The handle itself is a positioning box now and carries no border of its own; it kept the one from the plate it used to be, which drew a second outline around every handle on the chart.
