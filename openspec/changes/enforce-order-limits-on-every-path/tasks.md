## 1. One Validation Authority

- [x] 1.1 Extend `src/utils/futuresOrderDraft.js` into the single evaluator of a submission draft, returning a refusal that names the violated rule.
- [x] 1.2 Route the trading ticket, the order editor, the chart drag amendment and the position closer through that evaluator instead of their own local checks.
- [x] 1.3 Keep the evaluator confined to tick, step, quantity range, minimum notional and the configured ceiling; do not add price-band, percent-price or order-count checks.
- [x] 1.4 Prove by test that every renderer submission surface refuses the same draft for the same stated reason.

## 2. Risk Ceiling on Every Exposure-Increasing Path

- [x] 2.1 Evaluate an amendment against its resulting notional and refuse it in the renderer when it exceeds `FUTURES_MAX_ORDER_USDT`.
- [x] 2.2 Add the ceiling check to `handleFuturesModifyOrder` in `electron/services/binance-connection.js`, emitting the same `FUTURES_ORDER_CAP_EXCEEDED` rejection shape placement emits.
- [x] 2.3 Apply the ceiling to a limit close that is not reduce-only, and keep reduce-only exits exempt so a position can always be closed.
- [x] 2.4 Reproduce the audit case as a test: cap 200 USDT, live 160 USDT order, amendment to 10 000 USDT is refused in the renderer and refused again in the backend, and no exchange request is issued.

## 3. Exchange Filters Are the Exchange's Job

- [x] 3.1 Confirm no local evaluation of `minPrice`, `maxPrice`, the percent-price band or the maximum open order count exists on any submission path, and remove any that does.
  - Confirmed: no futures or spot submission path evaluates them. One dead
    legacy function, `buysell` in `src/utils/operations.js`, still contains a
    `minPrice`/`maxPrice` check behind an `alert()`. It has no callers anywhere
    in the repository and is on no submission path, so it was left in place
    rather than deleted under a futures-scoped change; reported to the operator
    as a separate cleanup.
- [x] 3.2 Present an exchange refusal on those filters with the code and message Binance returned, so the operator can tell a band rejection from a cap rejection.
- [x] 3.3 Prove by test that a draft priced below the contract's `minPrice` is submitted rather than refused locally, and that the exchange's refusal reaches the operator intact.

## 4. Independent Backend Validation

- [x] 4.1 Validate the ceiling in the main process for placement, amendment and close, independently of any renderer-supplied verdict.
- [x] 4.2 Reject a command that fails backend validation with a stable market-scoped code, without contacting the exchange.
- [x] 4.3 Prove by test that a command bypassing the renderer entirely is still refused by the backend.

## 5. Documentation and Verification

- [x] 5.1 State in `docs/futures_trading.md` that `FUTURES_MAX_ORDER_USDT` covers amendments and non-reduce-only closes, and that price-band and order-count filters are enforced by Binance rather than locally.
- [x] 5.2 Run unit and integration suites and the production-guard checks.
- [x] 5.3 Remove the "Interim Operational Risk" section from the proposal once the guarantees hold, so the accepted risk is not carried into the archive as if it still applied.
- [ ] 5.4 Record a live confirmation that an over-cap amendment on a real working order is refused before any exchange request is made.
