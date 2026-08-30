## 1. Operator-Owned Live Verification

- [x] 1.1 Compare at least four naturally occurring USDT Closed Positions with Binance, including partial-close and one-way reversal cases when available; record symbol, leg, approximate close time, visible cents, exact title value, Binance value, and pass/mismatch/N/A in `openspec/live-verification-ledger.md`. Confirmed 2026-08-25 twice (rows agree against the net; a BNB row to the cent); per-row transcript not taken, stands on the operator's word — ledger, B3 answered
- [ ] 1.2 Verify simultaneous LONG/SHORT leg ownership and an already-open startup position without first opening History when those cases naturally occur; record separate primary/auxiliary PnL ownership and pass/mismatch/N/A in the ledger
- [x] 1.3 Observe a funding or opening-fill rebate/credit confirmation from pending debt through delayed settled refresh, and record posting latency, completeness, duplicate-request evidence, and whether the two-minute horizon was sufficient. Confirmed 2026-08-30: three funding boundaries in one day's journal (00:00Z, 16:00Z, 20:00Z), each a `reason: funding` pass ~2 s after the boundary arming the debt (`partialKind: debt-only, awaitingLanes: 1`) and one `reason: confirm` pass at +2:00 clearing it (`awaitingLanes: 0`) — no duplicate confirm, two-minute horizon sufficient; operator watched the sitting and confirmed the funding appeared — ledger, The 2026-08-30 Operator Sitting
- [x] 1.4 Restart after settled data has been acquired, then exercise success → failed refresh → recovery and a same-shape correction when naturally available; record readiness, coverage, timestamps, retained exact values, and UI truthfulness. Restart half 2026-08-24; failure→recovery half 2026-08-25 (proxy stop 07:26:03Z, honest ↻ failure, first ok 07:26:21Z, no restart). Same-shape correction has not occurred naturally and stays watched — ledger, The 2026-08-25 Operator Runbook Pass
- [ ] 1.5 Record USDC-settled Closed Positions and Futures BNB commission as operator-confirmed not applicable, while citing the deterministic fixture coverage that keeps those code paths regression-tested

## 2. Read-Only Diagnostics And Performance

- [ ] 2.1 Run the canonical per-asset settled-income probe without account mutation; record missing attribution evidence and commission-rebate posting delay using sanitized counts/times only
- [ ] 2.2 Observe live Binance request weight, limiter latency, command priority, hourly verification cycles, and `429` rate after deployment; compare with the pre-deployment ledger evidence and record the revision/environment
- [ ] 2.3 Measure durable confirmation-debt persistence with an operator-like resource and the admitted per-lane ceiling; record row count, serialized byte size, and elapsed time without monetary payloads
- [ ] 2.4 If an operator-like write exceeds 16 ms, or any admitted write exceeds 10 MiB or 50 ms, create and validate a separate OpenSpec implementation proposal for a durable scalar-debt sidecar or equivalent format revision

## 3. Evidence And Completion

- [ ] 3.1 Map results for archived tasks `charge-every-binance-retry-weight` 3.3–3.4, `make-futures-rounds-leg-and-window-correct` 5.3–5.4, `make-futures-wallet-net-additive` 4.4 and 5.3–5.4, `make-settled-income-acquisition-lossless` 5.3–5.4, and `make-settled-income-resource-truthful` 5.3–5.4 into dated ledger rows
- [ ] 3.2 Keep this change active until the operator confirms every naturally available case and explicitly accepts each unavailable case as N/A; verify the ledger names the tested revision and does not present archive completion as live proof
