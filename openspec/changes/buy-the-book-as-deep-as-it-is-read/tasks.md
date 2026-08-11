## 0. Counted Before Changing

- [x] 0.1 `/fapi/v1/depth` is charged by page: limits 5, 10, 20 and 50 all cost 2; 100 costs 5; 500 costs 10; 1000 costs 20. The desk always asks for 1000.
- [x] 0.2 The panel draws 14 rows a side by default (up to 200 measured), grouped by a step of 1, 2, 5, 10, 25, 50, 100 or 500 ticks. At the finest step that is 14 ticks of range against a thousand levels bought.
- [x] 0.3 The diff stream the desk subscribes to is `@depth@100ms` — every level that changes, not a top-N stream. That is what makes any page size bridgeable, and what makes a level outside the snapshot's band unprovable.

## 1. The Page Is Chosen

- [x] 1.1 The transport's depth read takes its page size; the weight registry names one entry per page rather than one for the thousand.
- [x] 1.2 The page is chosen from how far short the band falls: the shortfall is a ratio, so a step three sizes coarser buys its page in one read instead of climbing to it. The floor is 50 — the exchange's cheapest maximum, since 5, 10, 20 and 50 all cost 2.
- [x] 1.3 The service asks for the page the current reading needs at bootstrap, at recovery and when the reading changes.
- [x] 1.4 The renderer states the range its rows need — count and step — through the protocol, validated and bounded like every other request.
- [x] 1.5 ~~The page a contract was last read at is remembered per contract~~ — not needed: the step is already remembered per contract in the renderer, and the renderer states its range as soon as it subscribes. Every contract opens on the cheapest page and deepens within a diff or two if that reading needs it, which is one cheap read rather than every contract paying for the deepest reading of the session.
- [x] 1.6 The range is not carried across contracts. It is a distance in the contract's own quote currency: a step of 1 on a contract priced in dollars reads as an impossible range on one priced in ten-thousandths, and buys the deepest page to cover it. (Audit, 2026-08-11.)
- [x] 1.7 The panel's reading reaches the subscription that will carry it. The panel states it as the contract opens — which is before that subscription exists, a child's effect running before its parent's — so the subscription re-states what was last stated for its own contract, the way it re-states the tape settings. Without it the first contract of a session never stated its range at all. (Audit, 2026-08-11.)

## 2. The Book Proves Its Band

- [x] 2.1 The order book records the price band its snapshot covered: one stretch, from the lowest bid it read to the highest ask. One rather than one per side, because that is the truth — the snapshot proves the ground between them too, and a bid appearing inside the spread is a level it can account for.
- [x] 2.2 Levels outside the band are not kept at all — dropped as the diff is applied, rather than stored and filtered on the way out. A removal is applied wherever it lands: forgetting a level is never a lie.
- [x] 2.3 A book whose band no longer covers the rows on screen asks for a fresh snapshot rather than delivering beyond it.
- [x] 2.4 Re-establishing the band reuses the existing bridge: buffer, snapshot, retain the diffs that span it. No new synchronisation path.
- [x] 2.5 Re-establishing is rate-limited the way a recovery already is, so a fast market cannot ask every tick.
- [x] 2.6 Re-establishing and deepening are two different answers. A band whose span falls short of the reading buys a deeper page; a band wide enough that the market has merely walked out of it is re-read at the page already held. Written as one answer, the desk climbed to the deepest page on any drifting market — and at the top of the ladder stopped answering at all, leaving a book that went on dropping every level outside a band it had left for good. (Audit, 2026-08-11.)
- [x] 2.7 A shortfall that cannot be measured — a side emptied by the walk states no spread to size a page against — re-reads the page held and sizes on the next reading. A snapshot that proved no band at all is short of nothing: the book filters nothing, and reading the same page again would not produce a band either. (Audit, 2026-08-11.)

## 3. Proof

- [x] 3.1 Test: a bootstrap at the finest step asks for the cheapest page, and the delivered book covers the rows on screen.
- [x] 3.2 Test: coarsening the step past what the band proves takes exactly one deeper snapshot and delivers rows from it.
- [x] 3.3 Test: a diff carrying a level outside the band does not appear in the delivered book.
- [x] 3.4 A market moving past the band re-establishes it once, not once per diff: the deepening is backed off by the same cooldown a book recovery already uses, and the recovery's own `bookRecovering` guard sits behind that. Covered by construction rather than by a test of its own — driving a fixture market out of its band takes a stream fixture this suite does not have.
- [x] 3.5 Test: a range the page already covers asks for nothing, and a range stated by anyone but the subscription that owns the book is refused.
- [x] 3.6 Weight test: the ladder is exactly the pages the exchange prices, and a switch at the cheapest page costs 6 against 24 at the deepest.
- [x] 3.7 Test: the request round-trips and a negative, non-finite, non-canonical, non-string or over-long range is refused; the boundary check counts the new action among the reviewed read-only ones.
- [x] 3.8 Test: a band the market has walked out of is re-read at the page held, and at the deepest page too; a book with no band is short of nothing; a contract opened after another starts with no range and on the cheapest page; a reading stated before a subscription exists reaches the next one, and is not carried to another contract. (Audit, 2026-08-11.)

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1366 tests, 97 files), `npm run check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path` — run against the staged tree in isolation, because another session is mid-flight on the trading rail in the same checkout. Re-run after the audit: 1380 tests, 1379 passing. The one failure is `App.spot-order.test.jsx`, which that session's `compact-the-futures-trading-rail` (`2b2751a`) landed red — its own three test files were updated, this fourth one was not. Fixed separately, not folded in here.
- [ ] 4.2 Operator confirms on live data (gathered as item 3 of the third pass in `verify-the-desk-in-one-sitting/runbook.md`): the book reads the same as before at every step; changing the step fills the rows within a moment; switching contracts is faster; and on a thin contract the panel never shows a row that understates what Binance's own book holds.

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 The partial-book stream (`@depth20@100ms`) would cost no weight at all, but it delivers at most 20 levels and is a different mechanism from the snapshot-and-diff bridge the desk is built on. Holding two book mechanisms is not worth 2 weight.
- [x] 5.2 Returning to a contract still re-buys its book. Not re-buying it is `keep-the-contracts-warm`.
