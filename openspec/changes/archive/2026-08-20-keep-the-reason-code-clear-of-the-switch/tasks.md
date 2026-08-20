# Tasks

Layout claims below are measured in headless Chromium against the audit
fixture (`scratchpad/header-audit/fixture-reason.html`, CSS re-copied from this
tree), never in jsdom — jsdom has no layout.

## 1. Reproduce

- [x] 1.1 Reproduce the overlap before touching anything.
  `chromium --headless --window-size=1366,768` on the pre-fix CSS snapshot:
  switch `[−1..34, 604..762]`, reason `[17..35, 317..790]` — the switch sits on
  the reason across x 604..762 × y 17..34. At 1920×993: switch
  `[−1..34, 881..1039]`, reason `[17..35, 469..942]` — 61px of x-overlap, same
  y band. The defect exists at both target widths, not only "around 1366".

## 2. Fix

- [x] 2.1 First shape tried and rejected on measurement — desktop
  `flex-wrap: wrap` + `width: 100%` on the reason. The reason moved below the
  switch (top 45) but the workstation's identity row stayed 52px and the
  reason bled 11px into the clock row: a wrapped flex container's intrinsic
  height is measured as a single line (the percentage width never resolves
  during track sizing). Measured, not guessed: computed identity height stayed
  `38px` (= its min-height) with `scrollHeight` 63.
- [x] 2.2 Second trap found with a property-bisection probe: a stripped desk
  sized the row correctly (74.19px), the full desk did not — the desk grid is
  window-bound (`height: calc(100vh − 90px)`), its auto rows collapse to
  minimum contributions, and a specified `min-height` *replaces* the
  content-based automatic minimum. The strip's 38px stature floor was the cap.
- [x] 2.3 Final shape in `FuturesWorkstation.css`, `@media (min-width: 845px)`:
  the identity strip becomes a two-row grid
  (`max-content max-content minmax(0, 1fr)`, gap `16px 12px`), the reason takes
  `grid-row: 2; grid-column: 1 / -1`, the scale control keeps the top-right
  (`justify-self: end`), and `:has(.futures-workstation-reason)` returns
  `min-height` to `auto` so the content minimum carries the second row into the
  track. The switch itself is untouched; the workstation's
  `grid-template-rows`/`height` budget declarations are untouched (owned by the
  change in flight for the `has-market-clock` grid).

## 3. Verify after

- [x] 3.1 1366×768: switch `[−1..34, 604..762]`, reason `[49..67, 31..1335]` —
  no intersection, 15px vertical gap, `elementFromPoint` at the reason's centre
  returns the reason code. Identity row 74.19px, reason contained (bottom 67 <
  74), clock row moved cleanly below `[75..119]`.
- [x] 3.2 1920×993: switch `[−1..34, 881..1039]`, reason `[49..67, 183..1737]`
  — no intersection, 15px vertical gap, reason fully visible.
- [x] 3.3 Healthy strip unchanged: fixture without a reason at 1366×768
  measures identity `[0..52]`, grid row `52px` — byte-identical numbers to the
  pre-fix baseline.
- [x] 3.4 Below the breakpoint unchanged: at 800px wide the pre-existing
  mobile rules govern (43px padding-top; reason `[81..99]` vs switch
  `[−1..34]`, no overlap); the new block is gated `min-width: 845px` and
  cannot leak there.

## 4. Guard

- [x] 4.1 Stylesheet guard added to `FuturesWorkstationView.test.jsx`
  (`gives the degradation reason its own desktop row clear of the mode
  switch`): asserts the desktop grid, the `:has` min-height release, and the
  reason's row placement inside the `min-width: 845px` block.
- [x] 4.2 Verified the guard bites: with the CSS change stashed
  (`git stash push -- …FuturesWorkstation.css`) the test fails at
  `toContain('display: grid;')`; with the change restored it passes. The guard
  is a tripwire — the Chromium rects above are the evidence.

## 5. Suite

- [x] 5.1 `npx vitest run src/components/features/futures/FuturesWorkstationView.test.jsx` — green (102 tests).
- [x] 5.2 `npx eslint src/components/features/futures/FuturesWorkstationView.test.jsx` — clean. No stylelint is configured in this tree.

## 6. Secondary audit finding (reading cells at ui-scale ≥ 1.2, 845–984px)

- [ ] 6.1 Not reached in this change — no measurements taken here; the finding
  stands as reported by the 2026-08-19 audit.

## 7. Applied To The Moved Base

- [x] 7.1 Landed on the tree that already carries
  `keep-the-desk-grid-under-the-clock` (desktop clock rows, height budget
  `calc(100vh - 18px)`; the stale 90px in this change's CSS comment was
  corrected at apply time). Re-measured on the merged tree, same fixture:
  1366×681 reason [49..67] vs switch [−1..34] — 15px clear,
  `elementFromPoint` at the reason's centre hits the reason code, dock inside
  the desk, no page scroll; 1920×993 reason [49..67] vs switch [−1..34] —
  clear. View and dock suites 149/149, eslint clean.

## 8. Self-Audit Corrections (2026-08-20)

- [x] 8.1 The guard was scope-blind: `[\s\S]*?` crossed media-block
  boundaries, so the whole identity block moved into
  `@media (max-width: 844px)` — desktop back to inline flow, the covered
  reason restored — kept all five assertions green (recorded NOT CAUGHT in
  the audit harness). The guard now reads the exact
  `@media (min-width: 845px)` blocks brace-balanced and asserts inside
  them; the relocation mutant is caught.
- [x] 8.2 The 16px row gap — the clearance itself — was unguarded:
  `gap: 0 12px` kept every guard green while the reason re-entered the
  switch's box by a measured 3.5px at 1366×768. The guard now pins
  `gap: 16px 12px;` and the mutant is caught.
- [x] 8.3 The CSS comment's arithmetic was false: it claimed a 26px badge
  floor and a reason top ≥ 49px "clear of the switch and its shadow" at
  every ui-scale. Measured: the badge renders 23.5px, the reason tops out
  at ≈ 46.5px clocked / 47.5px unclocked at scale 1.0 — inside the ≈ 47px
  shadow reach the same comment states, though 12.5px clear of the switch's
  box. The comment now states the measured numbers and names the gap as
  the whole of the clearance; the ≥ 49px figure survives only at
  ui-scale ≥ 1.2, where it was measured.
- [x] 8.4 `npx vitest run src/components/features/futures/FuturesWorkstationView.test.jsx`
  — 105 passed (105); mutant matrix (audit2/layout/mutate2.mjs): baseline
  PASS, all eight mutants CAUGHT.
