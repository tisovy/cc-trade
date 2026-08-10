## 1. An Unknown Outcome Is Cleared By Its Own Answer

- [x] 1.1 Carry the command's correlation identity (symbol, `orderId`, `origClientOrderId`/`clientOrderId`) in every `command_unresolved` envelope the futures path emits.
- [x] 1.2 Hold the unresolved command in the renderer with that identity, and clear it only on an execution update or rejection matching it.
- [x] 1.3 Leave the warning standing when an unrelated symbol's or order's update arrives.
- [x] 1.4 Clear an unresolved command whose identity is unknown only on the reconciliation answer for that command, never on unrelated traffic.
- [x] 1.5 Prove by test that an ETH execution update does not clear an unresolved BTC placement, and that the BTC answer does.
- [x] 1.6 Give Spot the same rule its requirement already stated: the identity travels on the Spot rejection as well as the unresolved envelope, reconciliation answers a found order by name, and the desk holds the unknown outcome apart from ordinary refusals so a later one cannot take its place. *(Added 2026-08-10 from a review of the delivery: only the Futures desk was made to match on identity, while the Spot banner still showed the last outcome to arrive.)*
- [x] 1.7 Prove by test that a Spot warning survives another order's refusal, that its own refusal or reconciliation answer withdraws it, and that Futures outcomes are still left to the Futures desk.

## 2. "Not Found" Is Provisional Until Asked Again

- [x] 2.1 Retry a reconciliation lookup that answers "no such order" up to the bounded attempt count, spaced, before treating the order as absent — on both the Futures and the Spot path.
- [x] 2.2 Keep an exception on the lookup retrying exactly as it does today, and keep the total number of exchange reads bounded.
- [x] 2.3 Report the absent conclusion only after the last attempt still finds nothing.
- [x] 2.4 Prove by test that an order that appears on the second lookup resolves as existing and produces no rejection, and that an order absent on every attempt still concludes absent.

## 3. Cancel All Cancels Everything It Listed

- [x] 3.1 Establish which cancellation route the exchange requires for an ALGO order and add it to the futures adapter; do not reuse the regular-order route for an identifier it does not accept.
- [x] 3.2 Cancel both books in the futures cancel-all handler, and refresh account state once both have answered.
- [x] 3.3 Verified: no surface offers a single ALGO cancel — the dock, the rail and the chart all present an ALGO row as managed on Binance, so there is no path sending an algo identifier to the regular route.
- [x] 3.4 Report a partial outcome explicitly: when one book fails, the operator is told which orders may still be live.
- [x] 3.5 Prove by test that cancel-all issues both cancellations, and that a failure of either is reported rather than swallowed.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:command-path`.
- [ ] 4.2 Operator confirms on live data that an unresolved outcome survives unrelated traffic and that cancel-all clears stop orders.
