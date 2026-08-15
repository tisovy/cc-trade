## Why

An external audit of the delivered Futures desk found that the command path
between the renderer and Binance has no notion of an *uncertain* outcome and no
notion of command identity. Both gaps can create a second real order.

- An ambiguous transport failure is converted into an ordinary rejection.
  `httpsJsonRequest` in `electron/services/futures-trading-adapter.js` rejects a
  request timeout (`request.on('timeout')`) and every non-2xx response,
  including 5xx, through the same path. Binance states that an HTTP 503
  `Unknown error` means the execution status is unknown and *may* have
  succeeded, and that the order status must be confirmed before retrying.
  The operator sees a failed order that may in fact be live.
- Command identity is not stable. `src/utils/tradingCommands.js:45` mints a new
  `clientOrderId` on every build (`clientOrderId || createClientOrderId(...)`),
  so a retry after an ambiguous failure carries a new identity and the exchange
  cannot deduplicate it.
- Spot loses the identity entirely. The validator produces `clientOrderId`
  (`electron/services/trading-command-validation.js:142`), but the call site
  `electron/services/binance-connection.js:1196` does not pass it and
  `spot-trading-adapter.js:244` never sends `newClientOrderId`. A user-supplied
  or redelivered identifier therefore protects Futures but not Spot.
- The main process has no replay or in-flight registry. Two identical WebSocket
  frames can create two orders concurrently, and an amend and a cancel for the
  same order can execute out of order.
- Post-action reconciliation can be lost. `refreshFuturesAccountState`
  (`electron/services/binance-connection.js:872`) returns immediately when a
  refresh is already running, so the refresh that follows a place, modify or
  cancel is silently discarded. A REST snapshot started *before* the operation
  can then land after it and overwrite the current execution state with an
  older one.
- Spot place and cancel failures are only logged
  (`binance-connection.js:1205` and `:1250`). No `command_rejected` is emitted,
  which already violates the existing `futures-live-readiness` requirement
  "New operational failures produce a sliding alert".

## What Changes

- **New capability** `trading-command-integrity`, owning the guarantees that
  apply to every trading command on both markets.
- An ambiguous transport outcome produces an explicit `UNKNOWN` result, never a
  rejection. The system reconciles the order by its client identity against the
  exchange before the operator or any code path may retry.
- A command identity is minted once per operator intent and preserved across
  every retry of that intent, on both Spot and Futures, and is sent to the
  exchange as `newClientOrderId`.
- Reconciliation after a mutating command is queued rather than dropped, and a
  snapshot that began before the mutation cannot overwrite state produced by it.
- Spot place and cancel failures emit a market-scoped `command_rejected` like
  Futures already does.

## Capabilities

### New Capabilities

- `trading-command-integrity`: unambiguous execution outcomes, stable command
  identity across retries, and reconciliation that cannot be lost.

## Deferred by operator decision (2026-08-09)

The main-process replay registry and same-order serialization are deferred to
`serialize-and-deduplicate-trading-commands`. The operator judged a duplicated
WebSocket frame far less likely than an ambiguous exchange response, and chose
to close the ambiguous-response hole first. The residual risk is that two
identical frames delivered concurrently can still produce two submissions, and
that an amend and a cancel for one order can still race.

## Impact

- Execution path: `electron/services/futures-trading-adapter.js`,
  `electron/services/spot-trading-adapter.js`,
  `electron/services/binance-connection.js`,
  `electron/services/trading-command-validation.js`,
  `src/utils/tradingCommands.js`.
- Renderer: `src/hooks/useFuturesTrading.js`, `src/App.jsx` (Spot command
  submission and rejection handling), execution ticket surfaces that must be
  able to present an `UNKNOWN` outcome.
- New main-process module for the command registry; new adapter method to look
  up an order by client identity on both markets
  (`/fapi/v1/order` and `/api/v3/order` by `origClientOrderId`).
- Behaviour change visible to the operator: a timed-out submission no longer
  reports failure. It reports an unresolved outcome until reconciliation
  answers, and offers no blind retry.
- Blocks live Futures. This change is the first gate of the audit remediation
  chain and must land before `enforce-order-limits-on-every-path`.
