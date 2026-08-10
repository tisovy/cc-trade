## 1. The Dragged Order Leaves Its Resting Place

- [ ] 1.1 Make the overlay pass that draws owned-order lines aware of the order under the drag, and skip its line and axis label while the drag is in flight (`FuturesWorkstationChart.jsx:704`).
- [ ] 1.2 Do the same for the handle coordinate pass, so the badge does not stay anchored at the resting price (`:725`).
- [ ] 1.3 Keep both passes driven by the drag state already held in the component — `orderDragRef` for the pointer path, `orderDragPreview` for the render path — rather than by a new source of truth.
- [ ] 1.4 Prove by test that dragging one of several orders withdraws that order's line and handle and leaves the others untouched.

## 2. One Marker Where It Was

- [ ] 2.1 Keep the faint `WAS` marker as the single mark at the resting price, now that the order's own line no longer sits under it (`:808`).
- [ ] 2.2 Confirm it carries no axis label, so the axis belongs to the price being aimed at.
- [ ] 2.3 Prove by test that the resting price carries one marker during a drag, not two.

## 3. Abandoning Restores

- [ ] 3.1 Restore the resting representation when the drag ends without an amendment: modifier released, cancelled, or dropped at the starting price.
- [ ] 3.2 Restore it on the paths that already end a drag for other reasons — a contract change ends a drag in flight (`:230`), and the restoration must not depend on the pointer path running.
- [ ] 3.3 Prove by test that each way of abandoning a drag leaves the chart exactly as it was before the drag began.

## 4. Waiting For The Exchange Is Not Moving

- [ ] 4.1 Between the confirmed drop and the exchange's answer, draw the order once, at the price the exchange is known to hold it at, marked as being amended.
- [ ] 4.2 Draw it at the new price only when the exchange reports it there.
- [ ] 4.3 On a refusal, leave it at the price it rests at and state the refusal — the amendment path already reports one, and this is about what the chart shows while it does.
- [ ] 4.4 Prove by test that an amendment awaiting the exchange produces one line, not two, and that the line moves when the exchange reports the move.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Operator confirms on live data: dragging an order with Ctrl and with Alt shows one order moving and no copy left behind, and abandoning a drag puts it back.
