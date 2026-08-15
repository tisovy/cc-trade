## 1. Unambiguous Execution Outcomes

- [x] 1.1 Classify futures REST transport failures in `futures-trading-adapter.js` into determinate (the exchange answered with a business rejection) and indeterminate (request timeout, socket error, 5xx, aborted response) rather than rejecting both through one path.
- [x] 1.2 Return an explicit `UNKNOWN` outcome carrying the command's client identity for an indeterminate failure of a mutating request, instead of throwing a plain rejection.
- [x] 1.3 Apply the same classification to the Spot adapter so both markets report the same three outcomes.
- [x] 1.4 Prove by test that a 503 and a request timeout on order placement each yield `UNKNOWN`, and that a Binance business rejection still yields a determinate rejection.

## 2. Reconciliation Before Retry

- [x] 2.1 Add an order lookup by client identity to both adapters (`/fapi/v1/order` and `/api/v3/order` with `origClientOrderId`), distinguishing "order exists" from "order unknown to the exchange".
- [x] 2.2 On an `UNKNOWN` outcome, reconcile by client identity with bounded retries before any resubmission is possible, and emit the resolved execution report when the order exists.
- [x] 2.3 Treat "order unknown to the exchange" as the only condition under which the same intent may be resubmitted, and resubmit with the original client identity.
- [x] 2.4 Report an outcome that reconciliation could not resolve as unresolved to the operator, with no retry control offered.
- [x] 2.5 Prove by test that an ambiguous placement whose order exists on the exchange never produces a second submission.

## 3. Stable Command Identity

- [x] 3.1 Mint `clientOrderId` once per operator intent in `src/utils/tradingCommands.js` and carry it through every rebuild and retry of that intent instead of generating a new one.
- [x] 3.2 Pass the validated `clientOrderId` from the Spot command handler in `binance-connection.js` into `spotTradingAdapter.placeOrder`.
- [x] 3.3 Send `newClientOrderId` on Spot order placement, matching the Futures adapter.
- [x] 3.4 Prove by test that a retried Spot and Futures placement reaches the exchange with the identity of the first attempt.

## 5. Reconciliation That Cannot Be Lost

- [x] 5.1 Replace the early return in `refreshFuturesAccountState` with a queued follow-up refresh, so a refresh requested while one is running still happens.
- [x] 5.2 Stamp each account snapshot with the mutation epoch it was started under, and discard a snapshot whose epoch precedes the last confirmed mutating command.
- [x] 5.3 Apply the same queueing and epoch guard to the Spot account refresh path.
- [x] 5.4 Prove by test that a snapshot started before a place or amend cannot overwrite the state that command produced, and that the refresh following a mutating command is never skipped.

## 6. Failure Reporting Parity

- [x] 6.1 Emit a market-scoped `command_rejected` for Spot placement failures in place of the log-only handler in `binance-connection.js`.
- [x] 6.2 Emit a market-scoped `command_rejected` for Spot cancel failures in place of the log-only handler in `binance-connection.js`.
- [x] 6.3 Consume Spot rejections in the renderer so the operator sees a rejected state as Futures already does.
- [x] 6.4 Prove by test that a failed Spot placement and a failed Spot cancel each reach the operator as a rejection rather than a console entry.

## 7. Verification

- [x] 7.1 Run unit and integration suites and the production-guard checks.
- [x] 7.3 Remove the "Interim Operational Risk" section from the proposal once the guarantees hold, so the accepted risk is not carried into the archive as if it still applied.
- [x] 7.2 ~~Record a live confirmation on a single minimum-size Futures order that an induced ambiguous outcome resolves through reconciliation without creating a second order, with `FUTURES_MAX_ORDER_USDT` set.~~ **Not achievable by hand; recorded as `COVERED BY TEST ONLY` rather than handed to the operator.** Measured 2026-08-13 against this desk's own classifier (`trading-command-outcome.js`, `futures-trading-adapter.js:90`), three probes through a real `SocksProxyAgent`:

  | Proxy | What the desk gets | Classified |
  |---|---|---|
  | stopped (nothing listening) | `connect ECONNREFUSED`, 59 ms, `code: null` | determinate |
  | frozen before the tunnel is up | `Proxy connection timed out`, 30.1 s, `code: null` | determinate |
  | frozen with the tunnel already up | `ETIMEDOUT`, 20.2 s | **indeterminate** |

  Only the third row reaches `reconcileAmbiguousFuturesCommand`, and the agent opens a fresh tunnel per request (no keep-alive), so the window in which freezing the proxy produces it is one round trip to Binance — 340–800 ms on this operator's link. An operator cannot aim at it, and the branch worth the most — the exchange *has* the order — additionally requires the freeze to land after the request was relayed. The runbook says so under «Чего этот прогон закрыть не может» with the table above.

  Two things the measurement also settled, both currently safe: `DETERMINATE_TRANSPORT_CODES` never actually fires on this desk, because errors surfacing through the SOCKS agent carry no `code` at all and fall through to the `code === null → determinate` default; and that default is the correct one here, since both code-less cases are connect-phase failures where no request bytes were written.

  Held by test instead: `trading-command-outcome.test.js` (503 and timeout → `UNKNOWN`, business rejection stays determinate) and `binance-connection.test.js` (an ambiguous placement whose order exists never produces a second submission; a retried placement reaches the exchange with the first attempt's identity).

  This change therefore has no step in the runbook, and that is the finding rather than an omission: it was listed for a live sitting for three days on a promise the sitting cannot keep.
