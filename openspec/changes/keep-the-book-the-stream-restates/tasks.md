## 1. The Far Book Is Kept

- [ ] 1.1 Apply a diff level wherever it rests, rather than refusing every level outside the band the snapshot proved.
- [ ] 1.2 Keep applying a removal wherever it lands, as now — forgetting a level is never a lie.
- [ ] 1.3 Size retention for the book the exchange streams rather than for one page of it. Measured 2026-08-13: the whole book is 2431–3425 levels a side on AKEUSDT and BTCUSDT after three minutes. State the bound in the code as what it is — a ceiling against a hostile or pathological stream, not a reading of any market.
- [ ] 1.4 Evict from the far edge only, and only past the bound, so the levels the operator zooms out to see are not the first ones dropped.
- [ ] 1.5 Prove by test that a diff level beyond the band is drawn, that a level the stream has never named is not invented, and that retention drops the furthest level rather than the newest.

## 2. The Proven Band Is Stated Rather Than Enforced

- [ ] 2.1 Keep the band and keep its meaning: the stretch of price every level of which the desk can account for. Beyond it the book holds what the stream has restated since — exact for each level it names, silent about levels nobody has touched.
- [ ] 2.2 State the boundary on the delivery, so the panel can mark where the accounted-for book ends instead of the operator having to know.
- [ ] 2.3 Mark it on the panel, quietly: a row beyond the proven band is a row that may understate, and the operator reads far rows to size a breakout against.
- [ ] 2.4 Keep the reach the ladder is cut against as the reach of the book on hand — which now grows past the band — so `end-the-book-where-the-market-does` lengthens the ladder without a rung being added or moved.
- [ ] 2.5 Prove by test that the boundary travels with the book and that the panel marks exactly the rows beyond it.

## 3. The Book Crosses As The Rows The Panel Draws

- [ ] 3.1 Carry the grouping step and the row count on the request that configures depth, and derive the range the page ladder is bought against from them, so one statement serves both instead of two that can disagree.
- [ ] 3.2 Group in the main process, with the exact-decimal pass the panel uses today, and deliver rows: the bucket price, the resting quantity, the value in USDT, and the bucket key an order is matched by.
- [ ] 3.3 Keep the arithmetic exact on the way through — the value of a row is the sum of price times quantity over its levels, not the bucket boundary times the summed quantity.
- [ ] 3.4 Keep the ungrouped reading working: a step of one tick is the book as the exchange sent it, level by level.
- [ ] 3.5 Bound the delivery by the rows the panel draws rather than by a level ceiling, and keep the payload validator's bound the same value the book is built to.
- [ ] 3.6 Raise the protocol version, and keep the exact-keys rule on the payload.
- [ ] 3.7 Prove by test that a book delivered at a coarse step fills its far rows from levels the nearest-first selection would have dropped — the case that made the panel look empty — and that the rows match, exactly, what the renderer's own grouping produced from the same levels.

## 4. The Panel Reads Rows

- [ ] 4.1 Draw the delivered rows rather than grouping levels on arrival, and compute the cumulative column, the walls and the pressure split from them as now.
- [ ] 4.2 Match a working order to its row by the bucket key the delivery carries, and keep the key the panel computes for an order identical to the one the book computes for a row.
- [ ] 4.3 Keep a row selectable for seeding a price, on a short book as on a whole one.
- [ ] 4.4 Prove by test that the panel draws the same rows, sizes and cumulative column it drew before, on the same book.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Record the delivered frame size and the per-frame work in both processes, before and after.
- [ ] 5.3 Record how far the book reaches on a real contract after a minute and after ten, so the operator's reading has something to be compared against.
- [ ] 5.4 Operator confirms on live data that the book zooms out to what the Binance app shows on the same contract at the same moment, that far rows carry sizes rather than blanks, and that the boundary of the accounted-for book is marked — step 44, «Стакан достаёт туда же, куда приложение Binance», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list.
