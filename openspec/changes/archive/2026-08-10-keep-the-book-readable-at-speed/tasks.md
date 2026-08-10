## 1. A Last Price the Tape Cannot Freeze

- [x] 1.1 Resolve one last traded price in the view: newest live candle close, then the ticker's `lastPrice`, then the newest displayed trade. State in the comment why the tape is last — it is a filtered, throttled display of prints, not a price feed.
- [x] 1.2 Feed the market header's `Last`, the book's last-print row, the step share-of-price readout and the pressure reach reference from that one value, so the panel cannot show three prices for one market.
- [x] 1.3 Tint the last-print row by the direction of the change and carry an arrow, so the reading does not depend on the maker flag of a print the filter left on screen — and does not depend on colour alone.
- [x] 1.4 Reset the remembered direction when the contract changes, beside the other per-symbol display resets.

## 2. Whole Rows, Sized to the Panel

- [x] 2.1 Measure each side directly — not the body less the last-print row, whose vertical margins `offsetHeight` does not count, and eight unaccounted pixels are half a row — and render `floor(sideHeight / rowHeight)`. Keep the fourteen-row default where there is nothing to measure, so jsdom and an unlaid-out panel degrade to today's behaviour rather than to an empty book.
- [x] 2.2 Drive the row height from the interface scale through one custom property set in JS, so the measurement and the CSS cannot disagree about how tall a row is. At 150% the type grew and the row did not.
- [x] 2.3 Replace the sides' `max-height` + shrink-clip with `flex: 1 1 0; min-height: 0`, and lay the sell side out against the last-print row so a side short of room drops its farthest levels, not its best asks.
- [x] 2.4 Cap the measured count so an unusually tall panel cannot ask the grouper for an unbounded number of rows.

## 3. Reading One Side at a Time

- [x] 3.1 Add a three-way side control — both, buy only, sell only — with Binance's stacked-bar glyphs, `aria-pressed` and a label on each button.
- [x] 3.2 Put it on the step control's row rather than a row of its own: the panel is short by about 150 px, and a control row costs six rows of book.
- [x] 3.3 Give a lone side the whole area and remeasure it, so the mode buys depth rather than whitespace.
- [x] 3.4 Keep the last-print row in every mode, and keep the mode across a contract change — it is a way of reading a book, not a property of one contract.
- [x] 3.5 Keep the buy/sell split measured over both sides at the visible side's level count, and keep the `±X%` beside it honest about the deeper window.

## 4. Verification

- [x] 4.0 Measured in Chromium against the real stylesheet rather than assumed from jsdom: the depth panel is 446 px, giving 8 whole rows a side in combined mode and 17 to a lone side, with zero rows outside their container in any mode and none at 115% interface scale (where the old fixed 14 px row overflowed its type). The page does not grow: it still does not scroll.
- [x] 4.1 `npx vitest run` — 86 files, 1,100 passed, including new cases for: a frozen tape that no longer freezes the price, direction tinting across a rise and an unchanged tick, the fitted row count, and each side mode.
- [x] 4.2 `eslint` clean on every file this change touches.
- [x] 4.3 `npm run check:futures-production` passes.
- [x] 4.4 Operator confirmed on live data that the price tracks the chart under heavy flow, that no book row is cut off at either edge, and that one-sided mode reaches roughly twice as far at the same step.

## 5. Stated Limits, Not Fixed Here

- [ ] 5.1 The candle close is 250 ms fresh, which is the kline stream's own cadence. A truly print-by-print last price would need the service to carry an unfiltered last trade alongside the filtered tape; that is a protocol change and is not made here.
- [ ] 5.2 The side mode and the grouping step are session state. Tape settings are persisted; these are not.
- [ ] 5.3 The depth panel's overall height is unchanged. The extra rows come from the control row reclaimed in 3.2 and from not wasting rows on clipping — not from taking space off the chart or the tape.
