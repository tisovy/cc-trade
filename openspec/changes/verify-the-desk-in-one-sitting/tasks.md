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
- [ ] 3.2 Check the confirmation items in `send-only-the-confirmed-order`, `answer-the-command-that-asked`, `say-which-readings-are-stale`, `keep-the-chart-loadable`, `isolate-markets-and-runtime` and `verify-live-futures-account-read` from that record, and only those the record supports.
- [ ] 3.3 Record the items marked `COVERED BY TEST ONLY` as exactly that in the ledger, naming the tests that cover them — a guarantee verified by test is not a guarantee unverified, and the difference belongs in writing.
- [ ] 3.4 Open a defect for every `FAIL` before checking anything else in that change.

## 4. Verification Of The Verification

- [ ] 4.1 No confirmation item anywhere is checked without a line in the ledger behind it.
- [ ] 4.2 The runbook's "not ready to verify" list matches the open changes at the time the pass is run; if work landed in between, the pass covers it or the list says why not.
