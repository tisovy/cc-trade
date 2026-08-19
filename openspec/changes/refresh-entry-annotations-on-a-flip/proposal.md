## Why

`separate-chart-labels-from-scale` (52f9f8d) moved the `ENTRY`/`LIQ` text off
the price lines into DOM annotations, positioned by a coordinate pass that only
writes state when something it compares changed. The gate compares `key`,
`price` and `y` — and the key is `symbol:positionSide`, which on a one-way
account reads `BOTH` in both directions.

So when the position flips short→long (or back) at the same entry price under a
still viewport, the gate finds every compared field equal and keeps the previous
annotations. The entry line's tone is redrawn from the position, but the plate
beside it still says `ENTRY SHORT` over what is now a long — and stays wrong
until the price or the viewport moves the coordinate. The 2026-08-19 audit
reproduced this with a test, and the reproduction stands in current `main`: the
flipped render keeps `aria-label="ENTRY SHORT at 59900"` with class `is-sell`.

## What Changes

- The equality gate compares everything the annotation renders — `kind`, `label`
  and `tone` alongside `key`, `price` and `y` — so a flip at an unchanged entry
  repaints the plate at once. The gate's purpose is kept: a pass that changed
  nothing still returns the previous array and no redundant state write happens.
- A chart regression flips a one-way position at the same entry price under the
  same viewport and asserts the annotation states the new side and tone.

## What this is not

Not a change to the annotation keys, the price lines, or what a flip means:
`futuresPositionIdentity` still names the exchange's own position slot, and the
lines were already redrawn correctly. Only the stale plate is addressed.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the
  `setPositionAnnotationCoordinates` equality gate.
- `src/components/features/futures/FuturesWorkstationChart.test.jsx` — the flip
  regression.
- Modifies `futures-workstation-presentation`: "Position labels are independent
  from price-scale typography" gains the flip scenario.
- No market-data, position or order behavior changes.
