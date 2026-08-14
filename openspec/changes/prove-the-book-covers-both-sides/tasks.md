## 1. The Shortfall Is Measured Per Side

- [x] 1.1 Compute the shortfall for the bid side and the ask side separately — each against the distance its own best price needs from its own edge of the band — and report the worse of the two.
- [x] 1.2 Keep the ratio's meaning: how many times deeper the page has to be, so a step several sizes coarser still buys its page in one read.
- [x] 1.3 Keep the two cases `ensureDepthCovers` already separates — a band too narrow buys a deeper page, a band wide enough that the market walked out of it re-reads the page it holds — and decide between them per side.
- [x] 1.4 Prove by test that the audit's case buys depth: bids 10 down to 9.9, asks 10.1 up to 12, range 1 — one side short, total span coincidentally sufficient.
- [x] 1.5 Prove by test that a side emptied by the walk, which states no measurable shortfall, still asks for a fresh reading.
- [x] 1.6 Record on the band what each side reached when the page was read, not only where its edges are. *(Discovered: §1.3 cannot be answered from the current distance to the edge alone. A side that has been walked out of and a side whose page was never deep enough look identical from there — both are short — and treating both as short would make every drifting market climb the ladder to the deepest page, which is what the existing total-span measure was protecting against. What separates them is what the page proved when it was bought, so the band now carries it.)*

## 2. Coverage Is Judged Before Delivery

- [x] 2.1 Move the coverage check ahead of the depth delivery in `handleStreamFrame`, so the state a frame carries is decided by the book that frame contains.
- [x] 2.2 Deliver a book that does not cover the stated range on both sides as `stale` rather than `live`, and keep delivering it — the rows it can prove are worth reading.
- [x] 2.3 Return the resource to `live` on the first delivery that covers both sides again, without waiting for a status change to say so.
- [x] 2.4 Apply the same rule to the bootstrap and recovery deliveries, so no path can state `live` over a short book.
- [x] 2.5 Prove by test that a book short on one side is delivered `stale`, that it still carries its rows, and that it returns to `live` when the deeper page lands.
- [x] 2.6 Measure the shortfall once per frame and pass it to both the delivery and the page decision. *(Discovered: judging coverage at delivery asks the same question `ensureDepthCovers` already asks, and asking it twice is four more scans of a thousand-level side per frame — a tenth of the per-frame budget the previous change just bought back.)*
- [x] 2.7 Keep the levels of a short book selectable. *(Discovered: the panel disabled every book level unless the depth resource read `live`. Delivering a short book as stale would have made its levels unclickable — on a contract whose page does not reach deep enough for the step it is read at, permanently. A short book is exact and current in every level it carries, a click seeds a draft price, and the operator confirms at the cursor; what is gated on `live` is not the price but the badge.)*

## 3. The First Page Covers The Rows

- [x] 3.1 Carry the panel's range on the request that subscribes to a contract and on the one that selects another, so the range is known before the first snapshot is bought.
- [x] 3.2 Validate the carried range exactly as `configure-depth` validates it, and treat a request without one as today's behaviour — the cheapest page.
- [x] 3.3 State the range from the renderer at subscribe and select time, from the step stored for that contract and the rows the panel measures.
- [x] 3.4 Keep the rule that a range is never carried from one contract to another: it is a distance in the contract's own quote currency.
- [x] 3.5 Prove by test that opening a contract whose stored step needs a deep page takes one snapshot at that page rather than climbing the ladder.
- [x] 3.6 Restore a contract's stored step while rendering rather than from an effect. *(Discovered: the panel restored the step in an effect keyed on the symbol, which lands one commit after the request that opens the contract has gone out. Measured on the switch itself, the panel stated the range of the contract being *left* first and the right one afterwards — so the request carried a reading for the wrong step. Proven by test: the calls were `['1.4']` then `['70']`, and are now `['70']`.)*
- [x] 3.7 Correct the spec's claim that the first snapshot is bought at the covering page. *(Discovered: a page is a count of levels and a range is a distance in price, and nothing translates one into the other before a band has been read — the only way to buy the covering page first would be to buy `range ÷ tick` levels, which over-buys by an order of magnitude on every sparse contract. What the carried range removes is the wait, not the first read: the covering page is bought against the first band, in one read, rather than after a second message and whichever diff arrives next.)*

## 4. Deepening Is Not Held Behind The Recovery Backoff

- [x] 4.1 Let a page deepening proceed without waiting out the recovery cooldown; the ladder's four rungs and its one-way ratchet are what bound it.
- [x] 4.2 Keep the backoff on a recovery that failed, and keep the read budget as the ceiling on what deepening may spend.
- [x] 4.3 Prove by test that a book short by three rungs reaches the page that covers it in one read, not in three cooldowns.
- [x] 4.4 Prove by test that a repeatedly failing recovery still backs off, and cannot be turned into a hot loop by a persistent shortfall.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test` (1520 passed), `npm run check:futures-production`.
- [x] 5.2 Record the measured time from a coarse step being selected to a book that covers it, before and after. Recorded below.
- [ ] 5.3 Operator confirms on live data, on a contract that moves fast, that the book either fills both sides or reads `STALE` — and never shows a short side under a green badge — step 9, «Стакан отвечает за обе стороны», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list.

### Measured

A book with one side five times thinner than the other — levels a cent apart
below the mid and five cents apart above it, which is what an illiquid bid side
is — read at a step whose rows reach 6 past the best price. HEAD's own copy of
the desk, extracted with `git archive`, against the working tree's; the same
transport, the same book, the same reading, the same clock.

| | before | after |
| --- | --- | --- |
| Pages read | 50 → 500 | 50 → 1000 |
| Book covers the rows | **no** | **yes** |
| Time from the step being selected | never | **213 ms** |
| Shortfall it would act on next | 1 — "deep enough, the market walked" | 0 |

Before is not slow, it is stuck: measured on the total span, the wide ask side
pays for the thin bid side, the ratio comes out at exactly 1, and the desk
re-reads the same page every five seconds for the rest of the session — getting
the same asymmetry each time. The operator reads a short bid side under a green
badge for as long as they leave the contract open.

Opened at the reading rather than told it afterwards — the range on the request
that selects the contract — the same book covers **218 ms after the request**,
bootstrap included.
