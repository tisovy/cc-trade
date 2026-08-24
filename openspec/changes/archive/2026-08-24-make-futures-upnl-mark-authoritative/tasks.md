## 1. Authoritative valuation production path

- [x] 1.1 Run GitNexus upstream impact for every valuation/feed/hook symbol to be edited, record direct callers and affected flows, and warn before any HIGH/CRITICAL edit
- [x] 1.2 Introduce the coherent `PositionValuation` source ladder (live mark, qualified snapshot, unknown) in production code and verify existing position-mark tests still run without changing tests
- [x] 1.3 Switch production row uPnL, ROE, notional, and dock aggregate to the same mark-authoritative valuation and verify a local runtime probe shows that aggTrade does not change the primary result
- [x] 1.4 Remove carried-price and aggregate-trade-triggered valuation publications from the production feed while preserving optional tape disagreement detail, and verify mark/tape diagnostics still name distinct sources
- [x] 1.5 Implement aggregate `{value, complete, missingCount}` semantics in expanded and collapsed dock states and verify unknown, known-empty, and partial fixtures render distinctly with the existing harness
- [x] 1.6 Keep mark and funding-schedule admission monotonic across delayed/untimed frames and verify the next current frame cannot cause a false settlement refresh
- [x] 1.7 Clear live marks on renderer transport loss and reject an older full-frame revision before it can delete newer symbols
- [x] 1.8 Preserve unknown valuation through margin/risk helpers and state snapshot fallback time in the Ticket
- [x] 1.9 Reset live renderer state on a new market activation, retire the old feed epoch against delayed non-empty/terminal traffic, separate restarted revision namespaces, and preserve funding event-time provenance across reconnects while accepting a fresh earlier schedule

## 2. Bounded React production work

- [x] 2.1 Add per-symbol valuation subscriptions and memoized position rows in production code, then verify a render counter changes only the affected row and aggregate on a mark tick
- [x] 2.2 Stabilize held-history props and derive one shared round index only when fills/income change, then verify mark ticks do not execute the round fold
- [x] 2.3 Add a bounded accessible Closed Positions render window with stable focus/keys and verify older held rows remain reachable without an exchange request
- [x] 2.4 Separate primary-mark aggregate subscriptions from tape-detail subscriptions and verify tape-only movement does not invalidate the aggregate

## 3. Tests after implementation

- [x] 3.1 Update valuation unit tests for mark-only movement, snapshot fallback, unknown inputs, short sign, and out-of-order mark/tape frames; run the focused utility suite
- [x] 3.2 Update dock/component tests for incomplete totals, expanded unknown state, tape explanation, and shared source wording; run the focused component suite
- [x] 3.3 Add render-count and bounded-DOM regression tests proving history does not repaint on mark ticks and run them under Vitest
- [x] 3.4 Run the broader Futures hook/workstation/feed suites and record any baseline-only failure separately
- [x] 3.5 Add lifecycle regressions for delayed retired-feed non-empty/terminal traffic followed by revision one, delayed post-reconnect schedules, and a fresh earlier funding reschedule

## 4. Verification and operator gate

- [x] 4.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-upnl-mark-authoritative --strict` and verify it passes
- [x] 4.2 Run GitNexus `detect_changes` against `main`, confirm only valuation/feed/dock/history flows are affected, and resolve unexpected symbols before commit
- [x] 4.3 Confirmed by the operator, 2026-08-24 sitting (desk revision
      `4d2cb45`): a position opened for the test read uPnL identical to the
      Binance app — "цифры одинаковые там и там" — and the tape-only case was
      seen as the chart price diverging from the mark-valued row, recognized
      as expected. The operator asked whether the update beat could drop from
      ~500 ms to 200 ms; measured answer: the row updates on `@markPrice@1s`
      arrival — the exchange's own 1 Hz mark stream, its fastest offering —
      so there is no desk-side throttle to lower, and valuing off the tape
      between marks is exactly what this change removed (the sign flip).
      Recorded in `openspec/live-verification-ledger.md`.
- [x] 4.4 Archive authorized: live behavior confirmed above; no observed gap
      remains. The 200 ms wish is answered by measurement (exchange-bound
      cadence), not tracked as a task.

## 5. Post-implementation audit

- [x] 5.1 Audit the exact committed valuation change independently across domain math, feed/funding lifecycle, and React presentation/resource boundaries
- [x] 5.2 Implement every confirmed in-scope production fix before changing its regression tests, and update the design/spec scenarios when the finding exposes a missing contract
- [x] 5.3 Add focused regressions for the confirmed fixes, then run all affected Futures suites on an isolated candidate snapshot
- [x] 5.4 Run the full repository verification, strict OpenSpec validation, and final GitNexus change detection before committing the audit fixes to `main`

### Confirmed audit scope

- [x] 5.5 Make mark liveness per-symbol and strictly advancing; make settlement detection boundary-aware and remove dead watchdog state
- [x] 5.6 Preserve same-feed revision admission across market generations while still clearing visible readings and admitting a genuinely newer feed epoch
- [x] 5.7 Stop/invalidate all shared mark and settled-income work with the final Futures consumer; send coalesced mark frames only to Futures renderers
- [x] 5.8 Keep valued DTOs out of action state, dismiss confirmed-absent position actions, and prove close direction/reduction on both renderer and backend paths
- [x] 5.9 Make margin adjustment bounds and risk provenance fail closed; make live/snapshot ROE denominators coherent
- [x] 5.10 Preserve signed tape explanation and honest aggregate provenance; make Ticket unknown/empty resource states consistent with the Dock
- [x] 5.11 Separate mark-reading freshness notifications from price/value notifications so timestamp-only frames do not recompute unchanged financial views
- [x] 5.12 Guard retired private-stream message/error callbacks before side effects and prevent a departing Futures renderer from draining queued position marks across its activation boundary
- [x] 5.13 Require backend reduction proof to come from a READY positions snapshot admitted for the current Futures activation
- [x] 5.14 Keep Ticket entry intent mode-neutral, resolve exits to the current raw `BOTH`/hedge leg, and prove both one-way signs plus hedge behavior
- [x] 5.15 Revalidate queued private-stream keep-alives at limiter execution and failure boundaries so retired jobs cannot renew or fault a replacement activation
- [x] 5.16 Project hedge exits from the named leg and lock every staged confirmation to its original contract without relying on passive-effect timing
