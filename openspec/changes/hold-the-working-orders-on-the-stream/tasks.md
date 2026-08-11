## 0. Counted Before Changing

- [ ] 0.1 One refresh pass is 90 weight, of which 80 is the two account-wide order reads: `/fapi/v1/openOrders` without a symbol costs 40 (with a symbol, 1), and `openAlgoOrders` costs 40.
- [ ] 0.2 A pass is triggered by every `FILLED`/`PARTIALLY_FILLED` execution report, every `ACCOUNT_UPDATE`, every mutation, and a 30-second beat while orders are working — 180 a minute from the beat alone, against a bucket of 800.
- [ ] 0.3 `ORDER_TRADE_UPDATE` already carries the whole order and is already normalized and broadcast (`binance-connection.js:1281`). The 80 weight confirms what arrived free.

## 1. The Set Is Held And Maintained By The Stream

- [ ] 1.1 The main process holds the working-order set as the resource the renderer is given, keyed by order identity.
- [ ] 1.2 An execution report reporting `NEW`, `PARTIALLY_FILLED` or an amendment updates the held order in place.
- [ ] 1.3 An execution report reporting `FILLED`, `CANCELED`, `EXPIRED` or `REJECTED` removes it.
- [ ] 1.4 A report that arrives out of order does not resurrect a settled order — the settled memory the renderer already keeps has its counterpart here.
- [ ] 1.5 Every fold broadcasts the account state, so the renderer sees the same set it would have seen after a read.

## 2. A Read Happens For A Reason

- [ ] 2.1 A refresh pass takes which resources it is for; the four resources stop being all-or-nothing.
- [ ] 2.2 A full pass — every resource — runs on activation, on user-data stream connect and reconnect, and on an operator-requested refresh.
- [ ] 2.3 An execution report triggers no account-wide order read. Balances and positions may still be read, at 5 each, because a fill is what changes them.
- [ ] 2.4 `ACCOUNT_UPDATE` triggers balances and positions, not orders.
- [ ] 2.5 The 30-second beat stays as it is: it is the backstop for an event the exchange never sent.
- [ ] 2.6 Algo orders are read on the full pass and on the beat only — never on an execution report or a position change.

## 3. What Is Held Is Marked For What It Is

- [ ] 3.1 After a stream reconnect the held set is marked as needing reconciliation until a REST read succeeds, as the requirement already asks.
- [ ] 3.2 A held set that has never been read is not presented as an empty account.

## 4. Proof

- [ ] 4.1 Test: a `NEW` report adds the order to the broadcast set with no REST read issued.
- [ ] 4.2 Test: a `FILLED` report removes it, with no account-wide order read; balances and positions are read.
- [ ] 4.3 Test: five fills of one market order produce no order read at all.
- [ ] 4.4 Test: a stream reconnect issues one full pass and marks the set stale until it lands.
- [ ] 4.5 Test: an operator refresh issues every read including the algo orders.
- [ ] 4.6 Test: the beat still fires while orders are working and stops when the list empties.
- [ ] 4.7 Test: a stale report for an order already settled does not put it back.
- [ ] 4.8 Weight test: a session of one placement, five fills and two `ACCOUNT_UPDATE`s issues the account-wide order read once, not eight times.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:command-path`.
- [ ] 5.2 Operator confirms on live data: placing, filling and cancelling orders keeps the working-orders list exactly right without waiting for a refresh, and an order cancelled from Binance's app disappears within the beat.

## 6. Stated Limits, Not Fixed Here

- [ ] 6.1 Positions and balances are still read on a fill. Deriving them from `ACCOUNT_UPDATE`'s own payload would save 10 more, and would have to answer for the liquidation price, which that payload does not carry. That belongs with `move-the-pnl-with-the-market`.
