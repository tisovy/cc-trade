## 1. The List That Rendered As Hairlines

- [x] 1.1 Size the contract list's rows from their content, so a definite panel
  height cannot compress them to their borders.
- [x] 1.2 Give the list a floor of three rows, so a tall execution ticket beside
  it scrolls the column instead of erasing the list.

## 2. The Column That Cut Its Own Rows

- [x] 2.1 Widen the instrument column to 300px, 240px at its narrowest, and to
  240px in the narrow-window layout.

## 3. Verification

- [x] 3.1 Measured in Chromium against the real stylesheet and the rail's real
  DOM, before and after: row height 2px → 32px with 128 contracts listed; list
  height 0 → 96px against a 700px ticket, and still 96px against a 1400px one.
- [x] 3.2 Measured against the four working orders from the operator's own
  screenshot: four cells clipped at 260px (three prices and one value), none at
  280px or wider. Shipped at 300px, which leaves headroom for a six-figure value.
- [x] 3.3 `npx vitest run` — 90 files, 1,185 passed.
- [x] 3.4 `eslint` clean; `npm run check:futures-production` passes.
- [ ] 3.5 Operator confirms on the live desk that the rail lists its contracts
  again on launch, and that no working-order row is cut.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 A contract whose name and price are both unusually long — a `1000`-prefixed
  symbol quoted to nine significant digits — can still ellipsize. The reading
  shortens; it is never silently dropped.
- [ ] 4.2 The same compression is possible anywhere a grid list of overflow-clipped
  rows sits in a sized flex column. The dock's tables clip their cells rather than
  their rows, so they are not exposed to it; nothing else in the futures surfaces is.
