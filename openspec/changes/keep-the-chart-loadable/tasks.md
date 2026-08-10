## 1. A Failed History Read Does Not Lock The Chart

- [x] 1.1 Emit a failure answer for a Spot `load_chart_history` read that could not be served, carrying the request it answers.
- [ ] 1.2 Emit the equivalent failure from the futures workstation service instead of returning silently.
- [x] 1.3 Release the Spot renderer's in-flight lock when a failure answers, so the next scroll retries.
- [ ] 1.4 Release the futures renderer's in-flight lock the same way, once 1.2 gives it something to release on.
- [x] 1.5 Tell the operator that older candles could not be loaded, once per failure rather than per scroll.
- [x] 1.6 Prove by test that a failed Spot read leaves history loadable, and that a subsequent scroll issues a new request.
- [ ] 1.7 Prove the same for the futures chart.

## 2. The Ceiling Is Enforced Where The Series Grows

- [ ] 2.1 Bound the live append path in `DataContext` to `SPOT_CHART_MAX_ROWS`.
- [ ] 2.2 Bound the futures candle history in the renderer to the same ceiling it uses on disk.
- [ ] 2.3 Prove by test that appending past the ceiling drops the oldest rows and keeps the newest.

## 3. A Month Is A Month

- [ ] 3.1 Compare calendar intervals (`1M`, and any other non-fixed step) by calendar step rather than by a fixed millisecond count in the continuity check.
- [ ] 3.2 Prove by test that consecutive monthly candles of 28, 30 and 31 days are continuous, and that a genuine gap is still detected.

## 4. A Resync Compares What It Redraws

- [ ] 4.1 Detect an interior change in a same-length, same-endpoint series before deciding to update only the last candle.
- [ ] 4.2 Keep the cheap path for the ordinary case where only the last candle moved.
- [ ] 4.3 Prove by test that a corrected interior candle reaches the chart.

## 5. The Spec States The Guarantee That Exists

- [ ] 5.1 Correct the `spot-chart-history` restart requirement to cover history pages, and state that the live bootstrap window is re-read on every start.
- [ ] 5.2 Replace the `TBD` Purpose in `openspec/specs/spot-chart-history/spec.md`.

## 6. Verification

- [ ] 6.1 `npm run lint`, `npm test`.
- [ ] 6.2 Operator confirms on live data that scrolling left recovers after a dropped connection.
