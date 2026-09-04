# Tasks

## 1. The chart

- [x] 1.1 `src/utils/chartViewport.js`: `readChartViewport` (zoom off the
      visible range and the scale's width, pan from `scrollPosition()`),
      `placeChartViewport` (`applyOptions({ barSpacing, rightOffset })`),
      `createChartViewportMemory` over `localStorage['futuresChartViewport']`
      (zoom, and the margin last kept at the live edge), `browserStorage`.
- [x] 1.2 `FuturesWorkstationChart.jsx`: read on every visible-range change
      and before a selection change empties the series; place the first
      series of a selection instead of fitting it; fit only with nothing to
      carry (D2).
- [x] 1.3 The opening evaluation asks for history behind a window that holds
      no page yet, wherever the viewport stands; the scroll trigger unchanged
      (D4).

## 2. Verified

- [x] 2.1 `chartViewport.test.js` (13) and the chart's tests: the switch and
      the contract change carried, a pan into history carried in bars, a
      chart created later opening where the last was left, the memory's
      margin rule, history asked on open at a zoom narrower than the window.
      Nine of the chart's cases fail on the chart before this change.
- [x] 2.2 Full suite on the copy: four guards, build, 134 files / 3 113
      tests; eslint clean on the four files.

## 3. Live (operator, passed 2026-09-04: «да, всё работает»)

- [x] 3.1 Zoom in and leave a margin at the live edge; switch 1m → 5m → 1h:
      the held series does not jump at the switch, every window lands at the
      same bars across and the same margin, and history is behind it without
      scrolling.
- [x] 3.2 Switch contracts under the same zoom: the new contract opens at it.
- [x] 3.3 Restart the desk (`npm run e`): the chart opens on the live edge at
      the zoom and margin left, not fitted.
- [x] 3.4 Scroll a few hundred bars into history and switch intervals: the
      oldest bars of the new window sit at the right edge for a moment, then
      history fills in behind them (D3, the library's clamp).

## 4. Audit, 2026-09-04

- [x] 4.1 Library facts re-read in `lightweight-charts` 5.0.9: `_internal_update`
      keeps `_barSpacing` and only clamps `_rightOffset`; `applyOptions`
      queues `ApplyBarSpacing` then `ApplyRightOffset`, applied in order on
      the next invalidation pass, after `setData`'s synchronous point update;
      the visible logical range spans `width / barSpacing` bars. No defect.
- [x] 4.2 Every input that moves the viewport listed: the fit (removed on a
      selection), the prepend hold (kept), `shiftVisibleRangeOnNewBar` and
      the right-side compensation (keep the offset), resize (keeps spacing
      and offset), chart re-creation (the memory). Nothing else calls the
      scale. No defect.
- [x] 4.3 StrictMode's double mount: the reset effect re-runs before the
      draw, so the second chart is placed too. The opening ask on a chart
      handed history and window together fetches one page more, as the fit
      did. No defect; residuals stand as in design.md.
