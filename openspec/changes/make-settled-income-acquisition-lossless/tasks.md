## 1. Dependency, API, and impact gates

- [ ] 1.1 Confirm `make-settled-income-resource-truthful` is implemented and exposes per-lane-capable coverage/state, otherwise keep this change blocked and verify no cursor migration begins
- [ ] 1.2 Confirm `charge-every-binance-retry-weight` is implemented before asserting physical request budgets, otherwise keep budget acceptance tasks blocked
- [ ] 1.3 Re-verify official Binance Income History bounds/page/limit/weight/retention semantics and record the source date; do not assume undocumented ordering
- [ ] 1.4 Run GitNexus upstream impact for the walker, adapter income page, lane store, schedule/read functions, user events, and command priority flows; warn on CRITICAL/HIGH results before editing

## 2. Lossless acquisition production path

- [ ] 2.1 Add versioned per-income-type lane state and migrate/invalidate the prior union cursor safely, then verify one failed lane cannot advance or erase another
- [ ] 2.2 Implement fixed inclusive target-window pagination with explicit page numbers, canonical dedup, and local sort, then verify a synthetic >1000-same-millisecond dataset is enumerated without cursor `+1` loss
- [ ] 2.3 Remove response-order assumptions from coverage decisions while retaining bounded diagnostics, then verify ascending and descending page fixtures produce identical canonical output
- [ ] 2.4 Carry per-lane partial/complete/target state into the aggregate resource and wallet consumers, then verify funding-current/rebate-stale does not claim complete Net

## 3. Budgeted scheduling production path

- [ ] 3.1 Map funding, fill/rebate, insurance, startup, manual, confirmation, and verification reasons to the minimum lanes in production scheduling and verify a funding event requests only `FUNDING_FEE`
- [ ] 3.2 Coalesce zero/nonzero-realized fill bursts into delayed underivable-credit lane reads and verify an opening fill can surface a late rebate without one walk per fill
- [ ] 3.3 Rotate/reconcile every required lane during periodic verification within a declared physical-weight budget and verify deferred work remains explicitly partial/queued
- [ ] 3.4 Extend bounded diagnostics/probe output with reason, lanes, pages, attempts, charged weight, coverage gained, and non-sensitive rebate symbol/trade-identity presence; verify no raw sensitive row is logged

## 4. Tests after implementation

- [ ] 4.1 Add walker/store tests for timestamp peers, fixed pages, descending order, duplicate boundaries, late rows, page bounds, retention, and one-lane failure; run focused Electron suites
- [ ] 4.2 Add scheduler tests for funding-only weight, opening-fill rebate confirmation, burst coalescing, insurance trigger, cold start, and verification rotation; run the main-process suite
- [ ] 4.3 Add physical-weight budget tests for immediate/confirm/cold/verification paths after retry accounting is live; run limiter and income suites together
- [ ] 4.4 Run command-priority, listen-key restoration, account refresh, history fan-out, and cancellation regression suites

## 5. Verification and operator gate

- [ ] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-settled-income-acquisition-lossless --strict` and verify it passes
- [ ] 5.2 Run GitNexus `detect_changes` against `main`, inspect all scheduler/admission/resource deltas, and resolve unexpected flows before commit
- [ ] 5.3 Measure live funding, opening-fill rebate, and hourly verification cycles for row completeness and request weight; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after live confirmation and record any undocumented ordering/rebate-field observation in the maintained probe journal
