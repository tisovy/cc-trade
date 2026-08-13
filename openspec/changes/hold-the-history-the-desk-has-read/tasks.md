## 1. A Tab Selection Reads Nothing

- [x] 1.1 Stop `openHistory` from issuing a read: selecting a view sets the view and nothing else (`src/components/features/futures/FuturesPortfolioDock.jsx:87`).
- [x] 1.2 Read once when the Futures workspace opens, so the first view the operator selects is already populated.
- [x] 1.3 Keep the refresh control as the only operator-initiated read, and make it visibly the thing that re-reads.
- [x] 1.4 Prove by test that selecting each view twice, and changing contract, issues no account history command.

## 2. A Refresh Does Not Empty The Panel

- [x] 2.1 Stop `loadHistory` from clearing `orders` and `trades` when it sends (`src/hooks/useFuturesTrading.js:604`); hold them and mark the reading as refreshing.
- [x] 2.2 Replace the held rows only when an answer arrives; on failure keep them and state the failure beside them.
- [x] 2.3 Keep the plain loading state for the case where nothing has ever been read.
- [x] 2.4 Prove by test that a refresh leaves the previous rows readable, that an answer replaces them, and that a failure does not.

## 3. The Stream Maintains What Was Read

- [x] 3.1 Fold a terminal order transition from `futures_execution_update` into the held order review, keyed by the identity the read uses (`symbol` + `orderId`).
- [x] 3.2 Fold a fill into the held trade review, keyed by the trade identity, so the closed-position view reflects a position closed since the read.
- [x] 3.3 Make folding idempotent against a later read: an entry already folded in must not appear twice.
- [x] 3.4 Leave the bounded-scope statement (`contracts read`, `back to …`) truthful — a folded entry widens what the review covers, and the statement must not claim a read that did not happen.
- [x] 3.5 Prove by test that an order filled after the read appears in the review without a command being sent, and that the following read does not duplicate it.

## 4. The Reading Says Its Age

- [x] 4.1 Carry the time the held reading was taken.
- [x] 4.2 State it in the panel, in the same reading style the desk uses elsewhere (time for today, date for older).
- [x] 4.3 Prove by test that the panel states the age of a held reading.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [x] 5.2 Count the account history commands sent during a scripted sequence of tab clicks in the test, and assert the count rather than asserting the absence of a spy call.
- [ ] 5.3 Operator confirms on live data — step 5, «Обзор счёта читается один раз», in `verify-the-desk-in-one-sitting/runbook.md` for the first half (switching between the two history views is instant and does not blank the table), and step 30 п.9 for the second (an order filled after the review was opened appears in it without pressing refresh). Split across two steps because the second half needs a fill, and every step that costs money is in part 3.

## 6. Stated Limits, Not Fixed Here

- [x] 6.1 The read itself is not narrowed here — that is `keep-the-history-read-out-of-the-way`, which reads the endpoint the open view needs and lets an urgent read overtake a history fan-out.
- [x] 6.2 The held reading is per session and is not persisted across a restart. Persisting it would need a staleness rule the desk does not have yet, and a restart is already a moment where reading once is correct.

## 7. Discovered While Implementing

- [x] 7.1 Carry the fill itself on the execution report (`normalizeFuturesExecutionReport`): the stream reports the trade id, the price it printed at, what it realized and what it cost on the same message, and all four were dropped — so a fill could not be folded into the review without asking Binance for it.
- [x] 7.2 Read the desk's timestamps in one place (`src/utils/futuresDeskTime.js`): the review's age and its rows are read by the same rule — time for today, date for older — rather than each surface carrying its own copy of it.
- [x] 7.3 Perform the opening read in the workstation container, which is the only surface that knows the contract. The trading hook is mounted by the workspace and never told the symbol, so a read issued there arrives without one and the backend completes it from the *panel's* selection or refuses it outright. The attempt stays armed until a frame actually leaves, so a read that could not be sent is performed by the next usable connection.

## 8. Second Pass: A Closed Position Went Missing

The operator closed BEAT at a loss, saw the closed position in the review,
reopened the contract, and the row was gone. Three separate reasons it could be,
all of them real, all of them fixed here.

- [x] 8.1 A read replaces only the contracts it actually covered. The fan-out reads at most twelve contracts and any of them can fail; the review replaced every row with what the newer, narrower read returned, so a contract that dropped out of the read lost its whole history — including positions closed and finished with hours ago.
- [x] 8.2 The scope statement still counts reads. A row carried because this read did not look at its contract was read, so it widens "N contracts read"; a row the stream folded in did not, so it stays in "N added since".
- [x] 8.3 Contract discovery walks the last day before the rest of the week. Income is answered oldest-first from whatever start time it is given, so one walk across seven days spends its four pages on last Tuesday and never reaches this morning — an account that realizes more than four thousand times a week discovered nothing it traded today, and the review covered only the contracts it still holds a position or an order on. `getTradedSymbolPage` takes an `endTime` so the two ends of the window can be walked apart.
- [x] 8.4 Where the recent day alone fills the fan-out, the older end is not read and the review says the discovery was not complete — it stops claiming a look it did not take.
- [x] 8.5 A closed position is what was closed. A window of fills that opens while a position is already held shows less exposure than the operator has, so closing all of it reduced past what the walk could see — and that was read as a reversal, which invented a position in the opposite direction, priced at both ends, and filed it in the review beside real ones. Realized PnL settles it: a reversal realizes exactly what closing the visible part realizes, and anything else means more was closed than the fills account for. The entry of such a position comes from the realized PnL, which states the whole position's average rather than the part of it inside the window.
- [x] 8.6 Prove by test: a narrower read keeps the contracts it did not cover; a read that did cover a contract still drops a row it no longer returns; the walk reads the last day first and bounds the older walk to before it; a window opened inside a position closes the whole position and reports no reversal; a genuine reversal is still reported.
- [ ] 8.7 Operator confirms on live data — step 32, «Закрытая позиция остаётся закрытой», in `verify-the-desk-in-one-sitting/runbook.md` for the reopen (a position closed and then reopened on the same contract stays in the closed-position list), and step 5 for the sweep of the whole list (it holds no position they did not take). The sweep costs nothing, so it is read in part 1 rather than paid for again in part 3.
