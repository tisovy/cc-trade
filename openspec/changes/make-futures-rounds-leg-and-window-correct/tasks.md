## 1. Position identity and fold production path

- [ ] 1.1 Run GitNexus upstream impact for the round fold, trade-history read/store, execution handler, settled-money fold, hook, and history consumers; record the graph's known ESM/JSX blind spots before editing
- [ ] 1.2 Add canonical `{symbol, leg}` position keys and versioned per-key coverage metadata at production normalization/storage boundaries, then verify existing held history can be loaded or safely invalidated without losing canonical fills
- [ ] 1.3 Replace the symbol-only production round state with independent hedge-leg and `BOTH` state machines, then verify a direct runtime probe keeps simultaneous LONG and SHORT open
- [ ] 1.4 Replace percentage-of-notional consistency tolerance with exact decimal/contract-precision comparison and verify the reproduced 0.5-on-100.5 case is no longer accepted as rounding
- [ ] 1.5 Return resolved rounds and explicit unresolved segments with terminal snapshot reconciliation, then verify a stale symbol-only persisted round cannot attach to a mismatched current position

## 2. Targeted acquisition and live maintenance production path

- [ ] 2.1 Implement bounded older account-trade acquisition toward a flat boundary for only unresolved position keys and verify page-limit/retention/cancellation state remains explicit
- [ ] 2.2 Prioritize basis reads for current open positions without coupling them to the selected history tab and verify a fresh profile schedules reads only for current position symbols
- [ ] 2.3 Normalize user-stream executions into the held fill identity map and coalesce targeted gap reads, then verify duplicate REST/stream delivery changes totals once
- [ ] 2.4 Propagate per-key coverage and unresolved reasons through the hook and Closed Positions/open-settlement production models, then verify incomplete keys never emit exact closed rows or wallet results

## 3. Presentation production path

- [ ] 3.1 Update Closed Positions to key and group rounds by leg, show unresolved scope without phantom rows, and verify closing one hedge leg does not mutate the other row
- [ ] 3.2 Update current-position settlement lookup to `{symbol, leg}` and verify two hedge rows no longer receive one symbol-wide fill total

## 4. Tests after implementation

- [ ] 4.1 Add round-fold tests for simultaneous hedge legs, independent partial closes, both legs closing, timestamp ties, and one-way reversal; run the focused round suite
- [ ] 4.2 Add incomplete-window tests for exactly 1000 fills, break-even first close, scale-out/re-entry, retention exhaustion, precision tolerance, and snapshot mismatch; run the focused fold/history suite
- [ ] 4.3 Add hook/main tests for startup basis acquisition, execution insertion, gap coalescing, cancellation, persistence migration, and no-history-click updates; run the focused integration suites
- [ ] 4.4 Add Closed Positions/open-settlement component tests for per-leg identity and unresolved coverage, then run all affected component suites

## 5. Verification and operator gate

- [ ] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-rounds-leg-and-window-correct --strict` and verify it passes
- [ ] 5.2 Run GitNexus `detect_changes` against `main`, reconcile every affected round/history/open-settlement flow, and resolve unexpected symbols before commit
- [ ] 5.3 Verify on live data simultaneous LONG/SHORT, one-leg partial close, one-way reversal, and an already-open startup position without opening History; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation; carry any unproven retention/boundary case into a follow-up change
