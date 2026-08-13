## 1. A Failed History Read Does Not Lock The Chart

- [x] 1.1 Emit a failure answer for a Spot `load_chart_history` read that could not be served, carrying the request it answers.
- [ ] 1.2 Emit the equivalent failure from the futures workstation service instead of returning silently.
- [x] 1.3 Release the Spot renderer's in-flight lock when a failure answers, so the next scroll retries.
- [ ] 1.4 Release the futures renderer's in-flight lock the same way, once 1.2 gives it something to release on.
- [x] 1.5 Tell the operator that older candles could not be loaded, once per failure rather than per scroll.
- [x] 1.6 Prove by test that a failed Spot read leaves history loadable, and that a subsequent scroll issues a new request.
- [ ] 1.7 Prove the same for the futures chart.

## 2. The Ceiling Is Enforced Where The Series Grows

Measured before building (`buildVolumeHistogramPresentation`, the O(n) pass every
full redraw makes, node 24):

| rows | one redraw pass | series held |
|------|-----------------|-------------|
| 1 000 | 0.06 ms | 109 KiB |
| 5 000 (ceiling) | 0.23 ms | 546 KiB |
| 20 000 | 1.13 ms | 2 196 KiB |
| 40 000 | 2.23 ms | 4 403 KiB |

How long the unbounded paths take to get there: live append alone crosses 5 000
after 2.8 days at 1m, 13.9 days at 5m, 41.7 days at 15m — a desk left open, not a
hypothetical. History prepend gets there far faster: a page is 1 000 rows, so
five scrolls into the left edge crosses it.

- [x] 2.1 Bound the live append path in `DataContext` to `SPOT_CHART_MAX_ROWS`.
- [x] 2.2 Bound the futures candle history in the renderer to the same ceiling it uses on disk.
- [x] 2.3 Prove by test that appending past the ceiling drops the oldest rows and keeps the newest.
- [x] 2.4 Stop the futures chart asking again for a page the ceiling will drop. Found by audit of 2.2: the read is issued from the oldest row on the chart, so once the ceiling holds that row still, the same page is requested, delivered and dropped on every scroll into the edge. Spot already had this guard; futures did not.

## 3. A Month Is A Month

Measured before building: `spotChartIntervalSeconds('1M')` was a flat 30 days.
That is longer than February and shorter than January, so it never hides a real
gap — it invents one. Put to the 11 seams of 2023, **6 of them discarded the run
behind the seam**: Jan→Feb, Mar→Apr, May→Jun, Jul→Aug, Aug→Sep, Oct→Nov. A
monthly chart lost its loaded history to the calendar seven times a year.

- [x] 3.1 Compare calendar intervals (`1M`, and any other non-fixed step) by calendar step rather than by a fixed millisecond count in the continuity check.
- [x] 3.2 Prove by test that consecutive monthly candles of 28, 30 and 31 days are continuous, and that a genuine gap is still detected.
- [x] 3.3 Open the next monthly candle by the calendar too. Found while doing 3.1: the same 30-day constant was counted in `applyTradeToChart`, so a print on 1 April opened a bar dated 31 March — a candle at a date the exchange has none for. Proved by test against the old code: it opened `2024-03-31`, not `2024-04-01`.

## 4. A Resync Compares What It Redraws

Measured before building. The cheap path is worth keeping — a full redraw is
0.23 ms of volume presentation at the ceiling, before the two `setData` calls —
and the comparison that earns it is far cheaper than what it saves:

| comparison over 5 000 rows | cost |
|-----------------------------|------|
| endpoints and length only (before) | 0.03 µs |
| identity, then values where identity differs | 20 µs |
| worst case, every row a new object | 63 µs |

`planSpotSeriesDraw` could not be reused as it stood: it decides by row
identity, and a futures candle frame is parsed off the wire, so **every** row in
it is a new object even where the market did not move. Identity alone would have
called every tick a full redraw. Asking identity first and comparing values only
where it differs keeps the cost at the 80 rows the live window actually re-sends.

- [x] 4.1 Detect an interior change in a same-length, same-endpoint series before deciding to update only the last candle.
- [x] 4.2 Keep the cheap path for the ordinary case where only the last candle moved.
- [x] 4.3 Prove by test that a corrected interior candle reaches the chart.
- [x] 4.4 Reuse one planner for both markets rather than two: `planSpotSeriesDraw` and `countPrependedRows` moved out of `spotChartHistory.js` into `chartSeriesDraw.js` as `planSeriesDraw` and `countPrependedRows`, taking where open time is kept and how two rows are compared. Callers updated: `ChartWrapper.jsx`, `RSIPane.jsx`, and `FuturesWorkstationChart.jsx`, which drops its own `canUpdateLastRow`, `countPrependedRows` and `rememberRows`.
- [x] 4.5 Prove by test that a sliding live window with history in front of it is redrawn. Same endpoints, same length, one row gone from the middle — the shape the old comparison read as a tick.

## 5. The Spec States The Guarantee That Exists

- [x] 5.1 Correct the `spot-chart-history` restart requirement to cover history pages, and state that the live bootstrap window is re-read on every start.
- [x] 5.2 ~~Replace the `TBD` Purpose in `openspec/specs/spot-chart-history/spec.md`.~~ Already written; nothing left to replace.

## 6. Verification

- [x] 6.1 `npm run lint`, `npm test` — 108 files, 1757 tests, clean. `check:circular`, `check:runtime-mock`, `check:futures-production`, `check:command-path` all pass.
- [ ] 6.2 Operator confirms on live data that scrolling left recovers after a dropped connection.
- [ ] 6.3 Operator confirms on live data that a monthly chart keeps its loaded history across a 31-day month.

## 7. Every Test Was Run Against The Code Before The Fix

Each test below was run in a copy of `HEAD` (`git archive`, `node_modules`
symlinked) before the fix landed, and failed there:

- `redraws a candle a re-read corrected inside the series` — updated the last bar only.
- `redraws when the live window slid under the history in front of it` — same.
- `drops the oldest bar when a print opens one past the ceiling` — 5 001 rows.
- `drops the oldest bar when the stream opens one past the ceiling` — 5 001 rows.
- `holds the run to the ceiling the disk cache uses` — 6 000 rows.
- `opens a monthly candle on the first of the month` — opened `2024-03-31`.
- the monthly continuity seams — 6 of 11 seams of 2023 discarded the run behind them.

Two tests do not bite and are kept as guards, not proofs: `still writes the last
bar alone when only the last bar moved` (4.2 — the cheap path was already there,
and the point is that it survived) and the identity/`timeOf` cases in
`chartSeriesDraw.test.js` covering a caller whose rows do not survive the frame.
