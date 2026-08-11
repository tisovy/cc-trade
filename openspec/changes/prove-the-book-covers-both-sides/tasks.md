## 1. The Shortfall Is Measured Per Side

- [ ] 1.1 Compute the shortfall for the bid side and the ask side separately — each against the distance its own best price needs from its own edge of the band — and report the worse of the two.
- [ ] 1.2 Keep the ratio's meaning: how many times deeper the page has to be, so a step several sizes coarser still buys its page in one read.
- [ ] 1.3 Keep the two cases `ensureDepthCovers` already separates — a band too narrow buys a deeper page, a band wide enough that the market walked out of it re-reads the page it holds — and decide between them per side.
- [ ] 1.4 Prove by test that the audit's case buys depth: bids 10 down to 9.9, asks 10.1 up to 12, range 1 — one side short, total span coincidentally sufficient.
- [ ] 1.5 Prove by test that a side emptied by the walk, which states no measurable shortfall, still asks for a fresh reading.

## 2. Coverage Is Judged Before Delivery

- [ ] 2.1 Move the coverage check ahead of the depth delivery in `handleStreamFrame`, so the state a frame carries is decided by the book that frame contains.
- [ ] 2.2 Deliver a book that does not cover the stated range on both sides as `stale` rather than `live`, and keep delivering it — the rows it can prove are worth reading.
- [ ] 2.3 Return the resource to `live` on the first delivery that covers both sides again, without waiting for a status change to say so.
- [ ] 2.4 Apply the same rule to the bootstrap and recovery deliveries, so no path can state `live` over a short book.
- [ ] 2.5 Prove by test that a book short on one side is delivered `stale`, that it still carries its rows, and that it returns to `live` when the deeper page lands.

## 3. The First Page Covers The Rows

- [ ] 3.1 Carry the panel's range on the request that subscribes to a contract and on the one that selects another, so the range is known before the first snapshot is bought.
- [ ] 3.2 Validate the carried range exactly as `configure-depth` validates it, and treat a request without one as today's behaviour — the cheapest page.
- [ ] 3.3 State the range from the renderer at subscribe and select time, from the step stored for that contract and the rows the panel measures.
- [ ] 3.4 Keep the rule that a range is never carried from one contract to another: it is a distance in the contract's own quote currency.
- [ ] 3.5 Prove by test that opening a contract whose stored step needs a deep page takes one snapshot at that page rather than climbing the ladder.

## 4. Deepening Is Not Held Behind The Recovery Backoff

- [ ] 4.1 Let a page deepening proceed without waiting out the recovery cooldown; the ladder's four rungs and its one-way ratchet are what bound it.
- [ ] 4.2 Keep the backoff on a recovery that failed, and keep the read budget as the ceiling on what deepening may spend.
- [ ] 4.3 Prove by test that a book short by three rungs reaches the page that covers it in one read, not in three cooldowns.
- [ ] 4.4 Prove by test that a repeatedly failing recovery still backs off, and cannot be turned into a hot loop by a persistent shortfall.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Record the measured time from a coarse step being selected to a book that covers it, before and after.
- [ ] 5.3 Operator confirms on live data, on a contract that moves fast, that the book either fills both sides or reads `STALE` — and never shows a short side under a green badge.
