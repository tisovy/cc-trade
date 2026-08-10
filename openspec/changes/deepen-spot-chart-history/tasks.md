## 1. The Merge Is the Whole Change

- [x] 1.1 Add `src/utils/spotChartHistory.js`: page size, series bound, the read point behind a series, and a merge in which the arriving run wins the overlap.
- [x] 1.2 Refuse to stitch across a hole: two runs that do not touch cannot be joined without inventing the candles between them, so the run reaching furthest into the present wins outright. A gap inside a single delivered page is the exchange's own and is kept.
- [x] 1.3 Make it the only interval table for the Spot chart — `DataContext` had its own copy, and two of them is how a gap check ends up comparing one interval's bar against another's.
- [x] 1.4 Unit-test the merge, the read point, the prepend count and the edge test: seam, overlap, hole, bound, absent side, unknown interval.

## 2. Main Process

- [x] 2.1 Add the `load_chart_history` channel action, Spot-scoped so the market gate refuses it exactly like the others.
- [x] 2.2 Validate it as strictly as the rest: symbol, interval, a positive integer read point, and a page size bounded to what one klines read serves.
- [x] 2.3 Serve it from the existing klines route with `endTime`/`limit` at the weight the read costs, and refuse it unless the detail channel still holds the pair and interval — checked again after the read, because a page answered for a selection the operator left is how one market's candles get drawn under another's.
- [x] 2.4 Send the read point back with the page, so the renderer can tell this answer from one it abandoned.
- [x] 2.5 Prove by test: the read, the delivery, refusal for another selection, refusal of an oversized page and a nonsense read point, and refusal while Spot is not the activated market.

## 3. Renderer State

- [x] 3.1 Merge the bootstrap window in front of the depth held instead of replacing it, and only when that depth was read for the same pair and interval.
- [x] 3.2 Add `loadChartHistory`: single-flight, reset on a pair or interval change, and silent once the pair's history has a start.
- [x] 3.3 Apply a page only when its pair, interval and read point match the request being held.
- [x] 3.4 Stop asking when the exchange answers short, and when a page cannot extend the series because it is at its ceiling — otherwise the same read repeats for as long as the operator sits at the left edge.
- [x] 3.5 Write the merged run back to the existing Spot candle store on every applied page and on every bootstrap, so a restart starts where the last run left off.
- [x] 3.6 Prove by test: bootstrap merged onto stored depth, one request per scroll, prepend applied, exhaustion both ways, a page for an abandoned read point ignored, and a live tick still reaching the tail while depth sits behind it.

## 4. Chart

- [x] 4.1 Request older candles when the visible range reaches the oldest loaded bar, through the existing debounced range handler.
- [x] 4.2 Move the visible range by exactly as many bars as arrived in front, after every series holds the new rows, so nothing written afterwards resets it.
- [x] 4.3 Treat a prepend as a prepend only within one selection: after a switch, the new pair's first candle is not older data arriving.
- [x] 4.4 Prove by test: the request at the edge, silence away from it, the shifted range on a prepend, and no shift on a live tick.
- [x] 4.5 Repair the test file's own mocks: it mocked `context/AlertContext` and `context/DrawingContext` while the component reaches both through `hooks/…`, so every render threw and both real tests sat skipped. Now targeted at the hooks, and both run.

## 5. Verification

- [x] 5.1 `npm test` — full suite green: 1076 passed, 86 files, nothing skipped (the two skips this change repaired included).
- [x] 5.2 `eslint` clean on every touched file; circular-import, runtime-mock, futures-boundary and trading-command-path checks pass.
- [x] 5.3 `openspec validate deepen-spot-chart-history --strict` passes.
- [ ] 5.4 Operator confirms on live data: opening a pair shows depth beyond the bootstrap window, scrolling left keeps loading without the view jumping, and a restart shows the same depth without a request.
