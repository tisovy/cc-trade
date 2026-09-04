# Design — keep the chart where the operator left it

## Code map

- The chart: `FuturesWorkstationChart.jsx`. A selection change is a new
  `measurementGeneration` (symbol + interval). The layout effect on it
  empties both imperative series before paint; the passive reset effect
  drops the per-selection refs; the draw effect (`[candles,
  measurementGeneration]`) plans the redraw, holds the viewport through a
  prepended page (`countPrependedRows` + `setVisibleLogicalRange`) and, until
  this change, fitted the first non-empty draw of every selection
  (`hasFittedContentRef` reset on the generation → `fitContent()`).
- History: the effect on `[historyExhausted, oldestCandleTime,
  onLoadHistory]` subscribes `handleRangeChange` to the visible logical range
  and evaluates it once directly; the condition was `range.from ≤
  HISTORY_PREFETCH_BARS` (12) in both paths.
- The library (lightweight-charts 5.0.9): the time scale holds the zoom as
  `_barSpacing` and the pan as `_rightOffset`. `setData` on a series keeps
  both (`updateTimeScale` compensates only bars added on the right;
  `_correctOffset` clamps the offset to `[firstIndex − baseIndex − 1 + min(2,
  points), width / barSpacing − min(2, points)]`). `fitContent` sets bar
  spacing to `width / count` and the offset to the option's default.
  `timeScale.options().barSpacing` is the option, not the current zoom;
  `scrollPosition()` is `_rightOffset`; `applyOptions({ barSpacing,
  rightOffset })` sets both, bar spacing first.

## D1 — The viewport is two library quantities, read and set as such

`src/utils/chartViewport.js`:

- `readChartViewport(timeScale, drawnRows)` → `{ barSpacing, offset }` or
  `null`. The pan is `scrollPosition()`. The zoom has no getter: it is read
  off the visible logical range, which spans `width / barSpacing` bars —
  `barSpacing = width() / (to − from + 1)`. `null` while no series is drawn,
  or when any of the three readings is missing or not finite.
- `placeChartViewport(timeScale, viewport)` → `timeScale.applyOptions({
  barSpacing, rightOffset: offset })`; `false` when there is nothing to
  place, for the caller to fit.

No arithmetic on the way back: an earlier cut derived a logical range from
the bar spacing and the row count and lost the last bits of the division.

## D2 — When it is read, when it is placed

- Read on every visible-logical-range change (`noteViewport`, subscribed
  beside the coordinate refresh), and once more in the generation's layout
  effect before the series is emptied — the last state of the series being
  replaced, whether or not the library has fired the range event for it.
- Placed where the fit was: the first non-empty draw of a selection
  (`viewportPlacedRef`, reset with the generation). Through an interval
  switch that draw is the held series — the same rows, the same viewport, a
  no-op on the screen — and the window that replaces it inherits both from
  the library. Through a contract change the chart is emptied first, so the
  placement lands on the new contract's window.
- Fitted only when there is nothing to place: `viewportRef` empty and
  nothing remembered — a first chart on a first run.

## D3 — The pan is carried in bars

The newest bar stands the same number of bars from the right edge on the new
series. At the live edge that is the margin the operator keeps; across
intervals it is what the library does by itself. Scrolled into history, the
same number of bars is a different stretch of time on another interval, and
a pan deeper than the new series reaches (an eighty-bar window) is clamped
by the library to `−(points − 2)`: the oldest bars at the right edge, air to
the left, until the history the chart asks for at once lands behind them —
and the hold through that prepend keeps the clamped position, not the
deeper one. Accepted: the operator's case is the live edge; the clamp is
the library's own scrolling limit; a time-based pan would need the new
series to cover the time, which its window does not.

## D4 — History is asked for at once, wherever the viewport stands

`handleRangeChange(range, opening)`. The subscription passes the range
alone. The opening evaluation passes `opening = true`, and while the
selection holds nothing but its window (`historyBehindRef`, reset with the
generation, set when a draw prepends rows) it asks regardless of the range
— the canon's «opens on enough history» used to be a side effect of the
fit. Once a page is behind the window the range rules on both paths, as
before. The hook refuses a read behind a foreign series through a switch and
offers the read again when the series lands, so the ask on the held series
costs nothing and the ask on the landed window is made.

A page whose first drawn row did not survive counts as no page (the
prepend count is zero) and the next opening evaluation asks once more: one
extra page in a corner, never a missing one.

## D5 — What outlives the chart

`createChartViewportMemory(storage)` over `localStorage['futuresChartViewport']
= { barSpacing, margin }`. `note(viewport)` on every range change: the zoom
as read; the margin the offset when the newest bar is on screen (`offset ≥
0`), else the margin last kept — written only when the record changes.
`opening()` is what a chart created later opens at: the live edge, at that
zoom and margin; `null` when nothing is remembered or the record cannot be
read, and the chart fits. Storage refused or full: the memory keeps its own
copy for the session. One key, one chart per desk.

## D6 — The mock

The chart test's time scale mock gains `width()` (1200), `applyOptions`, and
`scrollPosition()` derived the way the library defines it — the visible
range's right border past the newest bar of the series drawn — from the data
the mock's series now keeps (`setData` stores what it was handed, so a
test's `mockClear` does not empty the chart). Tests assert the options the
chart applies, and that the hold's `setVisibleLogicalRange` is not used to
place.

## Residuals

- The clamp of D3.
- The bar spacing is remembered in CSS pixels; a window-level zoom
  (`ui-scale`) rescales the page and the chart with it, so the same number
  means the same look.
- The memory lives in the Electron partition's local storage; a desk started
  with another `userData` opens fitted once.
