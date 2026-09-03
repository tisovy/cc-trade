## Context

The existing interval progress element already spans the chart frame, sits
above the canvas, and passes pointer input through. See `proposal.md` for the
presentation problem and the delta spec for the observable contract.

## Goals / Non-Goals

**Goals:**

- Reuse the existing switching-only layer to darken the chart without another
  state branch or DOM element.
- Preserve the spinner's colour, chart readability and pointer-through input.

**Non-Goals:**

- Change chart data, loading lifecycle, spinner timing, or non-switching chart
  states.
- Blur or recolour the spinner and operator-owned annotations above the canvas.

## Decisions

- Give the existing full-frame progress layer a translucent black background
  that darkens rather than lightens the chart. This naturally starts and ends
  with `intervalSwitchPending`, and its existing `pointer-events: none` keeps
  chart gestures available.
- Keep the current stacking level. It veils the chart canvas while the spinner
  remains part of the same foreground layer and operator annotations retain
  their established higher stacking order.
- Do not use `filter` or `backdrop-filter`: either can recolour the spinner,
  create a new compositing cost over the live canvas, or make the result depend
  on platform rendering support.

- The held series outlives the switch flag when the local link fails. The
  hook ends the switch wait on a local close or error so the veil and ring
  leave; the view then keeps the series it holds while
  `resources.status.connected` is not true, drawn under the link's state —
  `DISCONNECTED chart` or `UNAVAILABLE chart` in the reading notice, a pick
  still armed on it. Before this the chart went blank behind «No candle has
  arrived for this contract yet» — a notice that was false — until the
  workstation subscribed again, while the canon already promised that the
  retained chart states the failure. On a live link a series at another
  interval outside a switch is still not this selection's: the burst harness
  replays 1m frames under a 15m selection and must read live.
- The archive of `switch-the-interval-without-leaving-the-desk` merged «An
  interval change touches only the candles» while «The chart opens on enough
  history to read the market» still said the series being replaced is cleared
  before paint and no frame shows the previous interval's candles. Both
  requirements are carried here so the canon says one thing.

## Risks / Trade-offs

- [The dark veil is too opaque and hides candle shape] → Use a translucent fill
  and cover its declaration with a focused presentation test; tune visually
  during operator verification.
- [The veil looks like a disabled chart] → Preserve pointer input and the
  visible spinner so the state reads as temporary progress rather than a
  blocked control.

## Audit 2026-09-03

Read on a `git archive` copy of `769208e`. The history fix (`1470f06`) is the
patch written for it in the previous session, byte for byte; the journal after
its deploy shows every first `candle-history` read after an `interval-shown`
starting after the new window's `contract-klines` (9 of 9 within fifteen
seconds; before the fix it started ~30 ms after the click). Switches without a
history read in the window are served from the renderer's disk cache, which
writes no journal line. The veil layer sits at `z-index: 5` in the chart
frame: the owned-order layer (7) and the feed notice (6) stay above it; the
reading, history and state overlays (4) are dimmed with the canvas, and the
gesture hint (5, earlier in the document) paints beneath it — the dark look
the operator asked for. One defect, fixed here: a local close or error during
a switch blanked the chart (task 1.2). Suite on the copy 3 028/3 028 before
the fix, then the focused suites with the three new tests; eslint, the four
guards and the build green.
