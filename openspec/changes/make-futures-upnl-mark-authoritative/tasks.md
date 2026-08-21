## 1. Authoritative valuation production path

- [ ] 1.1 Run GitNexus upstream impact for every valuation/feed/hook symbol to be edited, record direct callers and affected flows, and warn before any HIGH/CRITICAL edit
- [ ] 1.2 Introduce the coherent `PositionValuation` source ladder (live mark, qualified snapshot, unknown) in production code and verify existing position-mark tests still run without changing tests
- [ ] 1.3 Switch production row uPnL, ROE, notional, and dock aggregate to the same mark-authoritative valuation and verify a local runtime probe shows that aggTrade does not change the primary result
- [ ] 1.4 Remove carried-price and aggregate-trade-triggered valuation publications from the production feed while preserving optional tape disagreement detail, and verify mark/tape diagnostics still name distinct sources
- [ ] 1.5 Implement aggregate `{value, complete, missingCount}` semantics in expanded and collapsed dock states and verify unknown, known-empty, and partial fixtures render distinctly with the existing harness

## 2. Bounded React production work

- [ ] 2.1 Add per-symbol valuation subscriptions and memoized position rows in production code, then verify a render counter changes only the affected row and aggregate on a mark tick
- [ ] 2.2 Stabilize held-history props and derive one shared round index only when fills/income change, then verify mark ticks do not execute the round fold
- [ ] 2.3 Add a bounded accessible Closed Positions render window with stable focus/keys and verify older held rows remain reachable without an exchange request

## 3. Tests after implementation

- [ ] 3.1 Update valuation unit tests for mark-only movement, snapshot fallback, unknown inputs, short sign, and out-of-order mark/tape frames; run the focused utility suite
- [ ] 3.2 Update dock/component tests for incomplete totals, expanded unknown state, tape explanation, and shared source wording; run the focused component suite
- [ ] 3.3 Add render-count and bounded-DOM regression tests proving history does not repaint on mark ticks and run them under Vitest
- [ ] 3.4 Run the broader Futures hook/workstation/feed suites and record any baseline-only failure separately

## 4. Verification and operator gate

- [ ] 4.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-upnl-mark-authoritative --strict` and verify it passes
- [ ] 4.2 Run GitNexus `detect_changes` against `main`, confirm only valuation/feed/dock/history flows are affected, and resolve unexpected symbols before commit
- [ ] 4.3 Compare live row uPnL/ROE/total with Binance mark/position readings through at least one mark change and one tape-only change; keep this unchecked until the operator confirms
- [ ] 4.4 Archive only after the operator confirms live behavior; otherwise add the observed gap as a tracked task or follow-up change
