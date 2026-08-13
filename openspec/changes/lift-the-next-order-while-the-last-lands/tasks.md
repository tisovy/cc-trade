## 1. What The Desk Owes, Per Order

- [x] 1.1 Hold outstanding obligations keyed by the order each one is for, rather than a single slot, so discharging one cannot discharge or block another.
- [x] 1.2 Refuse a second lift of the *same* order — that one is already gone from the book — while allowing a lift of any other.
- [x] 1.3 Keep one pointer to one drag: what is removed is the wait for the previous drag to land, not the ability to drag two orders at once.
- [x] 1.4 Leave the backend's per-contract lane untouched, so two moves on one contract still reach the exchange in the order they were made.

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
- [x] 4.3 Full suite green.
- [x] 4.4 Added as step 39 of `verify-the-desk-in-one-sitting`. Not marked done there.
