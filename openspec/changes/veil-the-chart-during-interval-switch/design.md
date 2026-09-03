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

## Risks / Trade-offs

- [The dark veil is too opaque and hides candle shape] → Use a translucent fill
  and cover its declaration with a focused presentation test; tune visually
  during operator verification.
- [The veil looks like a disabled chart] → Preserve pointer input and the
  visible spinner so the state reads as temporary progress rather than a
  blocked control.
