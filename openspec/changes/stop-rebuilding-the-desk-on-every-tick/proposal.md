## Why

The audit found four costs paid on every market event, each of which grew by an
order of magnitude when today's changes deepened chart history and the order
book.

- **A history request can be cancelled forever by the trade stream.** The Spot
  chart effect depends on the whole `data` object
  (`src/components/features/charts/ChartWrapper.jsx:515`); every trade recreates
  it, and its cleanup cancels the pending 50 ms history debounce. On a liquid
  pair, prints arrive faster than the debounce, so the history read is never
  issued at all.
- **Every Spot trade copies the whole series and redraws everything.**
  `applyTradeToChart` copies the candle array
  (`src/context/DataContext.jsx:691`), then the chart re-runs `setData`, the
  volume series, the SMA pass and its subscriptions
  (`ChartWrapper.jsx:531`). At 5000 candles this is several O(N) passes per
  print.
- **The full book is rebuilt and sent on every depth frame.** There is no
  throttle or coalescing on the futures workstation depth path
  (`electron/services/futures-production-workstation-service.js:764`), and the
  book is now 1000 levels per side.
- **The workstation sets state during render.**
  `src/components/features/futures/FuturesWorkstationView.jsx:480` calls
  `setLastTick` in the render body. React discards the render in progress and
  runs a second pass over the whole workstation on every price tick.

## What Changes

- The Spot chart's history effect depends on what it actually reads, so an
  unrelated trade cannot cancel a pending history request.
- A live trade updates the last candle in place on the chart's own series
  rather than rebuilding derived series and subscriptions.
- Depth frames are coalesced to at most one delivered book per animation
  interval, and a frame that arrives while one is pending replaces it.
- The last-tick direction is derived without a render-phase state update.

## Impact

- `src/components/features/charts/ChartWrapper.jsx`,
  `src/context/DataContext.jsx`,
  `src/components/features/futures/FuturesWorkstationView.jsx`,
  `electron/services/futures-production-workstation-service.js`.
- No trading decision changes; what changes is how often the desk pays for one.
- Adds requirements to `futures-workstation-presentation` and
  `spot-chart-history`.
