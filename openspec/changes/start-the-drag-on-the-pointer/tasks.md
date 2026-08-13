## 1. The Gesture Runs First

- [x] 1.1 Let the drag follow the pointer while the cancellation is in flight, keeping the cancellation itself unchanged.
- [x] 1.2 Prove by test that the mark moves with the pointer before the exchange has answered.

## 2. What The Chart Says While It Waits

- [x] 2.1 Draw the pointer's mark as pending — distinct from a lifted order — and keep the working order drawn where it rests until the cancellation is confirmed.
- [x] 2.2 Turn the pending mark into the lifted order on confirmation, and remove it on a refusal or an unknown outcome.
- [x] 2.3 Prove by test that a refused cancellation leaves the order drawn where it rests and starts nothing.

## 3. A Drop Inside The Round Trip

- [x] 3.1 Place the replacement at the price the drop landed on when the gesture finishes before the cancellation is answered.
- [x] 3.2 Keep abandonment — modifier released, gesture cancelled, dropped where it started — restoring the origin price.
- [x] 3.3 Prove both by test.

## 3a. What The Gesture Costs Per Frame

The drag started on the pointer, and then moved slowly. Every pointer move
measured the chart's box, and a layout read on a desk that is being written to
continuously makes the browser lay the whole desk out before it answers — once
per frame, on the frame's critical path.

- [x] 3a.1 Measure the chart's box once for the gesture, and again only when the chart is resized.
- [x] 3a.2 Move the pointer's mark by a property that does not invalidate layout.
- [x] 3a.3 Skip a pointer move that leaves the mark on the row it already occupies.
- [x] 3a.4 Prove all three by test, including that a resize is measured again.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data that a dragged order follows the pointer immediately, that the order stays visible until the cancellation is confirmed, and that a quick drag-and-drop lands where it was dropped — step 27, «Драг: ордер идёт за рукой», in `verify-the-desk-in-one-sitting/runbook.md`, merged there with `cancel-the-order-the-drag-lifts` 6.2 because both drag the same order and splitting them would have the operator pay for the same order twice. The step states the exposure the merge creates: one order, but about seven placements of it, since every drag is a cancel and a place.
