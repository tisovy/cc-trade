## Why

Dragging a working order is meant to lift it off the book: the order the drag
picks up is cancelled, and what follows the pointer is the order that will
replace it. The desk does neither half of that.

What it does today (`src/components/features/futures/FuturesWorkstationChart.jsx`,
`FuturesTradingTicket.jsx:324`):

- **Nothing is cancelled.** `beginOrderDrag` (`:790`) draws two price lines and
  captures the pointer. The order stays working on the exchange for the whole
  drag.
- **The drop amends.** `finishOrderDrag` (`:865`) hands the new price to the
  ticket, which calls Binance's native amendment — one call, price and quantity,
  on the same order id.
- **So the chart shows the order twice.** The overlay pass still draws the
  order's own line and axis label from the open-orders list (`:704`), the handle
  stays anchored at the resting price (`:725`), and the drag adds a faint `WAS`
  marker at that same level plus a `MOVING` line at the pointer. Two lines and a
  handle on the level being left; one line on the level being aimed at.

The operator asked for the order to be cancelled when the drag starts, and asked
twice. What is on screen contradicts that: a copy of the order sits where it was,
looking exactly as live as it did a moment ago, because it *is* still live.

## What Changes

- **Picking an order up cancels it.** The cancellation is sent when the drag
  begins. The order leaves the book, leaves the open-orders list, and leaves the
  chart, because it no longer exists.
- **What is dragged is drawn.** The order under the pointer is rendered as the
  order that will be placed — its side, its size, its price at the pointer — and
  is the only mark on the chart standing for it.
- **The drag holds an obligation.** From the moment the cancellation is
  acknowledged, the desk owes the operator an order. It discharges that
  obligation in exactly one of three ways, and never silently:
  - the drop places the replacement at the new price;
  - abandoning the drag places it again at the price it was lifted from;
  - neither could be placed, and the desk says so loudly, naming the order that
    is gone and offering to place it again.
- **A cancellation that does not succeed starts no drag.** If the exchange does
  not confirm the cancellation, the order is left alone and the drag does not
  begin — there is no state where the chart shows a lifted order that is still
  on the book.

## Trade-offs this accepts

Stated once, because they are real and the operator has chosen this shape
knowing them:

- **There is a window with no order on the book** — between the cancellation and
  the placement. On a reduce-only order protecting a position, that window is
  unprotected exposure. Native amendment has no such window.
- **Two calls can fail independently.** The placement can be refused — margin,
  the local notional cap, a filter — after the cancellation has succeeded. The
  result is an order that is gone and not replaced. This is why the obligation
  above must be stated loudly rather than logged.
- **An interrupted session leaves the order cancelled.** A crash, a dropped
  transport, or a closed window mid-drag ends with nothing on the book. The
  amendment path leaves the order untouched in all three cases.

The mitigation is not to soften the model but to make the obligation impossible
to miss: it is the one thing the operator must see if it goes wrong.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: an order lifted by a drag is cancelled and leaves
  the chart; the dragged order is drawn; the desk owes a replacement and says so
  when it cannot place one.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the drag
  begins with a cancellation and draws the order being placed rather than a line
  beside the one already drawn.
- `src/components/features/futures/FuturesTradingTicket.jsx:324` — the drop
  places an order instead of amending one; the cap and the paused-trading checks
  move to the placement.
- `src/hooks/useFuturesTrading.js` — the drag needs the cancellation's outcome,
  not just its dispatch, so the drag can refuse to start.
- This replaces the native-amendment path for drags. The amend panel, which
  reprices by typing, keeps using the amendment and is not touched.
