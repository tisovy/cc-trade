## 1. Measured First

- [x] 1.1 Read the cost out of the desk's own journal rather than estimating it. `~/.config/cc-trade/diagnostics/desk-2026-08-{12,13}-000.jsonl`: `book-recovery:DEPTH_RANGE_SHORT` is the **only** fault kind recorded on either day — 33 over 10 hours and 155 over 14 hours, by hour on the 13th `{07:18, 08:2, 10:12, 11:3, 13:3, 14:18, 15:13, 16:4, 17:10, 18:26, 19:34, 20:12}`. Each is a REST depth snapshot. No `DEPTH_SEQUENCE_GAP`, no `MALFORMED_DEPTH_FRAME`: on this desk the reading is what drives depth reads, and nothing else does.
- [x] 1.2 State what those reads are spent against. One `PUBLIC_READ_BUDGET` is shared by every session — `MAXIMUM_WEIGHT: 600` a minute, `maximumConcurrent: 5`, queue 16 — and its own note sizes it against one contract: a switch is weight 24, a book-recovery round up to 60. A depth page is weight 2 at 50 levels and 20 at 1000.
- [x] 1.3 Say plainly what the pool would have done to that. At the peak hour measured, eight contracts behaving like the one measured is ~272 snapshot reads an hour — about 4.5 a minute, 90 to 270 weight a minute — and, worse than the weight, five concurrent slots shared with the contract the operator is trading on.

## 2. The Page Belongs To The Book On Screen

- [x] 2.1 Buy a page only for the session being shown. A held session keeps applying every diff and stays sequence-correct; it stops asking the exchange to keep a band centred under rows that are not drawn.
- [x] 2.2 Leave the shown contract's behaviour untouched, including the ladder, the cooldown and the exemption for a rung.
- [x] 2.3 Let a selection buy what it needs: the delivery of a held contract already measures the shortfall and calls the same path, so a drifted book is repaired one round trip after it is asked for.

## 3. A Book That Walked Off The Market Says So

- [x] 3.1 Ask `holdsMarket()` in the delivery state as well as the shortfall. With no reading stated the shortfall is zero by definition, so a book the market had walked out of was stated as live on the ground that nothing had been asked of it — reachable before this change for at most a repair cooldown, and for as long as a contract goes unselected after it.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1904 passed, 110 files), `check:futures-production`, `check:circular`, `check:runtime-mock`, `check:command-path` — run in a tree built from the staged index.
- [x] 4.2 Prove by test that a held contract whose band has stopped covering its reading buys nothing, and that the same state on the shown contract still buys a page. **Bites**: against the code before this change the held contract issued three further reads where it now issues none.
- [x] 4.3 Prove by test that a book that no longer holds the market is delivered stale. **Bites**: it was delivered live.
- [ ] 4.4 Operator confirms on live data that returning to a contract left for a long while shows a book that either is current or says it is not, and that the fault journal no longer fills with `DEPTH_RANGE_SHORT` for contracts they were not looking at.
  → handed to `verify-the-desk-in-one-sitting/runbook.md`, шаг 39 п.5–6 (freshness on return) and шаг 34 (the journal).

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 The fault and timing lines the desk records carry no contract. With one contract that was unambiguous; with eight it is not, and an operator reading the journal cannot tell which contract a `DEPTH_RANGE_SHORT` or a bootstrap timing belongs to. `status` records already carry `symbol` and the record schema already supports optional fields, so this is small — but it spans `desk-diagnostic-record.js`, `binance-connection.js` and `scripts/read-desk-record.mjs`, which another session holds. Left as its own change rather than folded in here.
