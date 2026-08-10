## 1. The Drag Starts With A Cancellation

- [ ] 1.1 Send the cancellation when a drag begins on a working order (`FuturesWorkstationChart.jsx:790`), instead of only drawing lines.
- [ ] 1.2 Begin the drag only on a confirmed cancellation: a refusal leaves the order alone and states why, an unknown outcome states that it is unknown and starts nothing.
- [ ] 1.3 Give the chart the cancellation's outcome to wait on — `useFuturesTrading` currently reports whether a command was *sent*, and this needs whether it was *answered*.
- [ ] 1.4 Keep the paused-trading refusal ahead of the cancellation, so a drag cannot touch the book while trading is paused (today it is checked at the drop, `FuturesTradingTicket.jsx:330`).
- [ ] 1.5 Prove by test that a refused cancellation starts no drag and leaves the order drawn, and that a confirmed one removes it from the chart and the order list.

## 2. What Is Dragged Is Drawn

- [ ] 2.1 Draw the order being placed at the pointer, carrying its side and size, as the only mark standing for it.
- [ ] 2.2 Keep at most one faint, unlabelled marker at the price it was lifted from.
- [ ] 2.3 Leave every other order's line, label and handle untouched.
- [ ] 2.4 Prove by test that a drag draws one mark for the dragged order and does not disturb the others.

## 3. The Obligation Is Discharged Or Stated

- [ ] 3.1 Place the replacement at the drop price, through the placement path with its cap and filter checks — the checks that today guard the amendment (`FuturesTradingTicket.jsx:362`).
- [ ] 3.2 Place the order again at the price it was lifted from when the drag is abandoned: modifier released, cancelled, or dropped where it started.
- [ ] 3.3 Restore on the paths that end a drag for other reasons — a contract change ends a drag in flight (`FuturesWorkstationChart.jsx:230`) and must not end it by dropping the obligation.
- [ ] 3.4 When neither placement succeeds, state it where the operator cannot miss it: the order that is gone, the reason, and a control that places it again. Not a log line.
- [ ] 3.5 Present an unresolved placement as unresolved and place nothing further automatically — a second attempt on an unknown outcome is how two orders end up on the book.
- [ ] 3.6 Prove by test: a drop places at the new price; an abandoned drag places at the old price; a refused placement raises the stated obligation with a retry; an unresolved placement raises no second attempt.

## 4. The Window Is Made Visible

- [ ] 4.1 While the replacement is in flight, show that the level is uncovered rather than showing an order that is not there yet.
- [ ] 4.2 Prove by test that nothing presents the replacement as working before the exchange reports it.

## 5. What This Removes

- [ ] 5.1 Remove the native-amendment path from the drag (`FuturesTradingTicket.jsx:324`) and its "one call, so a rejection leaves the order where it was" comment, which stops being true here.
- [ ] 5.2 Leave the amend panel on the amendment: repricing by typing keeps the single-call behaviour and its safety.
- [ ] 5.3 Record in `docs/futures_trading.md` that a drag is now cancel-and-place, with the window it opens, so the operator's own documentation matches the desk.

## 6. Verification

- [ ] 6.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:command-path`.
- [ ] 6.2 Operator confirms on live data, on a small order far from the market: picking it up removes it from the book and the screen; dropping it places it at the new price; abandoning puts it back; and a deliberately over-cap drop states that the order is gone and offers to place it again.
