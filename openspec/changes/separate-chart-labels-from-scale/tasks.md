## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `separate-chart-labels-from-scale` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing chart creation, overlay-coordinate and position-line symbol that will be edited; report blast radius and risk before changing code.
- [x] 1.2 Remove `ENTRY` and `LIQ` from standard price-line titles while retaining their lines and numeric axis prices.
- [x] 1.3 Render independently sized DOM annotations at current entry/liquidation coordinates and keep them synchronized through range, resize and teardown paths.

## 2. Proof after implementation

- [x] 2.1 Add chart regressions proving annotation typography is independent of price-scale typography and labels track their price coordinates.
- [x] 2.2 Run the focused chart tests, `npm run lint`, `npm run build` and `npm run check:futures-production`.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `separate-chart-labels-from-scale` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.
