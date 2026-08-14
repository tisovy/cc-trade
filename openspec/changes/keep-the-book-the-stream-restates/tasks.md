## 1. The Far Book Is Kept

- [x] 1.1 Apply a diff level wherever it rests, rather than refusing every level outside the band the snapshot proved.
- [x] 1.2 Keep applying a removal wherever it lands, as now — forgetting a level is never a lie.
- [x] 1.3 Size retention for the book the exchange streams rather than for one page of it. Measured 2026-08-13: the whole book is 2431–3425 levels a side on AKEUSDT and BTCUSDT after three minutes. *(Set to 4000, which holds both measured books whole. It is not yet the ceiling a hostile stream needs bounding at: while levels rather than rows cross the transport, every delivery walks the retained side once, so the ceiling is what a burst can make the desk pay per frame. Measured against the burst guard — full-width diffs, a hundred ticks, five-second budget — 1000 takes 2.9 s, 4000 takes 3.6 s, 6000 takes 4.2 s and 20000 stalls the session outright. It rises in §3.)*
- [x] 1.4 Evict from the far edge only, and only past the bound, so the levels the operator zooms out to see are not the first ones dropped.
- [x] 1.5 Prove by test that a diff level beyond the band is drawn, that the band it can account for is not widened by drawing past it, and that retention drops the furthest level rather than the nearest.
- [x] 1.6 Carry the far book through a rebuild the desk asked for, and clear it for one the stream forced. *(Discovered: a re-centre calls `beginBootstrap`, which cleared both sides — so on the contracts that re-centre most, which are the ones being traded, the far book would never accumulate at all. A snapshot is the whole truth inside its own band and says nothing outside it, so what is outside is carried and what is inside but unnamed has been taken. Not for a rebuild the stream forced: a gap means diffs were missed, and showing liquidity that is no longer there is the one error worth clearing a book to avoid.)*
- [x] 1.7 Answer neither coverage question from a band the market has traded out of. *(Discovered: `coversRange` and `holdsMarket` both measure from the best price to the band's edges, and the best price could not leave the band while every out-of-band level was refused. Now it can, and both would have read a market that has left the page as comfortably covered by it.)*
- [x] 1.8 Centre the paged depth fixture on the book its own stream restates. *(Discovered: `pagedTransport` priced its band twenty-five dollars away from the fixture the diffs come from. With the band filter gone those diffs land as bids far above the paged asks, and the book fails closed on a crossed book — correctly, for a contradiction the fixture invented and the filter had been hiding.)*
- [x] 1.9 Take the ceiling back to the cost it is actually paid for, once rows cross instead of levels, and leave it where the measurement puts it. *(§3 was expected to free it. It did not, and saying so is the finding. What crosses the wire fell thirtyfold, but the main process still sorts the side it groups and sorts it again to evict, so the ceiling is still bought per frame. What was actually paying for it was neither: `bestPrice` walked a side comparing decimal **strings**, which parses both of them, so the crossed-book check re-parsed thousands of prices twice per applied diff, ten times a second. Parsing each price once and remembering it — a cache that cannot go stale, because a price string cannot parse to two different numbers — took a delivered frame from 12.7 ms to 3.2 ms, an applied diff from 2.9 ms to 0.2 ms, and the burst guard from 3.6 s to 2.2 s. On a book sitting at the bound the curve is then 4000 → 87 ms/s, 10000 → 222 ms/s, 20000 → 348 ms/s for one contract, against a deepest measured real book of 3425 a side. So the ceiling stayed at 4000 for the day, with four times the headroom under it. What moved it was not the lever named here — see §1.11.)*
- [x] 1.10 Stop paying for the ceiling on every diff once the book reaches it. *(Discovered by measuring a real book for ten minutes rather than three: AKEUSDT holds 6197 levels a side by then and BTCUSDT 6270, both still growing — so a desk left open sits **at** the bound rather than under it, which is the one state eviction was never measured in. There it sorted the whole side on every applied diff, ten times a second, forever. The side is now allowed to run a little past the ceiling and is cut back to it in one pass, so a stream naming twenty new far prices a diff pays one sort every twenty-five diffs instead of one per diff: measured, 811 µs down to 332 µs per applied diff at the bound. What it costs is that a side may hold five hundred levels more than the ceiling names, and nothing reads that number as an exact count.)*
- [x] 1.11 Raise the ceiling to the book that was actually measured, once it costs less than the old one did. *(The other session's, and it corrected me twice. I had named the lever as grouping without the sort; measured, the sort is 3.0 ms of an 11.1 ms frame while parsing decimals inside the grouping is 5.2 ms — the same defect as in `bestPrice`, one floor up, and the bigger half. Remembering the parse *inside* the shared grouping pass costs nothing in kind: both sides of the seam keep calling one function, so the rows cannot part. 10 000 levels a side now cost less than 4 000 did yesterday — verified independently here on a book at the bound: 4.8 ms a frame against the 7.9 ms 4 000 took, and an applied diff 0.68 ms. It covers both books measured at ten minutes (6197 and 6270, still growing). 20 000 buys nothing anybody has observed and costs an eighth of a core on one contract, so the ceiling stops where the evidence does. The sort remains unremoved and should stay that way while it is worth about a millisecond a frame: taking it would cost the shared grouping pass, and with it the guarantee that a row the desk builds is a row the panel would have built.)*
- [x] 1.12 Tie the parse cache to the book it serves. *(Discovered by the other session, and it is the same class of trap as the one this section started with: a cache smaller than the side it is walked over empties mid-pass and costs more than no cache at all — 26.5 ms a frame against 10.1 at 20 000 levels. It showed up as a point off the curve rather than as a failure. The two numbers live in different processes and cannot import each other, so a test asks for them together; raising retention to 20 000 in a copy fails it with `expected 65536 to be greater than or equal to 80000`.)*

## 2. The Proven Band Is Stated Rather Than Enforced

*§2.2 travelled with §3. §2.3 and §2.5 followed it once the row shape settled,
and carried §2.2 with them: the boundary turned out to belong on the row rather
than beside it. Protocol 11.*

- [x] 2.1 Keep the band and keep its meaning: the stretch of price every level of which the desk can account for. Beyond it the book holds what the stream has restated since — exact for each level it names, silent about levels nobody has touched.
- [x] 2.2 State on each delivered row whether it is whole, so the panel can mark where the accounted-for book ends instead of the operator having to know. *(First done as `proven: {below, above}` — how much room is left inside the band from where the market is now. It was replaced rather than added to, and the reason is the lesson §3 taught: what crosses the wire is what the panel draws, not the raw material for it to derive that again. A boundary the panel measures rows against is the same arithmetic run twice over buckets only the desk built, and it would part from the desk's own answer exactly the way the bucket key did before `depth.step` was carried. A row belongs to the desk that grouped it. `proven` also had no reader — checked, not assumed — and a field nobody asks for reads as a live rule a month later.)*
- [x] 2.3 Mark it on the panel, quietly: a row beyond the proven band is a row that may understate, and the operator reads far rows to size a breakout against. *(A rule on the outer edge of the row, and the reading on the row's own label so a screen reader has it too. The mark never touches the numbers: every level the row holds was named by the exchange and is exact, and what may be missing is levels nobody has restated — dimming a size to say the size might be low would state something false about a number that is true. The working-order tick already holds the inner edge, so two marks never land in one place.)*
- [x] 2.4 Keep the reach the ladder is cut against as the reach of the book on hand — which now grows past the band — so `end-the-book-where-the-market-does` lengthens the ladder without a rung being added or moved. *(The reach was measured over the band, which does not grow. It is now measured over the levels held, so it follows the book: a market walking toward an edge genuinely leaves less book beyond it, and the ladder is kept from jumping by clamping the step drawn rather than by freezing a number that has stopped being true.)*
- [x] 2.5 Prove by test that the boundary travels with the book and that the panel marks exactly the rows beyond it. *(Four tests, all biting against the tree before this change: a book whose stream reached outside its page marks exactly those rows and no others; a bucket straddling the edge is not whole; a book with no band calls no row whole; and the panel marks exactly the rows the delivery marked, leaving the rest without so much as a word in their label.)*

## 3. The Book Crosses As The Rows The Panel Draws

*§3 was the other session's, and is done. Half of the note it was left with
holds: the grouping happens at delivery for the shown session rather than cached
on each held one. The other half does not. The grouping walk does stop one row
past the last row asked for, but it is preceded by a sort of the whole retained
side, and eviction sorts it again — so the retention ceiling in §1.3 is still
bought per frame, and §1.9 measures what it costs and leaves it where it was.*

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

- [x] 3.1 Carry the grouping step and the row count on the request that configures depth, and derive the range the page ladder is bought against from them, so one statement serves both instead of two that can disagree. *(`step` and `rows`, on the request that configures depth and on the one that opens a contract, read by one rule wherever they arrive. The distance is derived in the service and never stated: a statement and a derivation cannot disagree, where two statements can. A null step is the ungrouped reading and states no distance at all — a row is one level there, and the price the rows span is wherever the market happens to rest, so a distance in ticks would name something the rows have no relation to and buy a page for nothing.)*
- [x] 3.2 Group in the main process, with the exact-decimal pass the panel uses today, and deliver rows: the bucket price, the resting quantity, the value in USDT, and the bucket key an order is matched by. *(Literally the same function — `groupFuturesBookLevels`, imported from `src/utils/futuresOrderBook.js`, which the main process already reaches into for the protocol. Not a second implementation held to agree with the first: a row the book computes and a row the panel would have computed are the same row by construction, including the bucket key.)*
- [x] 3.3 Keep the arithmetic exact on the way through — the value of a row is the sum of price times quantity over its levels, not the bucket boundary times the summed quantity. *(Already true of the shared pass, and pinned by a test that states both numbers: five levels of one unit from 999999 down to 999995 are worth 4 999 985, and the boundary times the summed quantity says 4 999 975 — ten USDT short over five levels of a five-tick bucket.)*
- [x] 3.4 Keep the ungrouped reading working: a step of one tick is the book as the exchange sent it, level by level. *(Stated as a null step rather than as the tick, and deliberately: 1× means no alignment pass at all, so a contract whose quoted prices disagree with its own tick filter still draws the levels it has. Aligning there would merge two real levels into a price neither of them rests at.)*
- [x] 3.5 Bound the delivery by the rows the panel draws rather than by a level ceiling, and keep the payload validator's bound the same value the book is built to. *(`FUTURES_WORKSTATION_DEPTH_ROWS_PER_SIDE` = 64, shared by the book, the validator and the panel's own measurement ceiling — the count the panel states is always a count a delivery is allowed to answer with. Sixty-four bounds a hostile request rather than shaping an honest one; the operator's panel draws about fourteen.)*
- [x] 3.6 Raise the protocol version, and keep the exact-keys rule on the payload. *(Revision 10. The delivery also names the `step` it grouped by — see 3.8, which is why.)*
- [x] 3.7 Prove by test that a book delivered at a coarse step fills its far rows from levels the nearest-first selection would have dropped — the case that made the panel look empty — and that the rows match, exactly, what the renderer's own grouping produced from the same levels. *(Fixture built the way the real book is: the page buys the near thousand, the far levels arrive on the diff stream. **Fourteen rows of fourteen**, against fewer than four from the nearest thousand the old delivery selected — asserted side by side in one test, so the number that used to be three is in the file next to the number that is now fourteen. The second half is the weaker one and is named as such: sharing the grouping pass makes "the rows match what the panel grouped" close to a tautology. It is kept because it pins the bucket **key** across the seam, which §4.2 matches working orders by.)*
- [x] 3.8 Name the step the rows were grouped by on the delivery. *(Not planned — found by a test that stopped passing for the right reason. The panel matches a working order to its row by computing the order's bucket key, and it was computing it at the step the operator had just chosen. A reading is stated and answered a frame later, so for that frame the rows on screen belong to the previous step and every mark sat on a bucket nothing had been grouped into — or on none. The delivery names its own step and the panel keys off that. Two tests: a mark on a grouped row that holds an order resting inside it, and a mark that stays put while a coarser step is still being answered.)*

## 4. The Panel Reads Rows

*§4 is the other session's. §4.1 and §4.2 were done with §3 rather than after it,
and not by preference: the operator runs master live, a commit reaches the screen
in minutes, and a payload change landed without the panel that reads it is a desk
with no book on it for however long the two commits are apart. What is left is
§4.3 and §4.4, and §2.3 and §2.5 beside them.*

*`groupFuturesBookLevels` stays exported after the panel stops calling it on
arrival: §3.7 proves the delivered rows equal what it produces from the same
levels, and it is the only thing that can prove it.*

- [x] 4.1 Draw the delivered rows rather than grouping levels on arrival, and compute the cumulative column, the walls and the pressure split from them as now. *(`readFuturesBookRows` builds the cumulative column from the exact value each row carries, accumulated in atoms and converted once — a hundred float additions down a liquid side drift, and a drifting running total is worse than none. The panel still cuts the rows it draws to the height it measured: between a resize and the next frame the desk is still answering the previous row count, and the extra rows would draw outside the panel.)*
- [x] 4.2 Match a working order to its row by the bucket key the delivery carries, and keep the key the panel computes for an order identical to the one the book computes for a row. *(Keyed at the step the **delivery** names, not the step the operator last chose — see §3.8. The two are the same function over the same step, so the keys are identical by construction rather than by agreement.)*
- [x] 4.3 Keep a row selectable for seeding a price, on a short book as on a whole one. *(Closed by the code as it stands, verified rather than assumed: what makes a row pickable is the length of the delivered rows and not the state of the resource, and two tests hold it — a book reading `stale` keeps both its rows enabled, and so does one whose depth resource is not live. A short book has fewer rows; each of them is still exact and still seeds a price.)*
- [x] 4.4 Prove by test that the panel draws the same rows, sizes and cumulative column it drew before, on the same book. *(One book of levels, grouped and delivered by the desk's own order book at a step coarse enough that every row is built from several levels, rendered, and read back out of the DOM — against what the panel's own grouping pass makes of the same levels. Reading the drawn rows rather than comparing two calls of one function is the whole point: the ask side being reversed for drawing, the running total accumulating from the market outwards, and the formatting of every number are inside the comparison. Both mutations bite: a cumulative column that stops accumulating, and a lost reversal on the ask side. It also surfaced a real difference and named it — the exchange spells a price `58420.00`, the book holds it canonically as `58420`, and a level on a bucket boundary keeps its own string, so the two passes print differently unless the comparison is made against the levels as the book holds them. Ingress, not grouping, and the same before the book moved.)*

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`. *(Run against the staged tree in isolation rather than against the working tree, which holds another session's unfinished work: 1921 of 1921 tests, eslint clean, boundary check passed over 23 isolated implementation files. Re-run on the whole change once every part of it had landed, this time against the shared tree with nothing else outstanding: **1954 of 1954**, eslint clean, and the boundary, circular-import and trading-command-path checks all passed.)*
- [x] 5.2 Record the delivered frame size and the per-frame work in both processes, before and after. Measured 2026-08-14, median of 40 crossings, one book — a thousand-level page with the far levels the stream restates behind it — read at a step of 0.0001 over fourteen rows.

  | | before | after |
  |---|---|---|
  | frame on the wire | 72.1 KiB | **2.4 KiB** |
  | renderer, per frame | 1 768 µs | **5 µs** |
  | both processes, per frame | 2 642 µs | 2 643 µs |
  | rows drawn, on the operator's book | 3 of 14 | **14 of 14** |

  **The third row is the honest one and is not a win: total CPU did not move.** The grouping did not get cheaper, it changed sides. What it bought is the other three rows — the wire fell thirtyfold, the work left the thread that draws the panel, and the same money now buys the right answer instead of an empty book. At ten frames a second the renderer goes from 17.7 ms/s to 0.05 ms/s, and 680 KiB/s of serialise-parse-discard becomes 24 KiB/s.

  **A guard, named as one rather than counted as a finding.** `OUTBOUND_FRAME_TOO_LARGE` is now unreachable — and the question of whether it is unreachable only through depth or unreachable *entirely* was asked and measured rather than assumed. Every resource, at its own payload bound and with the longest decimals and identities the rules accept:

  | | largest legal frame | of the 256 KiB ceiling |
  |---|---|---|
  | depth, 64 rows a side | 38.4 KiB | 15.0% |
  | trades, 80 rows | 31.2 KiB | 12.2% |
  | catalog, 8 contracts | smaller still | — |

  So the byte check can no longer refuse anything: the payload rules refuse a wider frame before its bytes are ever measured, on every resource. The test that claimed to prove the guard bites was rewritten to assert what is true — the measured size, and the refusal by the payload rules. The guard itself is kept as one comparison against a future payload that grows, but it is a guard and not a finding, and this is it written down.
- [x] 5.3 Record how far the book reaches on a real contract after a minute and after ten, so the operator's reading has something to be compared against. Measured 2026-08-14 by applying `@depth@100ms` through the desk's own proxy.

  | levels a side | 1 min | 3 min | 5 min | 10 min |
  |---|---|---|---|---|
  | AKEUSDT | 1 658 / 1 801 | 2 403 / 2 420 | 4 017 / 3 427 | **6 197 / 4 665** |
  | BTCUSDT | 1 580 / 1 555 | 2 689 / 2 615 | 4 157 / 4 122 | **6 270 / 5 185** |

  Still climbing at ten minutes on both, which retires the earlier three-minute
  reading of 2431–3425 as "the whole book": there is no such number, only how
  long the desk has been watching. Past about eight minutes a session sits on the
  retention bound rather than under it.

  Where the book actually has substance, after five minutes, as a share of price:

  | | furthest level | 99th of levels | 95th | median |
  |---|---|---|---|---|
  | AKEUSDT bids | 100.0% | 56.86% | 39.06% | 11.13% |
  | AKEUSDT asks | **1 357 378%** | 145.21% | 77.65% | 7.20% |
  | BTCUSDT bids | 99.0% | 10.05% | 3.36% | 0.78% |
  | BTCUSDT asks | 97.8% | 9.05% | 2.89% | 0.83% |
  | ETHUSDT bids | 94.7% | 27.23% | 6.09% | 1.29% |

  The furthest level is an outlier on every contract, which is what
  `end-the-book-where-the-market-does` §2.10 stops cutting the ladder against.
  The far book made that reachable: the outlier used to be evicted along with
  everything past the nearest thousand levels.

- [ ] 5.4 Operator confirms on live data that the book zooms out to what the Binance app shows on the same contract at the same moment, that far rows carry sizes rather than blanks, and that the boundary of the accounted-for book is marked — step 44, «Стакан достаёт туда же, куда приложение Binance», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list.
