## 0. Counted Before Changing

- [x] 0.1 One contract switch costs 24 weight against a ceiling of 120: a 1000-level depth snapshot at 20, plus contract klines, index klines, premium index and ticker at 1 each. Five switches fill the window.
- [x] 0.2 A switch whose depth bridge misses retries the snapshot up to three more times — 84 for one switch. One book-recovery round is up to three snapshots, 60, and may run once every 5 seconds.
- [x] 0.3 A refusal costs more than the read: `scheduleResync` closes all three sockets and spends one of eight reconnect attempts, so a full window churns 24 upstream connections over 92 seconds and ends `UNAVAILABLE`.
- [x] 0.4 Replayed the operator's minute against the real budget on a driven clock — five switches over 32s, one book recovery at 42s, one more switch at 45s. Old window: 8 of 33 reads refused, and the refused ones are exactly the recovery and the whole sixth switch. The read budget, not the exchange, is what ended his session.

## 1. The Window Delays Rather Than Refuses

- [x] 1.1 `FuturesWorkstationReadBudget` computes when the window will hold room for the read at the head of its queue, and waits until then instead of rejecting it.
- [x] 1.2 The wait is bounded by one window; beyond that the read is refused with `READ_WEIGHT_EXHAUSTED`, which now means what it says.
- [x] 1.3 The queue stays FIFO — a waiting read blocks the reads behind it rather than being overtaken by cheaper ones, so the depth snapshot cannot be starved.
- [x] 1.4 Timers are injectable, so the wait is provable without sleeping in a test.
- [x] 1.5 A read abandoned while waiting is removed and the wait is recomputed for whatever is now at the head.
- [x] 1.6 The wait is taken before the request's own 10-second deadline starts: `publicGet` builds its deadline inside the operation the budget admits, so waiting for room can never be reported as the exchange timing out.

## 2. The Ceiling Matches The Desk

- [x] 2.1 The public-read ceiling is a named constant sized against a contract switch, not a bare default.
- [x] 2.2 It is 600 per minute: a quarter of the 2400 the exchange allows one address, leaving the account reader's 800 and 1000 more unspent.
- [x] 2.3 Both changes are worth having. Replayed on the same minute: waiting alone at the old ceiling serves all 33 reads but makes the last of them wait 39 seconds; at 600 every read is served the moment it is asked for, including the switch that used to die.

## 3. Proof

- [x] 3.1 Budget test: a read with no room is issued when the window frees, not refused, and the operation runs exactly once.
- [x] 3.2 Budget test: the wait is exactly as long as the window needs — asserted at 60 999ms (not yet) and 61 000ms (served), not a window later.
- [x] 3.3 Budget test: a read abandoned while waiting rejects as abandoned, holds no weight, and the read behind it is served on its own schedule.
- [x] 3.4 Budget test: a wait longer than the bound is refused with `READ_WEIGHT_EXHAUSTED`.
- [x] 3.5 Budget test: concurrency and queue bounds are unchanged; an operation heavier than the whole window is still invalid.
- [x] 3.6 Transport test: the stated ceiling admits at least twenty contract switches in one window, and stays clear of the exchange's per-address allowance beside the account reader's claim.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1334 tests, 97 files), `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data: switching between contracts repeatedly — including on a thin contract whose book needs recovering — no longer reaches `RESYNCHRONIZING · READ_WEIGHT_EXHAUSTED`.

## 5. Stated Limits, Not Fixed Here

- [x] 5.1 A switch back to a contract looked at a moment ago still pays the full 24 — the desk holds one contract at a time. That is `keep-the-contracts-warm`.
- [x] 5.2 A book recovery still costs up to 60 weight per round on a thin contract. Making a refused frame cost the book rather than a fresh snapshot is `hold-the-book-through-a-spike`.
- [x] 5.3 The banner still states the raw reason code (`reason READ_WEIGHT_EXHAUSTED` in the operator's screenshot). Saying it in the operator's own terms is `report-execution-state-truthfully`.
- [x] 5.4 The depth snapshot stays at 1000 levels. It is what Binance's documented local-book algorithm asks for, and the phase-8 audit set it deliberately; halving it would halve the switch cost and is a separate decision with its own evidence.
- [x] 5.5 A refusal that does reach the service is still handled as a market-data fault — sockets closed, one of eight reconnect attempts spent. With the window waited out rather than refused, reaching it means a whole minute passed without room, which is a real fault. Making a local refusal cost less than a resync belongs with the session pool.
