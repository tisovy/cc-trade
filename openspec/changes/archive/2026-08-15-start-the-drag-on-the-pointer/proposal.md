## Why

The operator picks a working order up and the chart stands still for half a
second to a second before the order begins to move. That pause is one round trip
to Binance: `beginOrderDrag` sends the cancellation, marks the drag `lifting`,
and `moveOrderDrag` refuses every pointer event until the exchange has answered.
The pointer is already moving; the desk is not.

The pause is not a defect in the code, it is what
`2026-08-12-cancel-the-order-the-drag-lifts` specified: *the drag SHALL begin
only once the cancellation is confirmed*. That rule exists to stop the desk
claiming an order is off the book before it is. It is the right rule about what
the chart may **say**. It was applied to what the chart may **follow**, and those
are not the same thing.

Following the pointer claims nothing. The order is still drawn where it rests,
still marked as being lifted, and still fillable — all of that is true and stays
on screen. What moves is the mark for where the order is going, which is not a
claim about the exchange at all.

## What Changes

- **The drag follows the pointer from the moment the pointer goes down.** The
  cancellation is sent in the same breath and runs beside the gesture instead of
  in front of it.
- **Until the exchange confirms, the chart says exactly what it says today.**
  The order stays drawn where it rests, still labelled `lifting…`, because it is
  still working. The mark under the pointer is drawn as pending — a thinner,
  dimmer line and a plate that names the state — so it cannot be read as an
  order that exists.
- **On confirmation the picture becomes the one it is today**: the resting mark
  goes, the pointer's mark becomes the lifted order, and the faint origin marker
  appears. On a refusal or an unknown outcome the pointer's mark goes, the order
  is left alone, and the existing alert is raised.
- **A drop that lands before the answer is honoured at the price it landed on.**
  Today a gesture that finishes during the round trip is treated as abandoned and
  the order goes back to where it started — with the drag now able to complete
  inside that window, discarding the operator's actual drop would be the new bug.

- **The gesture stops charging itself for the rest of the desk.** With the wait
  gone, what was left was the cost of each frame. Every pointer move measured the
  chart's box, and a layout read is only answered cheaply against a layout that
  is already clean — the desk's is not, because the book, the dock and the header
  are writing to it the whole time — so the browser laid the entire desk out
  again before answering, once per frame, before anything of the drag itself ran.
  The mark then moved by `top`, which dirtied the layout again for whoever read a
  box next. The box is now measured once per gesture, the mark is moved by a
  transform, and a move that does not change the row the mark is on redraws
  nothing.

## Trade-offs this accepts

- Two marks stand for one order during the round trip: the working order at its
  resting price and a pending mark at the pointer. They are drawn differently and
  say different things, and the alternative — hiding the resting order early — is
  the claim this change is careful not to make.
- The operator can drag a mark for an order whose cancellation is about to be
  refused. The mark then disappears and the refusal is stated, which is what
  happens today; what is new is that the gesture was allowed to run first.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: a drag begins on the pointer rather than on the
  exchange's answer, the pending state is drawn as pending, and a drop that
  lands during the round trip is placed where it landed.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the drag state
  machine and what it draws in each state.
- `src/components/features/futures/FuturesWorkstation.css` — the pending mark.
- No change to `src/hooks/useFuturesOrderDrag.js`: the obligation, the alerts and
  the replacement are unchanged. Nothing about what is sent to the exchange
  changes.
