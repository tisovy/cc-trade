## Why

The audit of the 2026-08-10 delivery found three ways the command path can tell
the operator something that is not true about an order.

- **An unknown outcome is cleared by somebody else's answer.** Any futures
  execution update, and any futures rejection, sets `unresolvedCommand: null`
  (`src/hooks/useFuturesTrading.js:319` and `:364`). A BTC placement whose
  outcome is unknown therefore stops warning as soon as an unrelated ETH order
  updates. The operator, seeing no warning, repeats the BTC command — which is
  precisely the second real order the unresolved state exists to prevent. The
  backend gives the renderer nothing to correlate on: the unresolved envelope
  carries only `symbol` (`electron/services/binance-connection.js:1711`).
- **Reconciliation gives up on the first "not found".** Both
  `reconcileAmbiguousFuturesCommand` (`binance-connection.js:1723`) and the Spot
  equivalent (`:1531`) loop `RECONCILE_ATTEMPTS` times, but only an *exception*
  continues the loop: a clean `exists: false` immediately calls `onAbsent()` and
  returns. Binance order state is eventually consistent after an ambiguous
  submission, so the order can appear a moment later — after the desk has
  already told the operator it is safe to resubmit.
- **Cancel all leaves ALGO orders on the exchange.** The desk lists regular and
  ALGO orders in one book (`useFuturesTrading.js:235`, fed by
  `futures-trading-adapter.js:537`), but the cancel-all path calls only
  `DELETE /fapi/v1/allOpenOrders` (`futures-trading-adapter.js:631`,
  `binance-connection.js:2109`). The operator clears a list of eight orders,
  sees it empty, and three stop orders remain live on the exchange.

## What Changes

- An unresolved command carries its own identity — symbol plus order id and
  client order id — and is cleared only by an answer bearing that identity.
  Anything else leaves the warning standing.
- Reconciliation treats "the exchange does not know this order" as provisional
  until it has been asked again, with bounded spaced retries, before it is
  reported as absent.
- Cancel-all cancels every order the desk listed for that scope, ALGO orders
  included, and reports per-kind failure rather than an unqualified success.

## Impact

- `electron/services/binance-connection.js` (unresolved envelopes,
  reconciliation loops, futures cancel-all handler),
  `electron/services/futures-trading-adapter.js` (ALGO cancellation),
  `src/hooks/useFuturesTrading.js` (correlated clearing of the unresolved
  state).
- Behaviour change visible to the operator: an unknown outcome stays on screen
  until its own answer arrives; a cancel-all that could not clear ALGO orders
  says so.
- Adds requirements to `trading-command-integrity`, alongside
  `harden-trading-command-integrity`, which introduced the capability.
- Blocks live Futures.
