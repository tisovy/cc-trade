## Why

Holding Ctrl or Alt and dragging a working order draws that one order two or
three times at once.

While a drag is in flight the chart holds, simultaneously:

- the order's own line — solid, two pixels, with an axis label — still drawn at
  its resting price from `ownedOrders`
  (`src/components/features/futures/FuturesWorkstationChart.jsx:704`), because
  nothing tells that pass an order is being dragged;
- its handle badge, still anchored at the resting price by the coordinate refresh
  (`:725`);
- the faint `WAS` marker the drag itself creates at the same resting price
  (`:808`);
- the `MOVING` line following the pointer (`:816`).

So the level the order is leaving carries two lines and a handle, and the level
it is being moved to carries one. The operator drags an order and watches a
second copy of it stay behind, looking exactly as live as it did a moment ago.

That reading is wrong in the way that matters: the order under the drag is the
one about to be replaced. Leaving a full-strength copy of it resting on the
chart says the opposite — that it is still where it was and something else is
being created.

## What Changes

- One order, one mark. While an order is being dragged, its resting
  representation — line, axis label and handle — is withdrawn, and the dragged
  representation is the only thing on the chart that stands for it.
- The level the order is leaving keeps exactly one faint, unlabelled marker, so
  the move is still readable as a move rather than as a new order appearing from
  nowhere.
- Abandoning a drag — releasing the modifier, pressing Escape, or dropping at the
  price it started from — restores the resting representation exactly as it was.
- Between the drop and the exchange's answer the order is shown once: at the
  price the exchange still holds it at, marked as being amended. It is not drawn
  at both prices, and it does not silently jump to the new price before the
  exchange has agreed to it.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: an order has one representation on the chart at any
  moment, including while it is being moved.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the overlay
  pass and the handle coordinate pass both need to know which order is under the
  drag; the drag state is already held there (`orderDragRef`, `orderDragPreview`).
- Presentation only. The drag already commits through the confirmation the
  operator answers at the cursor; nothing about what is sent changes.
- No new gesture, no new modifier: Ctrl and Alt keep the meanings they have.
