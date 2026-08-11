## 0. Counted Before Changing

- [ ] 0.1 `/fapi/v1/depth` is charged by page: limits 5, 10, 20 and 50 all cost 2; 100 costs 5; 500 costs 10; 1000 costs 20. The desk always asks for 1000.
- [ ] 0.2 The panel draws 14 rows a side by default (up to 200 measured), grouped by a step of 1, 2, 5, 10, 25, 50, 100 or 500 ticks. At the finest step that is 14 ticks of range against a thousand levels bought.
- [ ] 0.3 The diff stream the desk subscribes to is `@depth@100ms` — every level that changes, not a top-N stream. That is what makes any page size bridgeable, and what makes a level outside the snapshot's band unprovable.

## 1. The Page Is Chosen

- [ ] 1.1 The transport's depth read takes its page size; the weight registry names one entry per page rather than one for the thousand.
- [ ] 1.2 The page is the smallest that covers the range the reading needs — rows × step, with margin — and never smaller than the exchange's cheapest maximum of 50.
- [ ] 1.3 The service asks for the page the current reading needs at bootstrap, at recovery and when the reading changes.
- [ ] 1.4 The renderer states the range its rows need — count and step — through the protocol, validated and bounded like every other request.
- [ ] 1.5 The page a contract was last read at is remembered per contract, beside the grouping step already remembered there.

## 2. The Book Proves Its Band

- [ ] 2.1 The order book records the price band its snapshot covered, per side.
- [ ] 2.2 Levels outside the band are kept but not delivered; the renderer view is truncated to the band.
- [ ] 2.3 A book whose band no longer covers the rows on screen asks for a fresh snapshot rather than delivering beyond it.
- [ ] 2.4 Re-establishing the band reuses the existing bridge: buffer, snapshot, retain the diffs that span it. No new synchronisation path.
- [ ] 2.5 Re-establishing is rate-limited the way a recovery already is, so a fast market cannot ask every tick.

## 3. Proof

- [ ] 3.1 Test: a bootstrap at the finest step asks for the cheapest page, and the delivered book covers the rows on screen.
- [ ] 3.2 Test: coarsening the step past what the band proves takes exactly one deeper snapshot and delivers rows from it.
- [ ] 3.3 Test: a diff carrying a level outside the band does not appear in the delivered book.
- [ ] 3.4 Test: the market moving past the band triggers one re-established band, not one per diff.
- [ ] 3.5 Test: returning to a contract read at a coarse step opens at that page.
- [ ] 3.6 Weight test: a session of five switches at the default step costs what five cheap pages cost, not five thousand-level pages.
- [ ] 3.7 Test: the renderer's stated range is bounded and a malformed one is refused, like every other request field.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data: the book reads the same as before at every step; changing the step fills the rows within a moment; switching contracts is faster; and on a thin contract the panel never shows a row that understates what Binance's own book holds.

## 5. Stated Limits, Not Fixed Here

- [ ] 5.1 The partial-book stream (`@depth20@100ms`) would cost no weight at all, but it delivers at most 20 levels and is a different mechanism from the snapshot-and-diff bridge the desk is built on. Holding two book mechanisms is not worth 2 weight.
- [ ] 5.2 Returning to a contract still re-buys its book. Not re-buying it is `keep-the-contracts-warm`.
