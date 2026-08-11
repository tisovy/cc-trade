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
- [x] 3.3 ~~The positions row's tracks tighten below 1560px~~ — superseded by 6.4: one set of tracks at every width. Every value keeps its exact form in the cell's title.
- [x] 3.4 Measured: at every size the only scrollers are the contract list, the tape, the dock tables — and the ticket's own body (see 5.1).

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on their own window that the contract's numbers are readable and that nothing scrolls except the tape, the dock's tables and the contract list.

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 The trading ticket's own body still scrolls. The rail spans the header, chart and tape rows — 573px at 1920×1080 — and the ticket's content alone is about 450px on top of a heading, a search field and the contract list. It cannot fit, so the ticket shrinks and its body scrolls while its readiness header and tabs stay put; before this change the *whole rail* scrolled, which took the ticket off screen entirely. Making it fit means moving the ticket out of the rail — a layout decision for the operator, not something to improvise.
- [x] 5.2 The contract list sits at its 96px floor on every measured size, for the same reason. The quick-switch (type a letter) is the fast path to a contract; the list is the browse path.

## 6. Second Pass: What The Operator Photographed

The first pass fixed the header and the page scrollbar and left the desk still
broken. Measured again in Chromium against the real stylesheet, inside the real
app shell this time (`.futures-mode-view`, `width: min(100%, 1580px)`), at
1280×720, 1366×768, 1440×900, 1500×850, 1600×900, 1700×1000, 1920×1080 and
2560×1440.

- [x] 6.1 Measured: the order book was drawn **on top of** the tape at every size below 2560×1440 — by 277px at 1920×1080 and by 445px at 1366×768. `min-height: 390px` on the book against a row the window leaves 170px for: a grid item that cannot shrink does not shrink, it overflows its area and paints across the row below. The same floors under the chart (420px) and the tape (190px) did the same. All of them are now `min-height: 0` where the grid is told to fill the window.
- [x] 6.2 The overriding rules are the last thing in the stylesheet. Written where they belonged by topic, each one lost to the very declaration it exists to undo — a media query carries no weight of its own — and the desk overflowed exactly as before. Measured both ways.
- [x] 6.3 The tape has a row of its own (`minmax(0, 1fr)` against the book's `1.15fr`) rather than `auto`. On `auto` its content took its height out of the book's row first, which is what pushed the book out of its area.
- [x] 6.4 The dock's rows have one set of tracks at every width. Two sets chosen by a breakpoint left a band — a 1600px window among them — where the wide set was picked for a panel 897px wide that needed 901: the sideways scrollbar under the positions table in the operator's screenshot. Measured 0px of horizontal overflow at all eight sizes.
- [x] 6.5 The closed-position and order-history rows fit the narrower dock panel too; both scrolled sideways at every size.
- [x] 6.6 The dock panel does not scroll. It declared `overflow: hidden` and `overflow: auto` in the same rule, and the second won — so the panel scrolled in both directions and the bar ran the full width of the panel rather than under the table.
- [x] 6.7 The dock splits into two columns from 1460px rather than 1400px, which is where the wider panel actually holds the positions row; stacked below that it takes 224px rather than 391px, because that height comes out of the book and the tape above it.
- [x] 6.8 The dock takes a fifth of the window rather than a quarter (`clamp(150px, 20vh, 210px)`): at 1920×1080 the book had ten levels a side and the tape three prints.
- [x] 6.9 The rail's two parts are both sized from a basis and both give ground in proportion to it. With the list on `flex: 1 1 0` the whole shortfall came out of the ticket — 55px on a 768px screen, a header and a scrollbar where the order buttons belong. Measured: ticket 368px at 1920×1080, 253px at 1600×900.
- [x] 6.10 The ticket's border is inside its width (`box-sizing: border-box`): at `width: 100%` it was two pixels wider than the rail holding it.
- [x] 6.11 Measured after: no panel overlaps another and the desk does not overflow itself at any of the eight sizes; the only scrollers left are the contract list, the tape, the dock tables and the ticket body.
