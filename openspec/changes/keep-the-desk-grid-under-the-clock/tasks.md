## 1. Reproduce Before Touching

- [x] 1.1 Measure the current layout in headless Chromium on the audit fixture
  at 1920×993 and 1366×681. Record the tape row height, the dock's bottom edge
  against the desk's, and the applied `grid-template-rows`.

  Measured 2026-08-19, pre-fix, fixture at
  `scratchpad/header-audit/fixture.html` (session b6581c77):

  | window | applied rows | tape | dock vs desk |
  |---|---|---|---|
  | 1920×993 (inner 906) | `52 44 107 420 16 181` | **16px** | dock 644–825, desk ends 817 — clipped |
  | 1366×681 (inner 594) | `52 44 107 420 16 225` | 16px | dock 644–869, desk ends **505** — entirely below the edge |

  Both runs applied the mobile clock rows (`420px` floor, content-sized tape)
  at desktop width, `overflow: hidden`, no scrollbar. Desk height 816 against
  a 906px window: a 72px dead band beyond the page's 18px padding.

## 2. Fix

- [x] 2.1 Give the desktop media block its own
  `.futures-workstation.has-market-clock` rows —
  `auto auto auto minmax(0, 65fr) minmax(0, 35fr) auto` — so the clock row
  rides on the window-shared grid instead of resurrecting the mobile one.
- [x] 2.2 Recompute the desktop height budget: the 90px subtracted 72px of top
  padding that the header recompose removed; only the page's 18px bottom
  padding remains. The first re-measure showed the desk's own 1px border
  scrolling the page (`scrollHeight` 907 vs 906), so the border joined the
  budget via `box-sizing: border-box` rather than a 19px magic number.

## 3. Guard

- [x] 3.1 Extend the breakpoint guard test with the desktop clock-variant rows
  and the height budget, and prove the additions bite: with the CSS fix
  stashed, the test must fail; record the failing assertion here.

  With the fix stashed:
  `AssertionError: expected '\n height: calc(100vh - 90px);\n …' to contain
  'height: calc(100vh - 18px);'` — 1 failed / 101 in
  `FuturesWorkstationView.test.jsx`. Restored, all pass.

## 4. Verification

- [x] 4.1 Re-measure the fixture at both window sizes: tape holds its 35fr
  share, dock bottom at or above the desk bottom, no dead band beyond the
  page's own padding.

  Post-fix, same fixture:

  | window | applied rows | tape | dock vs desk | page scroll |
  |---|---|---|---|---|
  | 1920×993 | `52 44 107 323.6 174.2 181.2` | 174px | dock 706–887 inside desk 0–888 | 906/906, none |
  | 1366×681 | `52 44 107 92.3 49.7 225` | 50px | dock 350–575 inside desk 0–576 | 594/594, none |

  The no-clock fixture stays correct too: 5 rows `52 107 352.2 189.6 181.2`,
  no clipping, no scroll.

- [x] 4.2 `npx vitest run` on the touched test files, then the full suite and
  lint before commit. View glob: 707 tests in 7 files green; eslint clean on
  the touched test. Full suite and lint recorded in the batch verification at
  the end of the audit-fix series.
