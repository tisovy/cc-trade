## Why

Reading the account's working orders is the most expensive thing this desk does,
and it does it constantly.

`/fapi/v1/openOrders` **without a symbol** costs weight 40; with a symbol it
costs 1. The desk reads it account-wide, and reads `openAlgoOrders` beside it for
another 40. One account refresh pass is therefore 5 (balances) + 40 (regular
orders) + 40 (algo orders) + 5 (positions) = **90**, and every one of these
triggers a pass:

- every `ORDER_TRADE_UPDATE` reporting `FILLED` or `PARTIALLY_FILLED`
  (`futures-trading-adapter.js:386`) — so a market order filling in five prints
  is five triggers, coalesced into at most two passes;
- every `ACCOUNT_UPDATE` — which the exchange sends for any balance or position
  change, funding included;
- a 30-second beat while any order is working
  (`useFuturesTrading.js:761`) — 180 weight a minute on its own;
- every order placed, cancelled, repriced, every leverage or margin change.

Against 800 a minute, a desk with orders working and a position moving spends
most of its budget re-reading a list the exchange has already told it about.
Because `ORDER_TRADE_UPDATE` carries the complete order — id, symbol, side,
type, price, quantity, filled quantity, status — and the desk already normalizes
it and broadcasts it to the renderer
(`binance-connection.js:1281`). The 80 weight is spent confirming what arrived
free a moment earlier.

## What Changes

- **The working-order set is held in the main process and maintained by the
  stream.** An `ORDER_TRADE_UPDATE` that opens or changes an order updates it in
  place; one that reports it filled, cancelled, expired or rejected removes it.
  No REST read follows.
- **An account-wide order read happens for a reason, not on every event**: the
  first snapshot after activation, a user-data stream connect or reconnect, an
  operator-requested refresh, and the periodic beat that already exists while
  orders are working. A stream event never triggers one.
- **Balances and positions stay on the automatic path**, at 5 each. They are
  what a fill actually changes, and 10 weight is not what this is about.
- **Algo orders are read on their own slower beat.** The desk cannot place them
  — it only lists and cancels them — so they change when the operator uses
  Binance's own app. They are read with the full snapshot and on the beat, not
  on every event.
- **The held set says how it was last proven.** After a stream reconnect it is
  marked as needing reconciliation until a REST read succeeds, which is what the
  existing requirement already asks for.

## Trade-offs this accepts

- **A dropped stream event leaves the list wrong until the next reconciliation.**
  That risk exists today between reads; the difference is that the window is now
  the reconcile beat rather than the next fill. It is bounded by the beat, by
  the reconnect read, and by the operator's own refresh — the three paths the
  spec already names.
- **The main process now owns order state it used to pass through.** It already
  holds `futuresAccountResources`; this makes one of those resources
  stream-maintained instead of read-maintained, which is where the authority
  belongs when the exchange is pushing it.
- **An order placed from Binance's app appears on the next reconciliation, not
  instantly** — unless the exchange reports it on the stream, which it does for
  regular orders. Algo orders are the case that waits for the beat.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: working orders are maintained from the
  authenticated stream, and an account-wide order read is issued for a stated
  reason rather than on every event.

## Impact

- `electron/services/binance-connection.js` — the user-data handler folds an
  execution report into the held order set instead of asking for a refresh;
  `runFuturesAccountRefreshPass` takes which resources a pass is for.
- `electron/services/futures-trading-adapter.js` —
  `getAccountRefreshOperations` names its resources so a pass can be partial;
  `normalizeFuturesUserDataStreamEvent` stops asking for an account read on a
  fill.
- No renderer change is expected: the renderer already receives
  `futures_execution_update` for each order and the account snapshot for the
  set. If it turns out to depend on the snapshot arriving after every fill, that
  is a second defect and belongs in its own change.
