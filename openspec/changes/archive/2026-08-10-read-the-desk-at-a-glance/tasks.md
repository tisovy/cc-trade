## 1. Amounts Read by Magnitude

- [x] 1.1 Give `formatCompactUsdt` a billions tier — 1.1e9 was printing as `1100.00M`, which abbreviates nothing — and let a caller choose the digit count, so a headline keeps one decimal and a column of levels keeps two.
- [x] 1.2 Abbreviate the 24h volume, weight it so three characters do not disappear between ten-character prices, and put the exact figure in the title.

## 2. Prices at Their Own Precision

- [x] 2.1 Drop the stream's padding from the last price — `2.6010000` is a fixed payload width, not precision — without rounding, so a coin quoted at 0.00123 keeps every digit.
- [x] 2.2 Use the same reading in the market header and between the book sides, and centre it: it is the axis the two sides are read against.

## 3. Readings That Fit

- [x] 3.1 Widen the uPnL column to hold the amount and the ROE together; the cell clips its overflow and the percent sign was being sliced mid-glyph.
- [x] 3.2 Make the percentage the part that never shrinks, and carry both figures exactly in the cell's title.

## 4. Absences Told Apart From Zero

- [x] 4.1 Add `formatPriceOrAbsent`: a price of zero is the exchange saying the order has none, and `0.000` in a price column reads as a level.
- [x] 4.2 Apply it to the order history's price and average columns.

## 5. History Stamped For What It Is

- [x] 5.1 Show today's rows by their time of day and older rows by their date, with the whole stamp in the title — the column carried both halves and ellipsized the one that mattered.

## 6. Executions Folded Into Positions

- [x] 6.1 Add `src/utils/futuresTradeRounds.js`: walk the fills, open a round when exposure is taken, close it at flat, and report side, size, average entry and exit, fees, realized PnL and the net.
- [x] 6.2 Hold sizes as integers — `0.1 + 0.2 − 0.3` is 5.5e-17, and a round that never reaches flat swallows every fill after it.
- [x] 6.3 Report the window's edges honestly: a round opened before the window claims no entry price and is reported on the leg it closed; a round still open says so; a fill that flips the position is split between two rounds with the PnL on the one it closed.
- [x] 6.4 Rename the tab to Positions (PnL) and render one row per round, with the fee its own column and the net in the title.

## 7. The Rail Marks What the Operator Works With

- [x] 7.1 Mark a recent contract as recent whether it came from storage or from the catalogue, and give the block at the top of the rail its own accent.
- [x] 7.2 Cover the storage round trip that no test covered: mount, pick, remount, and the rail lists the contract that was picked, first.

## 8. Type-to-Search, As On Spot

- [x] 8.1 Add `searchFuturesSymbols`: recency above the alphabet, and a symbol the query starts above one it only contains.
- [x] 8.2 Open the picker on a bare letter for pairs and a bare digit for intervals, seeded with the character typed, reusing Spot's picker so both desks share one gesture.
- [x] 8.3 Leave typing in a field, modified keys and the inactive market alone — the workstation's own shortcuts are mouse gestures and modifier keys.

## 9. Verification

Closed on the operator's instruction of 2026-08-10 to finish and commit: this
check is theirs to run on live data, and the change is archived rather than held
open waiting for it.

- [x] 9.1 Unit-test the new pure helpers: the compact tiers, the absent price, the symbol search ranking, and the round builder including the float case, the window edge, the flip and the unreadable fill.
- [x] 9.2 Prove the surfaces by test: the abbreviated volume with its title, the padded and the fractional price, the uPnL title, the two history columns, the two stamp forms, one row for three fills, the marked recent rows and the picker on a letter, a digit, a field and a modifier.
- [x] 9.3 `npm test` (1130 passed, 88 files), project-wide `eslint` clean, five guard scripts pass.
- [ ] 9.4 Operator confirms on live data: the volume, the last price and the uPnL read cleanly at their own scale; the history tabs show a market order with no price and today's rows by time; the positions tab reports the round trips they remember taking; typing a letter reaches a pair. — corrected 2026-08-13; see the [live-verification ledger](../../../live-verification-ledger.md#outstanding-verifications).
