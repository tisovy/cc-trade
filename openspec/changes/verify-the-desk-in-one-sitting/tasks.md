## 1. The Pass Is Ready To Run

- [x] 1.1 Collect every outstanding operator-confirmation item across the open changes and record which of them a live sitting can settle.
- [x] 1.2 Write `runbook.md`: each step states the action, the expected reading, and the item it closes, ordered read-only first, then exchange cut off, then real orders.
- [x] 1.3 State the exposure of every step that places an order, before the step.
- [x] 1.4 State plainly which guarantees cannot be staged by hand, and why, rather than inventing a procedure for them.
- [x] 1.5 State which changes are not ready to verify because the work is not built.
- [x] 1.6 Write the runbook in Russian: the operator is its only executor, and a checklist that has to be translated while it is being run is a checklist that gets skipped.
- [x] 1.7 Give the session that leads the pass its own protocol — one step at a time, no batching, record verbatim, stop on a failure, warn before the steps that place orders — and a results table to fill in.

## 2. The Operator Runs It

- [ ] 2.1 Operator performs the pass front to back in one sitting and records one line per step.
- [ ] 2.2 Operator returns the record to the session working on the repository.

## 3. The Record Becomes The Marks

- [ ] 3.1 Write the record into the live-verification ledger created by `state-only-verified-completion`, naming the date, the account, and the desk revision it was run against.
- [ ] 3.2 Check the confirmation items in `send-only-the-confirmed-order`, `answer-the-command-that-asked`, `say-which-readings-are-stale`, `keep-the-chart-loadable`, `isolate-markets-and-runtime`, `verify-live-futures-account-read`, `name-the-algo-order-that-fired`, `hear-the-exchange-out` and `keep-the-contracts-warm` from that record, and only those the record supports.
- [ ] 3.3 Record the items marked `COVERED BY TEST ONLY` as exactly that in the ledger, naming the tests that cover them — a guarantee verified by test is not a guarantee unverified, and the difference belongs in writing.
- [ ] 3.4 Open a defect for every `FAIL` before checking anything else in that change.
- [ ] 3.5 When the late-frame complaint recurs, record the contract, time and desk revision, summarize that day's diagnostic record, then inspect the nearest raw `kind: "frame"` event for that contract and use that event's own `upstreamMs`, `queuedMs`, `deliveredMs` and `committedMs` to settle archived `time-the-frame-from-exchange-to-screen` 5.3. The summary's medians describe the day and SHALL NOT be attributed to the reported frame. Normal HEMIUSDT order operation on 2026-08-16 confirms no order-path regression but does not substitute for a reported-late frame.

## 4. Verification Of The Verification

- [ ] 4.1 No confirmation item anywhere is checked without a line in the ledger behind it.
- [x] 4.2 The runbook's "not ready to verify" list matches the open changes at the time the pass is run; if work landed in between, the pass covers it or the list says why not. *(Rebuilt 2026-08-16 against `openspec list`. `time-the-frame-from-exchange-to-screen` is implemented and leaves that list on archive; its complaint-specific live check is now the separate, still-open 3.5. The list separately retains the two known gaps that no change owns yet — the flat candle-freshness threshold, and the misleading wording on `TRADIFI_PERPETUAL` contracts.)*

## 5. One List, Not A Main List And Four Appendices

The runbook reached 1306 lines: thirteen numbered steps, then eleven "Дописано"
sections written by three sessions in three styles, several of which contradicted
the ordering the numbered list promised.

- [x] 5.1 Merge every appended section into the numbered list. Thirty-four steps in three parts, no appendices, no back-references to earlier steps.
- [x] 5.2 Order the parts by what they cost, not by when they were written: everything readable on a live exchange for free, then the one outage, then the steps that place real orders.
- [x] 5.3 Keep the outage single, as agreed between the two sessions that met it separately. Steps 16–20 all run inside one break, with the warning that touching the desk during it resets the reconnect ladder kept beside the step it protects. A second, short break is taken afterwards for the Spot chart, and the reason is stated rather than left as an inconsistency: switching to Spot rebuilds the market session, which is exactly what step 20 measures.
- [x] 5.4 State the price of the pass before it starts, in the terms the operator decides on: about two hours, ~34 orders, seven of which fill, ≈0.3–0.5 USDT in taker fees at a 100 USDT notional, and one uncontrolled risk — a minimum-size position held open across steps 30, 31 and 32 while the market moves. The header said "около сорока минут" and "несколько центов комиссии"; both were written when the list had thirteen steps.
- [x] 5.5 Name the one step that is riskier than the rest, rather than averaging it away: step 33 needs a stop that actually triggers, so it is the only step whose moment of execution the operator does not choose. It is last and nothing depends on it.

## 6. Audit Of The Promises Before They Reach The Operator

Every change with an open operator item was checked against the code before its
step was handed over, on the finding that one change had been asking the operator
to place a live order to verify a case it does not close.

- [x] 6.1 Two changes had no step at all despite being listed for the sitting. `let-the-stream-state-the-account` had an unlabelled section that named no change; it is now steps 30 and 34. `harden-trading-command-integrity` had nothing.
- [x] 6.2 `harden-trading-command-integrity` 7.2 cannot be run by hand, and the pass was going to be asked for it anyway. Measured three ways through a real `SocksProxyAgent`: a stopped proxy is a determinate rejection in 59 ms, a proxy frozen before its tunnel is up is a determinate rejection after 30.1 s, and only a proxy frozen with the tunnel already up gives the `ETIMEDOUT` that reaches reconciliation — a window of one round trip, 340–800 ms, opened fresh per request. Retired to `COVERED BY TEST ONLY` with the table, in that change and in the runbook.
- [x] 6.3 `answer-the-command-that-asked` 4.2 was one task making two claims of different kinds. The cancel-all half is step 29; the unresolved-outcome half is the same unstageable case as 6.2 and was already recorded as such — for a reason that was close but not the real one. The real one is now written down.
- [x] 6.4 `bootstrap-the-book-on-a-quiet-market` 4.3 was being blocked by a chart, not by a book. The 2026-08-12 pass met every book expectation and was recorded as not closing the item because the chart went stale. The threshold is still flat at `CANDLES_MS: 5_000` and the chart still leaves `live` on a contract with no trades; what changed is that it is now a label. The book is judged in step 10, the chart in step 11, and the threshold is named in the "not ready" list as having no change behind it.
- [x] 6.5 `verify-live-futures-account-read` 1.5 asks that its verification place nothing, while its 1.4 was being served by a step that places an order. Step 23 now tells the operator to skip the placement if an order is already working elsewhere, and 1.5 records the difference instead of hiding it.
- [x] 6.6 Confirm the promises that check out, rather than only reporting the ones that do not: the eight grouping steps the runbook names are exactly `GROUPING_MULTIPLIERS`; the seven account-read reasons it names are exactly the seven the desk emits; `Refusals by the code the exchange gave`, `How long commands took to answer` and `Why the account was read` are the three section titles `read-desk-record.mjs` actually prints; `liquidationPrice` is never derived in the renderer, only read from the exchange; and after a command the desk re-reads the whole account only when the stream is not carrying orders.
