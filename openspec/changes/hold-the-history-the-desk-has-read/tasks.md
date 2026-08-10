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
- [ ] 5.3 Operator confirms on live data: switching between the two history views is instant and does not blank the table, and an order filled after the review was opened appears in it without pressing refresh.

## 6. Stated Limits, Not Fixed Here

- [x] 6.1 The read itself is not narrowed here — that is `keep-the-history-read-out-of-the-way`, which reads the endpoint the open view needs and lets an urgent read overtake a history fan-out.
- [x] 6.2 The held reading is per session and is not persisted across a restart. Persisting it would need a staleness rule the desk does not have yet, and a restart is already a moment where reading once is correct.

## 7. Discovered While Implementing

- [x] 7.1 Carry the fill itself on the execution report (`normalizeFuturesExecutionReport`): the stream reports the trade id, the price it printed at, what it realized and what it cost on the same message, and all four were dropped — so a fill could not be folded into the review without asking Binance for it.
- [x] 7.2 Read the desk's timestamps in one place (`src/utils/futuresDeskTime.js`): the review's age and its rows are read by the same rule — time for today, date for older — rather than each surface carrying its own copy of it.
- [x] 7.3 Perform the opening read in the workstation container, which is the only surface that knows the contract. The trading hook is mounted by the workspace and never told the symbol, so a read issued there arrives without one and the backend completes it from the *panel's* selection or refuses it outright. The attempt stays armed until a frame actually leaves, so a read that could not be sent is performed by the next usable connection.
