# Keep the Reason Code Clear of the Switch

## Why

The market-mode switch is an overlay: it hangs from the top of the window over
the viewport centre (`.market-mode-switch`, top −1px, active button min-height
35px — it owns y ≤ 34). The degradation reason code is an inline flex item in
the Futures identity strip, and the strip runs under the switch. When the desk
degrades, the reason flows into the centre span and the switch sits on top of
it — at exactly the moment the operator needs to read WHY the desk is degraded.

Measured in headless Chromium against the audit fixture (2026-08-19 audit of
`72f68f5`), before the fix:

| window | switch rect [t..b, l..r] | reason rect [t..b, l..r] | intersection |
|---|---|---|---|
| 1366×768 | [−1..34, 604..762] | [17..35, 317..790] | x 604..762 × y 17..34 (158px wide) |
| 1920×993 | [−1..34, 881..1039] | [17..35, 469..942] | x 881..942 × y 17..34 (61px wide) |

The archived change `2026-08-18-align-futures-chart-time-and-header` decided
that the identity strip owns global workspace state; a safe zone for the switch
over that strip was implied and never delivered. Below 845px the strip already
solves this — `padding-top: 43px` drops the whole strip below the switch — so
the defect is desktop-only.

## What Changes

Nothing moves for a healthy desk, and nothing moves the switch. On desktop
widths (≥ 845px) the identity strip becomes a two-row grid, and the reason code
— when one is up — takes its own full-width second row below the switch's
extent. Row one (title, state pill, scale control) has 26px floors, so with a
16px row gap the reason's top lands at y ≥ 49 at every ui-scale: clear of the
switch (y ≤ 34) and of its drop-shadow reach (≈ 47), at every desktop width,
with no viewport-centre arithmetic.

Two measured traps shaped the form:

- A wrapped flex row cannot deliver this. The strip's intrinsic height is
  measured as a single line — the second line's percentage width never resolves
  during track sizing — so the workstation's identity row stayed 52px and the
  reason bled 11px into the clock row.
- The desk grid is deliberately window-bound (`height: calc(100vh − 90px)`),
  so its auto rows collapse to their *minimum* contributions — and for an item
  with a specified `min-height`, that minimum is the `min-height`, not the
  content. The strip's 38px stature floor was silently capping the row at 52px.
  While a reason is shown, `min-height` returns to `auto`
  (`:has(.futures-workstation-reason)`) so the content-based minimum carries
  the second row into the track; without one, the 38px floor stands and the
  healthy strip is byte-identical to before.

After the fix, same fixture, same driver:

| window | switch rect | reason rect | intersection |
|---|---|---|---|
| 1366×768 | [−1..34, 604..762] | [49..67, 31..1335] | none (15px vertical gap) |
| 1920×993 | [−1..34, 881..1039] | [49..67, 183..1737] | none (15px vertical gap) |

The identity row grows 52 → 74px only while a reason is up; the healthy strip
measures 52px before and after, and ≤ 844px is untouched (verified at 800px).

## What this is not

Not a fix for the window-bound grid's other overflow: the dock still clips at
the bottom of a 768px window (`dockClipped: true` before and after) — that is
the audited `has-market-clock` grid defect, owned by a separate change in
flight, and this change deliberately does not touch the workstation's
`grid-template-rows` or `height` budget.

## Impact

- `src/components/features/futures/FuturesWorkstation.css` — the desktop
  identity-strip grid, the `:has` min-height release, and the reason row.
- `src/components/features/futures/FuturesWorkstationView.test.jsx` — one
  stylesheet guard; verified to fail with the rules stashed.
- Modifies one requirement in `futures-workstation-presentation`.
