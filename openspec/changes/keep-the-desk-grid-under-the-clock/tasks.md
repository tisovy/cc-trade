## 1. Reproduce Before Touching

- [ ] 1.1 Measure the current layout in headless Chromium on the audit fixture
  at 1920×993 and 1366×681. Record the tape row height, the dock's bottom edge
  against the desk's, and the applied `grid-template-rows`.

## 2. Fix

- [ ] 2.1 Give the desktop media block its own
  `.futures-workstation.has-market-clock` rows —
  `auto auto auto minmax(0, 65fr) minmax(0, 35fr) auto` — so the clock row
  rides on the window-shared grid instead of resurrecting the mobile one.
- [ ] 2.2 Recompute the desktop height budget: the 90px subtracted 72px of top
  padding that the header recompose removed; only the page's 18px bottom
  padding remains.

## 3. Guard

- [ ] 3.1 Extend the breakpoint guard test with the desktop clock-variant rows
  and the height budget, and prove the additions bite: with the CSS fix
  stashed, the test must fail; record the failing assertion here.

## 4. Verification

- [ ] 4.1 Re-measure the fixture at both window sizes: tape holds its 35fr
  share, dock bottom at or above the desk bottom, no dead band beyond the
  page's own padding.
- [ ] 4.2 `npx vitest run` on the touched test files, then the full suite and
  lint before commit.
