## 1. The Parent Names The Order It Spawned

- [ ] 1.1 Carry `actualOrderId` and `actualPrice` through `normalizeFuturesAlgoOrder` onto the normalized algorithmic order.
- [ ] 1.2 Treat the exchange's documented empty string as "has not fired" rather than coercing it to a null or a zero, matching how the repository's reference states the contract.
- [ ] 1.3 Keep the existing overrides intact — `algoId`, `clientAlgoId`, `triggerPrice`, `closePosition`, `workingType`, `priceProtect`, `algoType` — and keep the two identity namespaces distinct.
- [ ] 1.4 Prove by test that an algo that has fired carries the spawned order's identity, and that one that has not carries the exchange's empty value unchanged.

## 2. A Fired Order Does Not Read As Resting

- [ ] 2.1 Derive a triggered state for an algorithmic order that names a spawned order, and present it as triggered and awaiting confirmation wherever a working order is drawn — the chart marker, the working-orders list, and the portfolio dock.
- [ ] 2.2 Withhold the controls that only apply to a working order from a triggered parent, so the operator cannot move or reprice something the exchange has already acted on.
- [ ] 2.3 Keep cancel available where the exchange still accepts it, and state plainly when it does not.
- [ ] 2.4 Prove by test that a triggered parent is not drawn as a working marker at its trigger price, and that the controls it offers match what the exchange will accept.

## 3. An Execution Resolves The Parent That Spawned It

- [ ] 3.1 Match an incoming execution report against the spawned identities of the listed algorithmic orders.
- [ ] 3.2 On a match, resolve that parent from the information the report carries rather than waiting for the beat, and read the algorithmic orders once for that match alone.
- [ ] 3.3 Keep the prohibition otherwise: an execution report that matches no listed parent, and a position change, still read nothing.
- [ ] 3.4 Keep the read deduplicated and inside the read budget, so a burst of fills against one parent is one read.
- [ ] 3.5 Prove by test that a fill on a spawned order resolves its parent promptly, and that a fill unrelated to any listed algorithmic order issues no read.
- [ ] 3.6 Prove by test that a parent whose spawned order is cancelled rather than filled is resolved the same way.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Measure the delay from an algorithmic order firing to the desk stating it, and record it against the thirty-second beat it replaces.
- [ ] 4.3 Operator confirms on live data that a stop which fires stops being drawn as a working order within the stream's own latency, and that the position it opened or closed is stated correctly.
