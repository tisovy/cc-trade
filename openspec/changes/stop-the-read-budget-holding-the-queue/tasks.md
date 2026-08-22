## 1. Find what actually waited

- [x] 1.1 Measure the operator's stall against the journal rather than reproducing it: `trade.setLeverage` on BEATUSDT, 26 368ms, 2026-08-22T05:11:29.765Z → 05:11:56.133Z.
- [x] 1.2 Establish the ordinary round for the same command from the same record — 377ms to 3 358ms across six days, 2 009ms on the retry two seconds later — so the stall is an outlier and not the cost.
- [x] 1.3 Find the same shape earlier: 49 576ms (leverage, 2026-08-21), 43 196ms (margin mode, 2026-08-15). All three inside one 60 000ms window.
- [x] 1.4 Rule out the exchange and the transport: no `futures-rest` fault, no timeout, no retry beside any of the three.
- [x] 1.5 Rule out the account refresh: `refreshFuturesAccountState` returns immediately when a pass is already in flight, so the command's own `await` on it cannot account for the wait.
- [x] 1.6 Reproduce the mechanism against the real class at 1/20 scale: budget spent at 51ms, urgent request admitted after 3 051ms — the whole remainder of the window — and the ordinary request behind it after 3 101ms.

## 2. Let a request that fits through

- [x] 2.1 Split taking the admission slot out of `reserve` so it can be taken more than once for one reservation.
- [x] 2.2 Check the window and book against it under the slot; wait for the window outside it.
- [x] 2.3 Keep the admission of a request heavier than the whole window, rather than sleeping on room that will not appear.
- [x] 2.4 Confirm the seven existing `RateLimiter` tests — atomicity, spacing, urgency, the bound on urgency, and all three cancellation cases — pass unchanged.

## 3. Say it in the record

- [x] 3.1 Add the `deferred` kind to the record's field table: standing, waitedMs, weight, spent, ceiling. Counts only.
- [x] 3.2 Report from `reserve` only when the budget, and not the queue, was what held the request.
- [x] 3.3 Wire the Futures read limiter to the desk's diagnostic record.
- [x] 3.4 Make a reporter that throws cost its own line and nothing else.

## 4. Prove it bites

- [x] 4.1 `lets a request the window still has room for past one waiting the window out` — fails against the code before this change (the command is never admitted; the test times out at 5 000ms).
- [x] 4.2 `says in the record when its own budget, not the exchange, held a request back` — fails against the code before this change (nothing is recorded).
- [x] 4.3 `keeps the queue moving when the record refuses the line` — a guard, not a biter: before the reporter existed it passed by having nothing to throw. Named as one in the file.
- [x] 4.4 `keeps a deferred request under its declared fields` — asserts the shape `reserve` emits against the field table that has to accept it, and that an unknown standing loses the line.
- [x] 4.5 Full suite, lint, and all four boundary checks.

## 5. Audit of this change

- [x] 5.1 The bound on urgent overtaking was being restarted by the wait: `takeAdmission` minted a fresh entry with `passes: 0` on every re-queue, so urgent work could pass the same request another eight times for every window it waited. Carried across instead.
- [x] 5.2 The invariant `nextAdmission` reads the head on — "nothing can have been passed more often than the one waiting longest" — no longer holds for a queue a request can rejoin. Restated where it is relied on rather than left as a comment that has quietly stopped being true.
- [x] 5.3 The deferral line was written while still holding the admission slot. The record opens and rolls a file of its own; a request that has already booked its weight has no business holding the queue while it does that. Moved after the slot is given back.
- [x] 5.4 `deferredFrom` used `0` for "never deferred", which is a reading the desk's own clock hands out — every test in this file starts at zero. It would have lost the line and re-sampled the spend on each pass. Sentinel is `null`.
- [x] 5.5 Three tests, all three failing against `724be7c`: `gives a request that waited the passes it had already been given`, `writes the line with the queue already moving`, `records a wait that began at zero on the clock`.
- [x] 5.6 This section was swept into a peer's commit twice on the way in — the index is shared, and
  staging is not a safe place to wait while a suite runs. Verified against the index rather than the
  working tree each time (`git archive $(git write-tree)`), and nothing was lost.

## 6. Operator verification

- [ ] 6.1 Start the desk cold and change a contract's leverage within the first minute — the change should answer in about two seconds, not tens of them.
- [ ] 6.2 Read the day's journal for `"kind":"deferred"`. Lines are expected at a cold start; what they should show is a `spent` near the 800 ceiling and an ordinary `standing`, not an urgent one.
- [ ] 6.3 If an urgent line does appear with a long `waitedMs`, the budget itself is what needs raising or spending less of — report the numbers rather than the symptom.
