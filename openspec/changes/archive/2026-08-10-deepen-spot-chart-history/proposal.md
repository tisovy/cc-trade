## Why

The Spot chart opens on 500 candles and ends there. At the default 1h that is
three weeks — not enough to see the range the price is working in — and scrolling
left runs off the data instead of loading more.

Worse, the depth that was already being stored was thrown away. `src/utils/cache.js`
keeps candles in IndexedDB per `symbol:interval` and the chart hydrates from it
on open, but the bootstrap window then *replaced* whatever had been hydrated
(`setChart(sanitizedChartData)`), and the cache was rewritten with those same 500
rows. So the store could never hold more than the last live window, and a restart
could never show more than one.

Binance has the depth on the route the bootstrap already uses:
`/api/v3/klines` serves up to 1000 candles per call and any point in history
through `endTime`, at a weight that does not grow with the limit. Nothing new has
to be trusted, connected, or authenticated to read it. The Futures chart was
given the same depth in `deepen-futures-chart-history`; this is the Spot half,
and it is deliberately simpler: Spot has no per-event row bound to page around,
so history arrives as one message per request, and the store it reuses is the one
the Spot chart already has.

## What Changes

- **New**: a `load_chart_history` channel action carrying the pair, the interval,
  the exclusive `endTime` to read behind, and a page size bounded to what one
  klines read serves. It is Spot-scoped, so it is refused while Spot is not the
  activated market, exactly like every other Spot channel action.
- **New**: a `chart_history` channel message carrying one page of closed candles
  for the detail channel that asked for it. The read point travels back with the
  page so the renderer can tell this answer from one it has abandoned. The live
  `chart` payload, its per-tick update path and the mini-chart path are untouched.
- The bootstrap window is now **merged in front of** the depth the chart holds
  instead of replacing it, and only when that depth was read for the same pair
  and interval. This is what makes the existing cache worth anything: the run it
  hydrates survives the live window's arrival.
- Scrolling to the oldest loaded bar asks for the page behind it and prepends the
  result, moving the visible range by exactly as many bars as arrived so the bars
  under the cursor stand still. One read is outstanding at a time.
- Reading stops when the exchange answers short (the pair's history has a start)
  and when a delivered page cannot extend the series (the chart is at its
  ceiling). Either way the same read is never repeated.
- History is discarded on a pair or interval change, and a page is applied only
  if it matches the pair, interval and read point of the request being held.
- The stored run is bounded to 5000 candles per pair and interval, and every
  applied page is written back, so the next run of the app starts where this one
  left off — with no request at all.

## Capabilities

### Added Capabilities

- `spot-chart-history`: Spot chart depth, on-demand candle history, and a stored
  run that survives a restart.

## Impact

- Renderer: `src/context/DataContext.jsx` (bootstrap merge, `loadChartHistory`,
  `chart_history` handling, cache write of the merged run),
  `src/components/features/charts/ChartWrapper.jsx` (left-edge request, viewport
  preservation across a prepend), new `src/utils/spotChartHistory.js` (the merge,
  the read point, the interval table — now the single one),
  `src/utils/channels.js` (`chart_history` declared for the detail channel).
- Main process: `electron/services/binance-connection.js` — one new channel
  action, validated for pattern and bound like the others, served from the
  existing klines route at the weight the read costs, and refused unless the
  detail channel still holds the pair and interval in the request.
- No new dependency, no new route, no credentials, no protocol version to
  coordinate. Cold start is unchanged: the bootstrap still fetches its 500
  candles, and depth arrives after the first paint or straight from the store.
- The series effect already re-runs on every tick; its cost now scales with
  depth rather than with the live window, which is what the 5000-row ceiling
  bounds.
- `ChartWrapper.test.jsx` mocked `context/AlertContext` and `context/DrawingContext`
  while the component reaches both through `hooks/…`, so every render threw and
  the file's two real tests had been left skipped. The mocks now target the
  hooks and both tests run.
