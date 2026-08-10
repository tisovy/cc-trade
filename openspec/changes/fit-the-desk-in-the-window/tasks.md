## 0. Measured Before Changing

Measured in Chromium against the real stylesheet, at 1920×1080, 1600×900,
1440×900, 1366×768 and 1280×720.

- [x] 0.1 The header was given 18px — its padding alone — for content needing 43px. A scroll container contributes nothing to the `auto` grid row above it, so the row sized to the padding and the contract's numbers sat under a 25px scrollbar.
- [x] 0.2 Scrollers found: the instrument rail as a whole (763/631 vertical, 295/285 horizontal), the market header (43/18), the contract list (allowed), the tape (allowed), and the dock panel horizontally at 1440 and below (911/826).
- [x] 0.3 The positions row's own minimum tracks sum to 898px against a panel 826px wide at 1440 — the horizontal scrollbar the operator photographed.

## 1. The Header Shows Its Numbers

- [x] 1.1 Removed `overflow-x: auto`: one non-visible axis makes the other `auto` too, which is what turned the header into a vertical scroller and hid its values.
- [x] 1.2 The header wraps to a second line rather than clipping.
- [x] 1.3 Measured: header 64px, fully visible, `overflow: visible`, at every size from 1280×720 to 1920×1080.

## 2. The Desk Fits

- [x] 2.1 The chart row is `minmax(0, 1fr)` where the workspace is told to fill the window: a 420px floor under it plus a 690px floor under the grid is how the page gained its own scrollbar.
- [x] 2.2 The dock panel's fixed 260px becomes `clamp(168px, 26vh, 260px)` — a quarter of a short screen given back to the chart and the rail.
- [x] 2.3 Measured: the document does not scroll at any of the five sizes.

## 3. Scrolling Belongs To The Lists

- [x] 3.1 The rail no longer scrolls; the contract list takes the room the ticket does not need (`flex: 1 1 0`) and scrolls inside it.
- [x] 3.2 The dock's *rows* scroll rather than the panel, so a panel's heading and its totals stay put.
- [x] 3.3 The positions row's tracks tighten below 1560px, so the table fits its panel; every value keeps its exact form in the cell's title.
- [x] 3.4 Measured: at every size the only scrollers are the contract list, the tape, the dock tables — and the ticket's own body (see 5.1).

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on their own window that the contract's numbers are readable and that nothing scrolls except the tape, the dock's tables and the contract list.

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 The trading ticket's own body still scrolls. The rail spans the header, chart and tape rows — 573px at 1920×1080 — and the ticket's content alone is about 450px on top of a heading, a search field and the contract list. It cannot fit, so the ticket shrinks and its body scrolls while its readiness header and tabs stay put; before this change the *whole rail* scrolled, which took the ticket off screen entirely. Making it fit means moving the ticket out of the rail — a layout decision for the operator, not something to improvise.
- [x] 5.2 The contract list sits at its 96px floor on every measured size, for the same reason. The quick-switch (type a letter) is the fast path to a contract; the list is the browse path.
