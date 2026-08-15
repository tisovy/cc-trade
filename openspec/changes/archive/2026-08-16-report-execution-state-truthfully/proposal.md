## Why

The audit found that the desk can show the operator a state the account is not
in. None of these items creates a wrong order by itself, but together they make
the screen untrustworthy at the moment a trading decision is made, which is the
same reason the work cannot go live.

- The backend already sends the exchange's own `details.binanceCode`, but
  `src/components/features/futures/FuturesTradingTicket.jsx` presents only the
  local `FUTURES_API_ERROR`, so the operator cannot tell which exchange refusal
  occurred.
- A concurrent account failure hides a command rejection entirely: the rejection
  is displaced by the resource error and never read.
- The chart and the dock drop resource status and print `No working orders`
  whether synchronization has not run yet, is running, or has failed. An
  unsynchronized account looks like a flat one.
- Entry and exit intent is computed but the interface shows only LONG and SHORT,
  and a `closePosition` order can be classified on the wrong side of that.
- The order editor closes even when the send returned `false` because the
  transport was disconnected, so an unsent amendment looks accepted.
- After a reconnect the previous balance is immediately treated as ready again,
  and the age of a stale snapshot is never shown, so sizing can be computed from
  a figure of unknown age.

Spot place and cancel failures reaching the operator are covered by
`harden-trading-command-integrity` and are not restated here.

## What Changes

- A rejection presents the exchange-reported code and message alongside the
  local code, sanitized, so the operator sees what Binance actually refused.
- A command rejection and an account-resource failure are presented as separate
  facts; neither displaces the other.
- Every order surface renders the synchronization state of the orders it draws.
  "No working orders" is shown only when a successful synchronization actually
  reported none.
- Entry and exit intent is presented on order and position surfaces, and a
  close-position order is classified as an exit regardless of its side.
- A submission surface stays open and states the failure when the send does not
  reach the backend.
- After a reconnect a previously confirmed balance is stale until a new
  confirmation arrives, and its age is shown wherever it is used for sizing.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: exchange-reported failure identity is preserved to
  the operator, a rejection is never masked by a concurrent resource failure,
  and a reconnected balance is stale with a disclosed age until reconfirmed.
- `futures-order-visibility`: every order surface discloses synchronization
  state and order intent, and a submission surface cannot report success it did
  not achieve.

## Impact

- Renderer: `FuturesTradingTicket`, `FuturesWorkstationChart`,
  `FuturesPortfolioDock`, `FuturesOrderEditor`, `FuturesPositionCloser`,
  `FuturesWorkstationView`, `src/hooks/useFuturesTrading.js`,
  `src/utils/futuresOrderPresentation.js`, `src/utils/futuresReadiness.js`.
- Backend: `electron/services/binance-connection.js` only where a rejection
  detail is dropped before it reaches the renderer.
- Styling for the added status and intent affordances in the futures
  stylesheets.
- No exchange-facing behaviour changes in this change.
- Runs in parallel with `isolate-markets-and-runtime`; both are required before
  live Futures.
