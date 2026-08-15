## 0. Measure Before Changing

- [x] 0.1 Recorded the width the dock panel actually has at every width the operator uses, and the tracks the eight declared columns resolve to. Chromium, eight viewports from 1280 to 2560 px, real stylesheets: panel 1242–1422 px stacked below 1461 px, 605.1 px at 1461, 671.1 px from 1616 up (the workstation is capped at 1580 px). Numbers in `design.md`.
- [x] 0.2 Recorded which columns are outside the visible area at those widths, in Chromium, not in jsdom. **None** — `scrollWidth` equals `clientWidth` at all eight widths. What is wrong is different: above 1460 px the Status and Type tracks are 62.7–72.0 px while `PARTIALLY_FILLED` needs 125 px, `EXPIRED_IN_MATCH` 125 px, `STOP_MARKET` 86 px and `LIMIT · RO` 78 px, and neither cell carries a title, so the cut reading is unrecoverable.
- [x] 0.3 Rewrote the proposal against the measurement rather than against the 2026-08-10 screenshot, and recorded the operator's two decisions of 2026-08-15: cancelled rows stay omitted, the dock is not widened.

## 1. Six Columns, Outcome First

- [x] 1.1 Rebuild the order review on the six columns in `design.md`: outcome, contract and side, time, type, filled USDT, price.
- [x] 1.2 Render the outcome as a chip whose tone separates filled, partly filled, still open, expired and anything else the exchange reports, carrying the proportion when the fill is partial and the exchange's own word on the element.
- [x] 1.3 Keep the `Filled USDT` reading and its USDT-labelled header as `futures-order-visibility` already requires, and add what the order was placed for to the exact contract counts on the element.
- [x] 1.4 Fold the average price into the price cell, shown in place of the order's price only when the two differ, with both named on the element.
- [x] 1.5 State the order type in a form that fits its track, with the exact exchange type on the element.
- [x] 1.6 Replace `· RO` with an `exit` badge and `reduce-only` in words on the element and in the column header.
- [x] 1.7 Dim rows whose orders executed nothing, without removing them.
- [x] 1.8 Prove by test that a partial fill states its proportion, that an expired order reads as expired, and that no row needs the exchange's status column to be understood.
- [x] 1.9 Prove by test that every cell the design shortens carries its exact reading on the element.

## 2. Days Are Headings, Not Formats

- [x] 2.1 Group rows under a day heading and show the time of day in every row, replacing the today-versus-older format switch for both history tables.
- [x] 2.2 Keep the full timestamp on the element.
- [x] 2.3 Prove by test that a review spanning two days renders two headings and that every row shows a time.

## 3. Narrowing

- [x] 3.1 Add outcome filters — all, filled, unfilled — acting on the held reading.
- [x] 3.2 Add a `this contract` toggle that narrows to the contract on screen.
- [x] 3.3 Keep the scope statement beneath the table describing the read, not the narrowed view.
- [x] 3.4 Prove by test that narrowing issues no account history command and leaves the scope statement unchanged.

## 4. The Closed-Positions View Keeps Its Shape

- [x] 4.1 Leave the closed-positions table as it is beyond the day headings: it is already one row per position with the result it exists to show.
- [x] 4.2 Prove by test that the closed-positions view still lists only closed positions, with entry, exit and realized PnL.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [x] 5.2 Measured the finished table in Chromium at the same eight widths. No table scrolls sideways at any of them and no declared column falls outside the visible area. One cell is cut: a 14-character contract name against a 107.6–120.8 px track, which is what the track was always for — the full symbol is on the element. Every other reading fits, including `STOP MKT` beside the `exit` badge, the widest pair the desk can state.
- [ ] 5.3 Operator confirms on live data that the review answers "did my orders do anything" at a glance.
