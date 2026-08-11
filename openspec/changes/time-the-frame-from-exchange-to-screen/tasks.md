## 1. A Frame Carries Where It Has Been

- [ ] 1.1 Mark a frame with the exchange's own event time where the payload states one, and with the time the main process received it.
- [ ] 1.2 Mark it with the time it was queued for the renderer and the time the renderer received it.
- [ ] 1.3 Mark it with the time the desk committed it to screen, taken where the commit actually happens rather than where the state was set.
- [ ] 1.4 Keep the marks off the trading path: producing them SHALL NOT change what is delivered or when.
- [ ] 1.5 Prove by test that a delivered frame carries all five marks in order, and that a frame missing an exchange event time is still marked for the rest.

## 2. The Queue States Its Depth

- [ ] 2.1 Report the outbound queue's depth in bytes and in frames, per resource.
- [ ] 2.2 Report what was superseded and what was dropped, per resource, as counts rather than as log lines.
- [ ] 2.3 Prove by test that a stalled socket produces a rising queue reading and a superseded count, and that both return to zero when it drains.

## 3. The Record Takes The Marks

- [ ] 3.1 Add a diagnostic event kind for a frame's timing, with a recognized phase and code, so the record accepts it under the rule it already enforces.
- [ ] 3.2 Record the per-stage delays and the queue readings; record no price, size, notional or profit-and-loss value with them.
- [ ] 3.3 Sample rather than record every frame, and state the sampling rule in the code that enforces it, so the record stays inside its existing bounds at ten frames a second.
- [ ] 3.4 Keep writing the record incapable of raising into a caller or delaying a delivery, as it is today.
- [ ] 3.5 Prove by test that a timing event carrying a money value is refused or stripped, and that a record that cannot be written loses the line and nothing else.

## 4. A Burst Case With A Stated Bound

- [ ] 4.1 Build a burst case that delivers a full depth frame every hundred milliseconds at the widest legal payload, candles alongside it, and a terminal execution report during the burst.
- [ ] 4.2 Assert that the execution is applied within a stated bound, and state that bound from a measured run rather than from an estimate.
- [ ] 4.3 Assert that the book delivered during the burst is the newest one, and that what was superseded is counted.
- [ ] 4.4 Run it under the existing Vitest surface, with no browser or Electron automation runner.
- [ ] 4.5 Make it callable on its own, and add it to the aggregate verification only if it is fast enough to belong there.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, and the new burst case.
- [ ] 5.2 Record one measured run of the burst case on master before any other change in this batch lands, as the baseline the others are measured against.
- [ ] 5.3 Operator confirms that the record names the stage a late frame waited in, on a contract that actually produced the complaint.
