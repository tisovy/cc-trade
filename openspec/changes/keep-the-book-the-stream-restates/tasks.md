## 1. The Far Book Is Kept

- [x] 1.1 Apply a diff level wherever it rests, rather than refusing every level outside the band the snapshot proved.
- [x] 1.2 Keep applying a removal wherever it lands, as now — forgetting a level is never a lie.
- [x] 1.3 Size retention for the book the exchange streams rather than for one page of it. Measured 2026-08-13: the whole book is 2431–3425 levels a side on AKEUSDT and BTCUSDT after three minutes. *(Set to 4000, which holds both measured books whole. It is not yet the ceiling a hostile stream needs bounding at: while levels rather than rows cross the transport, every delivery walks the retained side once, so the ceiling is what a burst can make the desk pay per frame. Measured against the burst guard — full-width diffs, a hundred ticks, five-second budget — 1000 takes 2.9 s, 4000 takes 3.6 s, 6000 takes 4.2 s and 20000 stalls the session outright. It rises in §3.)*
- [x] 1.4 Evict from the far edge only, and only past the bound, so the levels the operator zooms out to see are not the first ones dropped.
- [x] 1.5 Prove by test that a diff level beyond the band is drawn, that the band it can account for is not widened by drawing past it, and that retention drops the furthest level rather than the nearest.
- [x] 1.6 Carry the far book through a rebuild the desk asked for, and clear it for one the stream forced. *(Discovered: a re-centre calls `beginBootstrap`, which cleared both sides — so on the contracts that re-centre most, which are the ones being traded, the far book would never accumulate at all. A snapshot is the whole truth inside its own band and says nothing outside it, so what is outside is carried and what is inside but unnamed has been taken. Not for a rebuild the stream forced: a gap means diffs were missed, and showing liquidity that is no longer there is the one error worth clearing a book to avoid.)*
- [x] 1.7 Answer neither coverage question from a band the market has traded out of. *(Discovered: `coversRange` and `holdsMarket` both measure from the best price to the band's edges, and the best price could not leave the band while every out-of-band level was refused. Now it can, and both would have read a market that has left the page as comfortably covered by it.)*
- [x] 1.8 Centre the paged depth fixture on the book its own stream restates. *(Discovered: `pagedTransport` priced its band twenty-five dollars away from the fixture the diffs come from. With the band filter gone those diffs land as bids far above the paged asks, and the book fails closed on a crossed book — correctly, for a contradiction the fixture invented and the filter had been hiding.)*

## 2. The Proven Band Is Stated Rather Than Enforced

- [ ] 2.1 Keep the band and keep its meaning: the stretch of price every level of which the desk can account for. Beyond it the book holds what the stream has restated since — exact for each level it names, silent about levels nobody has touched.
- [ ] 2.2 State the boundary on the delivery, so the panel can mark where the accounted-for book ends instead of the operator having to know.
- [ ] 2.3 Mark it on the panel, quietly: a row beyond the proven band is a row that may understate, and the operator reads far rows to size a breakout against.
- [x] 2.4 Keep the reach the ladder is cut against as the reach of the book on hand — which now grows past the band — so `end-the-book-where-the-market-does` lengthens the ladder without a rung being added or moved. *(The reach was measured over the band, which does not grow. It is now measured over the levels held, so it follows the book: a market walking toward an edge genuinely leaves less book beyond it, and the ladder is kept from jumping by clamping the step drawn rather than by freezing a number that has stopped being true.)*
- [ ] 2.5 Prove by test that the boundary travels with the book and that the panel marks exactly the rows beyond it.

## 3. The Book Crosses As The Rows The Panel Draws

*§3 is the other session's; the file and the protocol are theirs. Note for it:
the retention ceiling in §1.3 is held down by level-based delivery and rises when
rows cross instead. And under the pool, only the shown contract has a step and a
row count at all, so the grouping belongs at delivery for the shown session
rather than cached on each held one.*

*Seen on the operator's own desk, 2026-08-14, with §1 running — AKEUSDT at the
coarsest step the ladder offers. The panel states the book on hand reaches
**±54.96%**, so §1 is holding the far book. The step is 0.0001 — a thousand
ticks, **1.34% of price** — and fourteen rows ask for 18.8% a side. **Three rows
a side are drawn.** Measured through the desk's proxy at the same moment, the
nearest thousand levels a side reach **−2.60% / +2.66%**, and the nearest
thousand is exactly what delivery selects. So the panel is drawing the whole of
what it was sent, and what it was sent is a fiftieth of the book behind it. This
is the case for §3.7 to hold a test against: same book, same step, far rows
filled.*

- [x] 3.0 Measure what a level-based delivery costs before replacing it, and check the two ceilings it runs between. Measured 2026-08-14 in-process on a tick-aligned book, median of 40 crossings, and independently against the live stream.

  | retained per side | `toRendererView` | frame | rows delivered |
  |---|---|---|---|
  | 50 | 31 µs | 3.5 KiB | 100 |
  | 500 | 268 µs | 34.0 KiB | 1 000 |
  | 1 000 | **459 µs** | **68.0 KiB** | 2 000 |

  At ten frames a second on the shown contract that is 4.6 ms/s of crossing and **680 KiB/s into the renderer**, for a panel that draws about forty rows. Forty rows is one to two KiB. That is the whole of §3 in one line.

  **A ceiling I suspected and checked before claiming: not a problem.** Raising retention to 4 000 does not raise what is delivered — `toRendererView` bounds delivery at `RENDERER_LEVELS_PER_SIDE` = 1 000 a side, so a frame stays near 68 KiB against the protocol's 256 KiB. `OUTBOUND_FRAME_TOO_LARGE` is not newly reachable.

  **What is newly reachable is the operator's original complaint, unfixed.** Delivery still selects the *nearest* thousand levels. Now that the book reaches to −60% and +139% (my own 60 s run on AKEUSDT: 5 045 distinct prices resting outside the REST page, against a page spanning −2.78%…+2.61%), the nearest thousand at a coarse step is a dense clump at the mid and empty far rows — the empty book this change exists to remove. §1's wider book buys the operator nothing at all until rows cross instead of levels.

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
