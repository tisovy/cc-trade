## 1. Protect the Existing Baseline

- [x] 1.1 Verify the primary checkout is still on `master`, inventory the pre-existing dirty futures changes, and preserve them without reset, checkout, branch creation, or worktree creation.
- [x] 1.2 Re-run GitNexus impact analysis for every function/class/method selected for editing; record direct callers, affected processes, d=1 dependents, and HIGH/CRITICAL warnings before the first application-code patch.
- [x] 1.3 Add failing characterization tests for runtime synthetic data/execution, missing-credential startup, unconditional Spot initialization, silent account-sync failure, symbol-scoped order replacement, missing ALGO orders, MARK rendering, and per-trade tape emission.

## 2. Remove Runtime MOCK and Fail Startup Closed

- [x] 2.1 Implement and unit-test a pure `READY` / `CONFIG_ERROR` credential preflight for complete `BK`/`BS`, absent credentials, partial credentials, and retired-only configuration without exposing values.
- [x] 2.2 Emit a bounded startup envelope over the local diagnostic transport and prove missing/invalid configuration starts no Binance client, REST request, exchange WebSocket, market subscription, or trading adapter.
- [x] 2.3 Remove `USE_MOCK`, runtime fake-data generators/timers, seeded Spot/Futures account state, and simulated placement/cancel/refresh branches from the Electron application path.
- [x] 2.4 Remove synthetic initial candles and exchange filters from renderer runtime state, replacing them with explicit empty/loading/error states.
- [x] 2.5 Explicitly reject every Spot/Futures command received without an authenticated adapter; prove no synthetic execution acknowledgement can be emitted.
- [x] 2.6 Keep test fixtures and injected fake transports test-only, and add a production artifact/static regression check that fails if runtime mock symbols or helpers re-enter the application build.
- [x] 2.7 Render one sliding missing/incomplete/retired-credentials alert plus a blocking configuration screen with restart guidance and no secret material.

## 3. Restore and Lazy-Load the Last Market Workspace

- [x] 3.1 Add bounded storage helpers/tests for the last successfully activated `spot` or `futures-live` workspace and an internal `UNSELECTED` state with no Spot fallback.
- [x] 3.2 Move credential/bootstrap and market selection above market-specific providers so the stored mode is resolved before either workspace mounts.
- [x] 3.3 Extract or isolate the lightweight shared local diagnostic/control connection from Spot-specific data initialization.
- [x] 3.4 Create lazy Spot and Futures workspace boundaries and start only the active workspace's providers, account refreshes, analytics polling, requests, and stream subscriptions.
- [x] 3.5 Stop or generation-isolate all inactive-market subscriptions, timers, abortable work, and pending updates during a switch while allowing already imported code to remain cached.
- [x] 3.6 Add startup/switch tests for persisted Spot, persisted Futures, first run, invalid/unreadable storage, no transient Spot mount, first lazy switch, cleanup, and durable next-start selection.

## 4. Make Account Sync Observable and Alert on Failures

- [x] 4.1 Define and test the versioned Futures execution/account resource envelope, stable loading/ready/stale/error states, timestamps, retryability, and bounded sanitized error categories.
- [x] 4.2 Broadcast per-resource transitions from the Electron connection, retaining last-known data on refresh failure and keeping zero USDT distinct from unavailable balances.
- [x] 4.3 Track and broadcast Futures user-data-stream lifecycle failures and reconnection state instead of logging them only in Electron.
- [x] 4.4 Bridge new configuration/resource/stream/trading error transitions to the existing sliding notification system using stable fingerprints; suppress identical retry spam and re-arm after recovery.
- [x] 4.5 Keep detailed failure state and Retry visible after toast dismissal, and test missing permission, timestamp drift, network/proxy failure, command rejection, partial success, retry, recovery, and recurrence.

## 5. Synchronize and Reconcile All Open Orders

- [x] 5.1 Add account-wide regular-order and `/fapi/v1/openAlgoOrders` adapter reads with official request weights, source-qualified normalization, fixtures, and adapter tests.
- [x] 5.2 Change account refresh to independently settle balances, positions, regular orders, and ALGO orders while keeping its in-flight/rate-limit protections and never replacing unrelated symbols with a symbol-scoped snapshot.
- [x] 5.3 Reconcile source-qualified REST snapshots and authenticated stream updates, marking order state stale across stream reconnect until REST recovery succeeds.
- [x] 5.4 Update `useFuturesTrading` to consume the structured envelope, preserve account-wide source state, remove only the matching source-qualified terminal order, and expose resource freshness/errors to consumers.
- [x] 5.5 Extend hook/connection tests for regular/ALGO identity collisions, partial-source failure, selected-symbol changes, post-placement refresh, terminal updates, reconnect, and manual account refresh.

## 6. Derive Safe Readiness and Consistent Order Presentation

- [x] 6.1 Implement a pure readiness selector whose reason codes cover credential preflight, local transport, operator pause, contract/filter metadata, resource freshness, zero/insufficient funds, draft validity, and the local notional ceiling.
- [x] 6.2 Make the production heading, ticket labels, sliders, submit/gesture feedback, sliding alerts, and backend guard feedback consume the same structured readiness state.
- [x] 6.3 Project selected-symbol regular and ALGO orders from the account-wide model into both sidebar and chart without forcing `orderKind: REGULAR`.
- [x] 6.4 Preserve confirmed regular limit-order interactions and render unsupported ALGO interactions as explicitly display-only.
- [x] 6.5 Extend ticket, workstation, chart, and navigation tests for TUT-ready, sync-error, stale balance, zero funds, pause, notional-cap, partial-order, exchange-created regular order, and exchange-created ALGO order scenarios.

## 7. Remove the MARK Chart Overlay

- [x] 7.1 Run GitNexus context and upstream impact for the MARK-series creation/update/price-line symbols and confirm whether historical mark candles have any non-visual consumer.
- [x] 7.2 Remove the MARK history series, horizontal MARK line, label, updates, autoscale influence, and related accessibility text while preserving current mark price for header/account/risk use and preserving the INDEX reference.
- [x] 7.3 Remove historical mark-candle bootstrap/stream work only if task 7.1 proves it is visual-only, then update transport/service budgets and tests accordingly.
- [x] 7.4 Update chart tests to assert MARK is absent and primary candles, positions, regular orders, and ALGO orders still render correctly. (Reopened 2026-08-09 by audit: `FuturesWorkstationChart.test.jsx` contained no `mark`/`MARK`/`INDEX` assertion at all. Closed the same day by `strengthen-production-guard-verification`, which added the absence assertions. INDEX is no longer part of this task: it was deliberately removed by `improve-futures-trading-ergonomics`, so the chart tests now assert its absence too.)

## 8. Add Upstream Bounded-Tape Controls

- [x] 8.1 Extend the bounded workstation protocol with a validated `CONFIGURE_TAPE` action for throttle enabled, integer timeout `16..5000` ms, and non-negative finite minimum trade notional in USDT; update protocol size/depth tests.
- [x] 8.2 Add session-scoped effective tape settings with defaults `enabled / 250 ms / 0 USDT` and compute eligible rows using `abs(price) × abs(quantity)` before renderer delivery.
- [x] 8.3 Implement leading/trailing coalesced emission so the renderer receives at most one newest bounded tape payload per timeout window without changing raw trade freshness semantics.
- [x] 8.4 Generation-guard and clear pending tape timers on configuration change, symbol generation, resync, unsubscribe, stop, and disposal using the injected clock.
- [x] 8.5 Add workstation controls with explicit `ms` and `USDT` labels, validation feedback, effective values, symbol-independent component-lifetime state, and compatibility with the existing Pause/Resume behavior.
- [x] 8.6 Extend fake-clock service and renderer tests for burst coalescing, trailing state, threshold equality, zero threshold, invalid input, row bounds, no redundant empty emissions, symbol switch, reconnect, and teardown.

## 9. Verify, Document, and Review Scope

- [x] 9.1 Update operator documentation with mandatory `BK`/`BS`, no-MOCK fail-fast startup, retired-name migration, persisted/lazy market selection without Spot fallback, sliding diagnostics, account-wide regular/ALGO visibility, MARK removal, tape semantics/defaults, and no-secret logging.
- [x] 9.2 Run focused startup, Spot, Futures adapter/connection, storage, notification, protocol, service, hook, ticket, workstation-view, and chart tests; fix every regression in d=1 dependents.
- [x] 9.3 Run the production artifact runtime-MOCK check, repository QA target, and production build checks appropriate to the changed Electron/React boundaries.
- [x] 9.4 Re-check public Binance `exchangeInfo` for `TUTUSDT` and verify the UI consumes its current `TRADING` status, tick size, step size, and minimum notional after production startup succeeds.
- [ ] 9.5 Perform an authenticated read-only balance/position/regular-order/ALGO-order smoke test only after explicit operator approval; do not place, amend, cancel, or close any live order as a test. (Carried over 2026-08-09 into change `verify-live-futures-account-read`; it is no longer blocking this change's archival.)
- [x] 9.6 Run `gitnexus detect-changes --scope all`, confirm only intended symbols/flows changed and all d=1 dependents were updated, then review the final diff for accidental secret values.
- [x] 9.7 If the user requests a commit, stage only approved files, commit directly to `master`, and rerun `node .gitnexus/run.cjs analyze` (falling back to an available GitNexus runner only if the wrapper is incompatible) while preserving embeddings if `.gitnexus/meta.json` reports any. (No commit was requested; no staging or commit was performed.)
