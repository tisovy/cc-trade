## Why

The ticket states one balance number — `Available 267459.71 USDT` — and leaves
the operator to guess why it is not the wallet. Part of the difference is
committed to orders that have not filled, and a desk that cannot see that number
cannot tell a full wallet from a wallet that is merely booked.

The cents are noise at this size. `267459.71` is eight significant digits of
which the last two never change a decision; they cost a glance every time the
number is read, and the figure moves by whole USDT anyway.

The first attempt at the second number read the exchange's own
`openOrderInitialMargin` from `/fapi/v3/account`. On the live account it stated
`58.9k` against a list of working orders worth more than `100k`, and both figures
were correct: order *margin* is what the orders cost to hold, which at leverage
is a fraction of what they are worth, and which reduce-only exits — most of a
desk's resting orders — do not hold at all. It answers a question the operator
was not asking. The number they check is the one they can add up themselves in
the orders list.

Adding it up exposed a second fault. A stop or take-profit rests at its trigger,
and Binance sends `price: "0"` for the market-triggered kinds. The desk read only
`price` for regular orders, so those rows showed a price of `0` and a size of `0`
in the working-orders list, and would have contributed nothing to any total. An
order that cannot be valued was also valued at zero rather than reported as
unreadable, because `Number(null)` is `0`.

## What Changes

- `On order` states what the working orders are worth: the sum of the same list
  the operator reads, priced by the same helper as every row in it, so the ticket
  and a hand-sum of the column cannot disagree.
- The balance read stays on `/fapi/v3/balance`. The move to `/fapi/v3/account`
  and the `openOrderMargin` field it was made for are both dropped — nothing
  reads them now, and the account response carries a positions array this desk
  reads elsewhere.
- A regular stop or take-profit carries its trigger price, so it is priced at the
  price it actually rests at wherever an order is shown.
- An order with no price or no size is reported as unvaluable rather than as an
  order worth zero.
- Available and On order are stated in whole USDT. The cents requirement they
  were written under is reversed rather than quietly dropped.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the ticket states what the working orders
  are worth, and states funds in whole USDT rather than to cents.
- `futures-order-visibility`: an order is valued at the price it rests at, and an
  order that cannot be valued is not shown as one worth nothing.

## Impact

- Renderer: `src/components/features/futures/FuturesTradingTicket.jsx`,
  `src/utils/futuresOrderPresentation.js`.
- Main process: `electron/services/futures-trading-adapter.js` — the execution
  report carries `triggerPrice` for regular trigger orders. Additive: the field
  is absent where the exchange sends no trigger, and algo orders already stated
  their own through the overrides.
- No change to exchange request weight, cadence, routes, resource states or
  sanitized failure categories. Nothing new is requested from Binance: the total
  is computed from orders the desk already holds.
- The order editor and the chart's order lines read a regular order's `price` as
  before; only the surfaces that value an order change what they show.
