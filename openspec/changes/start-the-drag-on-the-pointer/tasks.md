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

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data that a dragged order follows the pointer immediately, that the order stays visible until the cancellation is confirmed, and that a quick drag-and-drop lands where it was dropped.
