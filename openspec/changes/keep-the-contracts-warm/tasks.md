## 0. Decide The Shape Before Moving Code

- [ ] 0.1 Record what one held session costs: frames per second per stream on a liquid contract, bytes, and the parse time of each, so the pool bound is chosen from a number.
- [ ] 0.2 Decide the first shipped bound and state why. Two — the shown contract and the one before it — is the smallest thing that proves the machinery and covers the switch the operator makes most.
- [ ] 0.3 Decide what a background session subscribes to, and state what it costs to promote it to shown.

## 1. A Session Stops Being The Service

- [ ] 1.1 Hold sessions in a map keyed by contract, with the shown contract named separately from the set held.
- [ ] 1.2 Replace `isCurrent(session)` with ownership by that session's own identity, so a callback of one session cannot be silenced by another being shown.
- [ ] 1.3 Route every timer, abort controller and pending queue through the session that owns it.
- [ ] 1.4 Prove by test that two sessions run at once, and that stopping one leaves the other delivering.

## 2. Selecting Is Not Subscribing

- [ ] 2.1 Deliver the held state of a selected contract immediately, without a `loading` status and without re-reading what it already holds.
- [ ] 2.2 Open the depth stream and bootstrap the book on promotion, and drop the depth stream on demotion.
- [ ] 2.3 Keep the renderer's ownership checks intact: a frame still names the request and the generation it belongs to.
- [ ] 2.4 Prove by test that returning to a held contract issues no bootstrap read and passes through no `loading`.

## 3. The Pool Is Bounded

- [ ] 3.1 Release the least recently shown session when the bound is reached, in full, through the same total release the switch uses.
- [ ] 3.2 Make the bound a stated setting rather than a constant buried in the service.
- [ ] 3.3 Prove by test that the bound holds under a long sequence of selections and that nothing is left running behind it.

## 4. Failure Is Local

- [ ] 4.1 Scope a resync, a refused frame and a lost socket to the session they happened on.
- [ ] 4.2 Prove by test that a background session's failure is invisible to the shown contract.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:circular`, `check:runtime-mock`.
- [ ] 5.2 Measure the switch: time from selection to a live desk, held versus unheld, and record both.
- [ ] 5.3 Operator confirms on live data: switching back to the contract just left is immediate, switching to a new one is no worse than today, and neither flickers between contracts.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 The trading path is untouched: it never depended on which contract is shown, and account state is account-wide already.
- [ ] 6.2 Whether the renderer keeps up when a held contract is promoted during a burst belongs to `stop-rebuilding-the-desk-on-every-tick`.
