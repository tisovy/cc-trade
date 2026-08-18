## 1. The Delivered Book Is Bounded By The Reading

- [x] 1.1 Give `toRendererView` the range the panel stated, so it formats the levels within that distance of the best price on each side rather than `RENDERER_LEVELS_PER_SIDE` on both.
- [x] 1.2 Keep the protocol ceiling as the upper bound: a stated range reaching further than the book retains delivers what the book has, never more than the ceiling.
- [x] 1.3 Deliver at the ceiling when no range has been stated yet, so the first book of a session is never short of the rows it will be asked for.
- [x] 1.4 Pass the range at every delivery site — bootstrap, applied diff, book recovery, and the freshness monitor's stale re-delivery — so no path keeps sending the whole book.
- [x] 1.5 Keep a floor of levels under the stated range, pinned to the panel's own row cap. *(Discovered: a range is rows × step, which assumes a level on every step. Ungrouped, a row is one raw level and the rows span wherever the market rests, so on a sparse contract the range names a distance the rows overflow and the panel would draw two rows instead of fourteen.)*
- [x] 1.6 Deliver again when the reading changes, from the book already held. *(Discovered: `configureDepth` only bought a page. With delivery bounded, a coarsened step stayed trimmed to the previous reading until the next diff — which on a quiet contract, the one most likely to be read at a coarse step, may not come.)*
- [x] 1.7 Make the delivery guard non-throwing on a range that is not a decimal — `isFuturesWorkstationDecimal` decides, rather than the parsing predicates raising. On the delivery path an unreadable range means "no reading stated", not "stop sending the book".

## 2. A Delivered Level Is Price And Quantity

- [x] 2.1 Stop computing the running `total` in `formatSide`; a delivered level carries `price` and `quantity`.
- [x] 2.2 Update the payload validator's level shape, and bump the protocol version (6 → 7) so a main process and a renderer that disagree refuse each other rather than mis-reading a level.
- [x] 2.3 Confirm no renderer surface reads the delivered `total` — the panel's cumulative column, the wall marking and the pressure split all derive from grouped notional. *(`groupFuturesBookLevels` accumulates `cumulativeUsdt` from `notionalAtoms`; `futuresBookWallKeys` reads `notionalUsdt`. The only other `total` in the renderer is the candle-history page count, which is unrelated.)*
- [x] 2.4 Drop `total` from every depth fixture that stands in for a delivered book — the view suite, the app stress harness and the protocol suite. *(Discovered: these build props directly rather than through the validator, so they passed either way. Left as they were, the suite would keep describing a payload the wire no longer carries, and a reintroduced read of `level.total` would go on passing.)*

## 3. The Trim Is On Delivery Only

- [x] 3.1 Leave what the book retains, proves and bridges untouched: `RETAINED_LEVELS_PER_SIDE`, the band, and the diff bound are unchanged.
- [x] 3.2 Leave the protocol's byte ceiling and node budget unchanged, so the widest legal frame stays provably deliverable.

## 4. Tests

- [x] 4.1 Prove that a session with a stated range delivers only the levels within it, on both sides.
- [x] 4.2 Prove that a session with no stated range delivers at the ceiling — including a range that is not a distance at all.
- [x] 4.3 Prove that a stated range wider than the book retains delivers what the book holds rather than failing.
- [x] 4.4 Prove that the retained book is unchanged by the trim — a later, wider range delivers the deeper levels without a fresh snapshot.
- [x] 4.5 Prove that a delivered level carries no total, and that the panel's cumulative column reads the same as it did before this change for the same book — 44 rows at a five-tick step, grouped from the trimmed delivery and from the whole book, compared row for row.
- [x] 4.6 Prove that a frame at the widest legal delivery is still within the byte ceiling and parses to completion. *(Bytes: `keeps a full delivered book inside the protocol frame ceiling` and the byte-ratio case. Parse: `parses the deepest legal depth frame rather than running out of budget`, updated to the new level shape.)*
- [x] 4.7 Prove the floor holds under a range narrower than it.
- [x] 4.8 Prove at the service that the reading is stated to the book, that a changed reading redelivers, and that it buys nothing to do so.

## 5. Verification

- [x] 5.1 Re-measure frame size and the per-frame cost of `toRendererView`, both serializations, and the renderer's parse-validate path at a realistic range. Recorded below.
- [x] 5.2 `npm run lint`, `npm test` (1497 passed), `npm run check:futures-production`.
- [x] 5.3 Operator confirms on live data that the book on a liquid contract draws the same rows, the same sizes and the same cumulative column as before, at every grouping step the contract offers — including 1× on a contract whose levels rest far apart, which is what §1.5 exists for, and a step change on a quiet contract, which is what §1.6 exists for — step 8, «Стакан на всех шагах группировки», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list. The step names the ladder rather than saying "every step", because "every" is what an operator satisfies with three: it is `GROUPING_MULTIPLIERS` = 1, 2, 5, 10, 25, 50, 100, 200, 500, 1000 (`src/utils/futuresOrderBook.js`), of which a contract offers the prefix its own book reaches — see `end-the-book-where-the-market-does`.

### Measured

A thousand retained levels a side on a contract priced near 1.55 to a tenth of a
basis point, read at forty-four rows and a five-tick step (range `0.0220`). HEAD's
own order-book and protocol modules against the working tree's, same book, same
machine.

| | before | after |
| --- | --- | --- |
| Levels delivered per side | 1000 | 221 |
| Frame on the wire | 120.9 KiB | **18.0 KiB** (6.7× smaller) |
| `toRendererView` | 1.740 ms | 0.457 ms |
| `JSON.stringify` (paid twice a frame) | 0.184 ms | 0.033 ms |
| Renderer bounded parse + validate + freeze | 2.789 ms | 0.506 ms |
| **One frame, end to end** | **4.897 ms** | **1.029 ms** |
| At the exchange's 100 ms cadence | 49.0 ms/s | **10.3 ms/s** |

## 6. Left For A Later Change

- [x] 6.1 Handed off to the separate `select-the-book-before-sorting` change: `toRendererView` still sorts the whole retained side before trimming — `sortedByPrice` parses and orders a thousand prices to keep two hundred and twenty. At 0.457 ms it is now the largest single cost left in the main process's depth path. The bounded-selection implementation and its proof belong only to that follow-up; this change gains no new implementation from the handoff.
