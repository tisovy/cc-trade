## Why

The audit found that one network failure permanently disables chart history,
that the stated 5000-candle ceiling is not enforced on the path that grows the
series, and that two comparisons the chart makes are wrong.

- **One failed read locks history for the session.** Spot sets
  `chartHistoryRequestRef` before sending (`src/context/DataContext.jsx:908`)
  and clears it only when a `chart_history` answer arrives; the backend logs a
  klines failure and emits nothing
  (`electron/services/binance-connection.js`, klines fetch `.catch`). Futures is
  the same shape: `historyRequestRef` (`src/hooks/
  useFuturesProductionWorkstation.js:421`) is cleared on an answer, and
  `futures-production-workstation-service.js:176` returns silently on a failed
  read. After one timeout, scrolling left does nothing until the operator
  changes symbol or interval — with no message saying why.
- **The ceiling is enforced only where the series is merged.**
  `mergeSpotChartSeries` trims to `SPOT_CHART_MAX_ROWS`
  (`src/utils/spotChartHistory.js:67`), but the live append path builds
  `[...currentSeries, candle]` with no bound
  (`src/context/DataContext.jsx:157`, reached from `:710`). A long session grows
  past 5000 without limit, and the futures renderer prepends pages with no
  ceiling at all (`useFuturesProductionWorkstation.js:53`).
- **A month is not 30 days.** `SPOT_CHART_INTERVAL_MS` defines `1M` as
  `2_592_000_000` (`spotChartHistory.js:21`). The continuity check that decides
  whether two runs touch therefore sees a 31-day month as a gap and discards the
  older run.
- **A resync that changed a middle candle is ignored.** The futures chart
  compares length, first timestamp and last timestamp
  (`FuturesWorkstationChart.jsx:573`) and, finding them equal, updates only the
  last candle. A REST correction to an interior candle never reaches the canvas.
- **The spec overstates what the store guarantees.** `spot-chart-history`
  requires that "a closed candle SHALL NOT be read from the exchange twice
  across runs", but every cold start reads the live bootstrap window of 500
  candles by design. The requirement, not the behaviour, is what is wrong here.

## What Changes

- A failed history read releases the in-flight lock and tells the operator, on
  both markets; the backend reports the failure instead of returning silently.
- The candle ceiling is enforced wherever the series grows — live append and
  history prepend — not only at the merge.
- Calendar intervals are compared by calendar step, so a 31-day month is not a
  gap.
- A same-shape resync compares content, not only its endpoints.
- The `spot-chart-history` requirement is corrected to state the guarantee the
  system actually offers: history *pages* are not re-read across runs; the live
  bootstrap window is.

## Impact

- `src/context/DataContext.jsx`, `src/utils/spotChartHistory.js`,
  `src/hooks/useFuturesProductionWorkstation.js`,
  `src/components/features/futures/FuturesWorkstationChart.jsx`,
  `electron/services/binance-connection.js`,
  `electron/services/futures-production-workstation-service.js`.
- Modifies `spot-chart-history`; adds to `futures-workstation-presentation`.
- No trading path is touched.
