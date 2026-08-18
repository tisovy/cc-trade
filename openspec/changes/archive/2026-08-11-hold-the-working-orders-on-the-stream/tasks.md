## 0. Counted Before Changing

- [x] 0.1 One refresh pass is 90 weight, of which 80 is the two account-wide order reads: `/fapi/v1/openOrders` without a symbol costs 40 (with a symbol, 1), and `openAlgoOrders` costs 40.
- [x] 0.2 A pass is triggered by every `FILLED`/`PARTIALLY_FILLED` execution report, every `ACCOUNT_UPDATE`, every mutation, and a 30-second beat while orders are working — 180 a minute from the beat alone, against a bucket of 800.
- [x] 0.3 `ORDER_TRADE_UPDATE` already carries the whole order and is already normalized and broadcast (`binance-connection.js:1281`). The 80 weight confirms what arrived free.

## 1. The Set Is Held And Maintained By The Stream

- [x] 1.1 `foldFuturesWorkingOrder` folds one execution report into the held `regularOrders` resource, keyed by symbol and order id.
- [x] 1.2 A report reporting `NEW` or `PARTIALLY_FILLED` updates the held order in place, or adds it.
- [x] 1.3 Any other status removes it. Written as the set that stays working rather than the set that settles, so a status nobody anticipated drops out instead of resting there forever.
- [x] 1.4 `FuturesSettledOrderMemory` keeps a late report from putting a settled order back, and keeps a read that left before the settle from doing the same — that read can now be older than the stream, which it never was while every fill dragged one behind it.
- [x] 1.5 A fold that changes the set broadcasts it; one that changes nothing returns the same object and broadcasts nothing.
- [x] 1.6 A fold updates the data, not the proof: `status` and `lastSuccessfulAt` are left as they are, so a set marked stale by a reconnect stays stale until a read says otherwise.

## 2. A Read Happens For A Reason

- [x] 2.1 `runFuturesAccountRefreshPass(resources)` takes which resources the pass is for; `null` is all four.
- [x] 2.2 A full pass runs on activation, on user-data stream connect and reconnect, on every mutation, and on the `account.refresh` command — which is both the operator's refresh and the renderer's beat.
- [x] 2.3 An execution report asks for balances and positions only — what a fill actually moves — at 5 each.
- [x] 2.4 `ACCOUNT_UPDATE` asks for the same two.
- [x] 2.5 The 30-second beat is untouched: it is the backstop for an event the exchange never sent.
- [x] 2.6 Algo orders are read on the full pass only, never on an execution report or a position change. The desk cannot place them, and the stream does not report the Futures Algo parent.
- [x] 2.7 Passes queued while one runs collapse into the union of what they asked for, never into less — a fill's two resources queued behind a full read must not turn that read into a partial one.

## 3. What Is Held Is Marked For What It Is

- [x] 3.1 The reconnect path already marks both order resources stale until a read lands, and still does — covered by the existing user-data lifecycle test.
- [x] 3.2 A fold into a set that has never been read is refused: a list built from the one report that happened to arrive would present a one-order account as the whole of it.
- [x] 3.3 The settled memory is dropped with the market, beside the held leverages and the held discovery. It is a memory of one account's stream, and an account nobody is on has no stream — held across a market put away and picked up again, it would silently hide a working order the next read is right about. (Audit, 2026-08-11.)

## 4. Proof

- [x] 4.1 Test: a `NEW` report adds the order to the broadcast set with no REST read issued.
- [x] 4.2 Test: a `FILLED` report removes it, with neither order list read; balances and positions are.
- [x] 4.3 Test: the whole sequence — read, open, fill — issues the account-wide order reads exactly as many times as the setup did. Proved discriminating: with the fill asking for every resource again, the same test reads three times instead of two.
- [x] 4.4 Covered by the existing lifecycle test: a reconnect issues a full pass and marks the set stale until it lands.
- [x] 4.5 The `account.refresh` command issues every read, algo orders included — unchanged, and covered by the existing refresh tests.
- [x] 4.6 The beat is the renderer's, unchanged, and covered by its own test.
- [x] 4.7 Test: a stale `NEW` report does not put back an order the stream settled; a read that left before the settle does not either.
- [x] 4.8 Test: the settled memory is bounded and drops the oldest.
- [x] 4.9 Test: a report for an order kind the stream does not speak for is ignored.
- [x] 4.10 Test: a market put away and picked up again believes the read it disbelieved before — proved discriminating, it fails without the drop. (Audit, 2026-08-11.)

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test` (1349 tests, 97 files), `npm run check:futures-production`, `npm run check:command-path`.
- [x] 5.2 Operator confirms on live data (gathered as item 5 of the third pass in `verify-the-desk-in-one-sitting/runbook.md`): placing, filling and cancelling orders keeps the working-orders list exactly right without waiting for a refresh, and an order cancelled from Binance's app disappears within the beat.

## 6. Stated Limits, Not Fixed Here

- [x] 6.1 Positions and balances are still read on a fill. Deriving them from `ACCOUNT_UPDATE`'s own payload would save 10 more, and would have to answer for the liquidation price, which that payload does not carry. That belongs with `move-the-pnl-with-the-market`.
- [x] 6.2 Every mutation still asks for a full pass. They are the operator's own hands rather than the exchange's stream, so they are bounded by how fast a person acts — and the confirmed-order guarantees are built on that read.
