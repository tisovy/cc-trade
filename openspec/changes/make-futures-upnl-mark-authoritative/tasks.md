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
- [ ] 4.3 Compare live row uPnL/ROE/total with Binance mark/position readings through at least one mark change and one tape-only change; keep this unchecked until the operator confirms
- [ ] 4.4 Archive only after the operator confirms live behavior; otherwise add the observed gap as a tracked task or follow-up change
