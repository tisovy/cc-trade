## Why

Two readings on the desk cost more than they should.

**The working-orders list overflows its rail.** Every row states its own unit —
`10983 USDT` — beside a price printed exactly as the exchange padded it,
`8.1200000`, in a column that has no room for either. The result on the live
account: the price wrapped onto a second line, the value collided with the cancel
control, and the symbol column — sized `minmax(0, 1fr)` against neighbours sized
`minmax(0, auto)` with nowrap content — collapsed to nothing. With six orders
account-wide and none on the contract on screen, not one row said which contract
it belonged to. The unit was the widest thing in the row and it was the same word
six times.

**The book does not say where the walls are.** Every level is rendered at the
same weight, so the five levels holding most of the side — the ones the book is
actually scanned for — have to be found by reading twenty numbers and comparing
them. The depth bar behind each row is scaled to the cumulative total, which
grows monotonically down the side, so it says how deep the book is, not which
level is heavy.

## What Changes

- The working-orders list in the ticket names its columns once at the head —
  `Symbol · Side · Price · USDT` — and no row repeats the unit.
- Its price is stated at the contract's own tick where the tick is known, and
  with the exchange's float padding dropped where it is not. `8.1200000` is
  three characters of information in nine.
- Its symbol drops the `USDT` quote suffix, which is the same four characters on
  every contract this desk trades. The whole name stays on the cell's title and
  on every control that acts on the contract.
- Every column is a bounded track, so a long value shortens its own cell instead
  of taking another column's width, and the cancel control keeps its place.
- The order book marks the five heaviest levels on each visible side by
  thickening the size cell alone. The price and the running total on those rows
  are unchanged: the wall is the size, and a whole bold row would make five rows
  loud rather than five walls visible.

## Impact

- Affected specs: `futures-order-visibility`, `futures-workstation-presentation`
- Affected code: `FuturesTradingTicket.jsx`, `FuturesProductionExecutionTicket.css`,
  `FuturesWorkstationView.jsx`, `FuturesWorkstation.css`, `futuresOrderBook.js`
- No trading path changes. Both are readings: nothing about what is sent to the
  exchange, or when, is different.
