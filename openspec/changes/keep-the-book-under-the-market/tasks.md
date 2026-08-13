## 1. The Band Is Asked Whether It Still Holds The Market

- [x] 1.1 Add a question to the order book that is answered without reference to the stated range: whether each side still has room between its best price and its edge of the band.
- [x] 1.2 Judge that room against what the side's page proved when it was read, so the answer means the same thing at every page depth and on every contract, rather than against a distance in the contract's own quote currency.
- [x] 1.3 Set the threshold at a quarter of the proven room, and say in the code why it is not zero: a side re-read when it has run out has already been empty on screen; a side re-read with a quarter left is refilled before the rows run out.
- [x] 1.4 Answer "yes" when there is no band at all — a snapshot that came back with a side empty proves no room to measure, and re-reading it on that basis would be a loop with no exit.
- [x] 1.5 Read the best prices once for the question rather than once per side comparison.
- [x] 1.6 Prove by test that a band the market has walked three quarters of the way out of on one side answers "no", and one the market is resting in the middle of answers "yes". *(These four are unit tests of a method that did not exist, so against the tree before this change they fail as "not a function" rather than on behaviour. The bite is in §2.6; these state the threshold and its edges — 0.3 of the proven room holds, 0.2 does not — so a later change cannot move it silently.)*

## 2. An Off-Centre Band Is Re-Read At Any Page Depth

- [x] 2.1 Separate the two decisions in `ensureDepthCovers`: what the reading needs, which buys depth, and whether the band still holds the market, which buys a re-read.
- [x] 2.2 Re-read an off-centre band whatever its shortfall and whatever its page, including the deepest page the exchange publishes.
- [x] 2.3 Keep the existing rule for a band that still holds the market: a page short of the rows that cannot be deepened is left alone, so a contract published no deeper than this does not re-read every cooldown for the session.
- [x] 2.4 Keep the recovery cooldown on the re-read, and keep a deepening exempt from it.
- [x] 2.5 Ask the question on the path that already measures the shortfall per applied diff, so the cost is one more pair of scans and not one more pass over the book.
- [x] 2.6 Prove by test that a band bought at the deepest page, short of the rows, and walked out of by the market is re-read — the case the desk was in on AKEUSDT — and prove it bites: the same test against the tree before this change. *(Measured: `expected 1 to be 2` — one snapshot read, where the fixed desk takes two. The desk had read the exchange once and never again.)*
- [x] 2.7 Prove by test that a band bought at the deepest page, short of the rows, and still holding the market is *not* re-read, so the fix cannot become the hot loop the old branch was avoiding. *(A guard, not a finding: it passes against the tree before this change, which is the point — it holds the old branch's reason in place while the branch beside it is opened.)*
- [x] 2.8 Name the walk apart from the shortfall in the desk's own record. *(Discovered: the recovery had one reason code, `DEPTH_RANGE_SHORT`, and the operator is asked in §3.3 to compare a session's count against 153. A re-read taken because the band covers the rows and the market left it anyway is not a range falling short, and counting the two together would have made the comparison meaningless. A read the reading asked for keeps the old code — a page short of the rows is the condition worth seeing — and a read the market asked for is `DEPTH_BAND_WALKED`.)*

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test` (1891 passed), `npm run check:futures-production`.
- [x] 3.2 Record what the desk's journal shows for `DEPTH_RANGE_SHORT` before this change, so the operator's next session can be compared against it: 153 on 2026-08-13, 60 of them between 18:00 and 20:00 UTC. Median gap between them 39 s, tenth percentile 7.6 s.
- [ ] 3.3 Operator confirms on live data, on a contract that breaks hard — AKEUSDT is the one it was reported on — that both sides of the book keep filling through the break, step 42, «Стакан держится под рынком», in `verify-the-desk-in-one-sitting/runbook.md`, so the operator runs one list.
