# Keep the chart where the operator left it

## Why

Every new contract or interval fitted the chart: the first series drawn for
the selection was put whole into the screen (`fitContent`), whatever zoom and
pan the operator had set. Through an interval switch that first series is
the one held from the interval being left — with its history, a thousand
bars or more — so the switch itself zoomed the chart out to the whole held
series, and the new window then landed at that zoom: eighty bars in a corner
of the screen. That was the «совершенно странное значение графика» behind
the switch's spinner (2026-09-03), and after the store made the switch
itself fast the operator asked for the rest (2026-09-04): «было бы неплохо
ещё оставлять zoom и pan в том состоянии, в котором я его оставил, чтобы
график заново не выравнивался».

The library keeps both numbers through a replacement of the series by
itself — the pixels per bar, and the newest bar's distance from the right
edge. The fit was the only thing discarding them. A chart created anew — a
workspace change, a restart of the desk, which every edit under `electron/`
causes — started from the library's defaults and fitted too.

## What Changes

- **The zoom and pan are the operator's.** The chart reads both whenever its
  visible range moves and once more before a selection change empties the
  series, shows the first series of the new contract or interval at them, and
  fits only a chart that has nothing to carry — a first chart with nothing
  remembered. The pan is carried in bars; a pan deeper into history than the
  new series reaches is clamped by the library to the series' oldest bars
  until history lands behind them.
- **The zoom and the live-edge margin outlive the chart.** They are kept in
  the browser's storage and a chart created later opens at them, on the live
  edge. A pan into history is not carried into a later chart.
- **History behind a window is asked for at once, wherever the viewport
  stands.** The opening request used to follow from the fit — the whole
  window on screen, its left edge in reach. At the operator's zoom the window
  may reach further than the screen, so a selection that holds nothing but
  its window asks on its opening evaluation regardless; the scroll trigger is
  unchanged.
- **Canon.** `futures-workstation-presentation`: the "opens on enough
  history" requirement no longer fits a new selection; a new requirement
  states the zoom and pan.

## Impact

- Renderer only: `src/utils/chartViewport.js` (new) and
  `src/components/features/futures/FuturesWorkstationChart.jsx`. No main
  process, no transport, no journal line.
- The chart test's mock of the library's time scale gains `width`,
  `scrollPosition` and `applyOptions`; its series keeps what it was handed.
- Browser storage: one key, `futuresChartViewport`.
