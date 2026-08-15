## 0. Measure Before Changing

- [ ] 0.1 Record the width the dock panel actually has at the operator's window size, and the sum of the eight declared minimum tracks (`FuturesWorkstation.css:1836`), so the overflow is a number rather than an impression.
- [ ] 0.2 Record which columns are outside the visible area at that width, in Chromium, not in jsdom.

## 1. The Review Takes The Dock

- [ ] 1.1 Give the history views the full dock width while one of them is selected, and return the live panels when a live view is selected.
- [ ] 1.2 Keep the transition free of a layout jump that moves the tab the operator just clicked.
- [ ] 1.3 Measure the resulting width in Chromium at the desktop size and at the narrow breakpoint, and record both.

## 2. Six Columns, Outcome First

- [ ] 2.1 Rebuild the order review on the six columns in `design.md`: outcome, contract and side, time, type, size, price.
- [ ] 2.2 Render the outcome as a chip whose tone separates filled, partly filled, cancelled and anything else the exchange reports, with the exchange's own word in the title.
- [ ] 2.3 State size in USDT with the fill as a proportion, and keep the exact contract counts in the cell's title.
- [ ] 2.4 Fold the average price into the price cell, shown only when it differs from the order's own price.
- [ ] 2.5 Replace `· RO` with a labelled reduce-only badge.
- [ ] 2.6 Dim rows whose orders executed nothing, without removing them.
- [ ] 2.7 Prove by test that a cancelled unfilled order reads as cancelled, that a partial fill states its proportion, and that no row needs the exchange's status column to be understood.

## 3. Days Are Headings, Not Formats

- [ ] 3.1 Group rows under a day heading and show the time of day in every row, replacing the today-versus-older format switch in `formatTime` for this table.
- [ ] 3.2 Keep the full timestamp in the cell's title.
- [ ] 3.3 Prove by test that a review spanning two days renders two headings and that every row shows a time.

## 4. Narrowing

- [ ] 4.1 Add outcome filters — all, filled, cancelled — acting on the held reading.
- [ ] 4.2 Add a `this contract` toggle that narrows to the contract on screen.
- [ ] 4.3 Keep the scope statement beneath the table describing the read, not the narrowed view.
- [ ] 4.4 Prove by test that narrowing issues no account history command and leaves the scope statement unchanged.

## 5. The Closed-Positions View Keeps Its Shape

- [ ] 5.1 Leave the closed-positions table as it is beyond the width it gains: it is already one row per position with the result it exists to show.
- [ ] 5.2 Apply the day headings there too, for the same reason.
- [ ] 5.3 Prove by test that the closed-positions view still lists only closed positions, with entry, exit and realized PnL.

## 6. Verification

- [ ] 6.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 6.2 Measure the finished table in Chromium at the desktop width and at the narrow breakpoint; record that no declared column falls outside the visible area.
- [ ] 6.3 Operator confirms on live data that the review answers "did my orders do anything" at a glance, without scrolling sideways.
