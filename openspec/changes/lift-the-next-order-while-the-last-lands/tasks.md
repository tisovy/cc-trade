## 1. What The Desk Owes, Per Order

- [x] 1.1 Hold outstanding obligations keyed by the order each one is for, rather than a single slot, so discharging one cannot discharge or block another.
- [x] 1.2 Refuse a second lift of the *same* order — that one is already gone from the book — while allowing a lift of any other.
- [x] 1.3 Keep one pointer to one drag: what is removed is the wait for the previous drag to land, not the ability to drag two orders at once.
- [x] 1.4 ~~Leave the backend's per-contract lane untouched~~ — **wrong, and it was the whole remaining blocker.** See §1c.

## 1b. The Chart Lets Go Of The Pointer Before The Placement Lands

Found only after the first attempt shipped and the operator reported the same
symptom. The hook was not the only gate, and it was the inner one.

- [x] 1b.1 Give the chart a settling channel beside the pointer drag, so a drag whose gesture is over stops occupying the slot `beginOrderDrag` guards.
- [x] 1b.2 Hand the settled drag's own price lines over with it rather than removing them: the level it is aimed at is uncovered until the placement is answered, and that is what the dashed mark says.
- [x] 1b.3 Draw a mark per drag — the one under the pointer and every one still settling — instead of one mark for the single slot.
- [x] 1b.4 Take every order that is off the book out of the resting-order pass, not just the one the pointer holds, so a settling order is never drawn twice.
- [x] 1b.5 End settling drags with the contract they belong to: their replacements are still owed and still travel, but their marks must not survive onto the next contract's chart.
- [x] 1b.6 Prove by test that a second drag begins while the first replacement is still travelling. **Bites:** against the pre-change chart, `onOrderLift` is called once where it should be twice — the second gesture never reached the desk at all, which is exactly what the operator saw.

## 1c. The Lane Is The Order, Not The Contract

Found after the chart fix shipped and the operator reported the same symptom a
third time, with their own case named: three orders resting side by side on one
contract. Both earlier gates were in the renderer; this one is in the main
process, and it is the one that was actually costing the move.

- [x] 1c.1 Key the command lane by the order a command names rather than by the contract it sits on, so a lift of one order does not wait on a placement for another.
- [x] 1c.2 Name an order by the exchange's id where the desk has one and by the minted client id until it does — the convention every call site already follows — and key a placement by the id it mints, which is the only name its order has until Binance answers.
- [x] 1c.3 Keep a command that names no order the desk can identify ordered against its whole contract: the alternative is ordering it against nothing.
- [x] 1c.4 State the contract-wide barrier as a rule of its own — cancel-all, leverage, margin type and position margin run alone on their contract — instead of leaving it to be a side effect of how wide the lane happened to be.
- [x] 1c.5 Prove by test that a cancellation of one order runs while a placement for another on the same contract is still travelling. **Bites:** against the pre-change registry, `expected [ 'place:start' ] to deeply equal [ 'place:start', 'lift:another-order' ]` — the operator's symptom, reproduced at the layer that caused it.
- [x] 1c.6 Prove by test that the barrier survives the narrowing. Five tests — the sweep behind a placement, an order behind a sweep, and one per contract-wide action. **Bites the obvious wrong fix, not the old code:** against a registry given order lanes and no barrier (`orderId ?? origClientOrderId ?? clientOrderId`), six tests fail, including a cancel-all running beside the placement it exists to sweep away. Against the *old* code they pass, because the contract lane was stricter than this — so they are guards there and findings only against the naive narrowing.
- [x] 1c.7 **Guard, named as one:** the explicit `CONTRACT_WIDE_TRADING_ACTIONS` set changes nothing today — none of those builders emits an order id, so they reach the contract by the fallback in 1c.3 anyway. Removing the set alone leaves all 36 tests green. It is kept because it states which actions speak for a contract, rather than leaving that to be inferred from which fields a builder happens not to set.
- [x] 1c.8 Keep the ordering guarantee that exists: two commands about one order stay serialized. The pre-existing test now names one order explicitly instead of relying on neither command naming any.

## 1d. The Pointer Is Free When The Gesture Ends

Found after the queue fix shipped and the operator reported the same symptom a
fourth time, in the words that named it: *не даёт схватить* — the second order
could not be **grabbed**, not merely could not move. Every earlier measurement
let the cancellation answer before the pointer came up, which is not how the
operator works.

- [x] 1d.1 Free the pointer slot when the gesture ends while the cancellation is still travelling, instead of holding it until the exchange answers.
- [x] 1d.2 Give each drag ownership of the price lines it drew, so handing one off the pointer takes its lines with it and more than one can be drawn at once. This is what made the two-refs-per-chart design unable to hold a second drag at all.
- [x] 1d.3 Discharge a handed-over drag when its cancellation answers: place at the price the gesture ended on, restore to the origin if it was abandoned, and draw nothing if the lift was refused.
- [x] 1d.4 Hand over on modifier release too — an abandoned drag waiting on its cancellation must not hold the pointer either.
- [x] 1d.5 End handed-over drags with the contract, whichever answer they are waiting for, and take their lines off the chart.
- [x] 1d.6 Prove by test that the next drag begins when the last gesture ended before its cancellation answered. **Bites:** against the committed chart, `expected "vi.fn()" to be called 2 times, but got 1 times` — the second `pointerdown` reached nothing, which is exactly «не даёт схватить». The test also asserts the first order is still placed, at the price the gesture ended on, once its cancellation returns.
- [x] 1d.7 **Own the measurement error that hid this three times.** The earlier tests awaited the lift before releasing the pointer, so they exercised a path the operator never takes. A drag test that does not hold the cancellation open is not testing the drag.

## 1e. The Drop Names Its Order

Found the first time the operator could actually move several orders at once,
and reported by them as orders going missing: three moved and two came back, two
moved and one came back. Every gate above this was about what could *begin*. The
accounting behind them had never had to hold two live drags, and it could not.

- [x] 1e.1 Hold the obligation per order for real: a map keyed by identity, looked up by the order the drop names, rather than a single slot the last lift overwrote. Task 1.1 claimed this was done — what was done was the *refusal* check; the record that carries the order into the drop stayed one deep.
- [x] 1e.2 Carry the order through the container. The chart named it in every drop payload it already sent; `handleOrderDrop` destructured `{ price, restored }` and dropped the name.
- [x] 1e.3 Place nothing for a drop that names an order nothing is owed for — that is a new order, not a replacement.
- [x] 1e.4 Discharge an obligation once however many times its drag ends. An order placed twice is the same accounting error as an order never placed, in the other direction.
- [x] 1e.5 Keep the pointer with the gesture in hand: a mouse reports one pointer id for every drag it makes, so a finished drag handing that id back takes the capture off the drag the operator is making now.
- [x] 1e.6 Prove by test that two orders lifted before either is dropped are both placed, each in its own size at its own price. **Bites:** `expected "vi.fn()" to be called 2 times, but got 1 times`, and the single call made was `{"price":"58500","quantity":"0.007"}` — the second order's size at the first order's price. One order wrong, one order gone.
- [x] 1e.7 Prove it at the seam as well as in the hook, in `FuturesProductionWorkstation`. **Bites:** same baseline, one placement where two were owed. This is the test that would have caught it: both sides of the seam were green throughout, because the chart's tests assert what it hands over and the hook's tests call `drop` directly.
- [x] 1e.8 Prove by test that the chart does not release the pointer out from under a live gesture. **Bites:** `releasePointerCapture` called twice with the id the operator is dragging with.
- [x] 1e.9 **Own the second measurement error.** The chart's drag tests gave each gesture its own pointer id. A mouse does not: it reports the same id every time, and the gates that were opened made two drags share it. The fourth-gate test now uses one id throughout.
- [x] 1e.10 **Guard, named as one:** the double-drop rule (1e.4) changes nothing against the old code, which emptied its single slot on the first drop and so could not place twice either. It is kept because the map does not empty itself, so without it the rule would hold only by accident.

## 2. Nothing Refuses In Silence

- [x] 2.1 Give every path out of a lift a statement — including the one that refuses because the same order is already lifted, which returned `{ ok: false }` and said nothing.
- [x] 2.2 Keep the statement's tone honest: an order that was never lifted is still on the book, and must not read like one that is gone.

## 3. Two Obligations Can Be Told Apart

- [x] 3.1 Make the alert a list rather than a single statement, each entry naming its own order, reason and price to place it again.
- [x] 3.2 Dismiss and retry per entry, so answering one does not clear the record of the other.
- [x] 3.3 Keep the rule that an unknown outcome offers no retry, per entry rather than for the surface as a whole.
- [x] 3.4 Keep the surface unmissable: a list of two is still stated over the workspace, not folded into a corner.

## 4. Verification

- [x] 4.1 `OPENSPEC_TELEMETRY=0 openspec validate lift-the-next-order-while-the-last-lands --strict` before and after.
- [x] 4.2 Measured against the pre-change hook first, with the operator's own case: lift an order, drop it, and reach for a second while the replacement is still travelling.

    **Baseline, verbatim:** `second lift = {"ok":false} | alert = null | cancels = 1`. The desk refused, sent nothing, and said nothing — which on screen is a drag that did not register. That is exactly what the operator reported.

    Three new tests, all of which describe behaviour the old hook did not have:
    - `lifts another order while the last replacement is still in flight` — now `{ok:true}` with two cancellations sent and no alert raised.
    - `states two failed replacements apart, and answers them apart` — two statements, each naming its own contract; placing one again leaves the other standing.
    - `refuses a second lift of the same order, in words` — still refused, because that order is no longer on the book, but now with a statement instead of silence.

    One existing test had to go: `lifts nothing while the desk still owes an order` asserted the limit this change removes. Its replacement asserts the opposite, and the baseline above is the record of what it used to prove.
- [x] 4.3 Full suite green — 1883 passed.
- [x] 4.4 Added as step 40 of `verify-the-desk-in-one-sitting` (renumbered by the session that owns the runbook). Not marked done there.
- [x] 4.5 Measured against the pre-change registry with the operator's own case, three orders on one contract. Baseline verbatim: `expected [ 'place:start' ] to deeply equal [ 'place:start', 'lift:another-order' ]` — the lift of the second order did not reach the exchange while the first replacement was in flight.
- [x] 4.6 Checked that nothing else depended on the contract lane's width: the local order cap was already delegated to the exchange, and the notional ceiling is evaluated per order in the renderer before anything is sent.
- [x] 4.7 Measured the order loss against the committed tree, with the operator's own case. Verbatim, at the hook: `expected "vi.fn()" to be called 2 times, but got 1 times`; the surviving placement was `{"price":"58500","quantity":"0.007"}`, the second order's size at the first order's price. Same baseline at the seam in `FuturesProductionWorkstation`.
- [x] 4.8 Runbook step 40 rewritten to check the count and the sizes, not just that the drags start. Not marked done there.
