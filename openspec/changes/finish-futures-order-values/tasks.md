## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `finish-futures-order-values` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [ ] 1.1 Run upstream GitNexus impact analysis for every existing order-price, order-value, ticket, dock and chart symbol that will be edited; report blast radius and risk before changing code.
- [ ] 1.2 Pass the catalog's symbol-to-tick map to the trading ticket and format every account-wide order with its own contract tick.
- [ ] 1.3 Add shared filled-notional presentation and render the working-orders Filled column in USDT with exact executed contracts in secondary detail.
- [ ] 1.4 Select a positive limit price before trigger price for order valuation, falling back to trigger only when the order has no usable limit price.
- [ ] 1.5 Draw a market-triggered stop line and handle at the shared display price without mutating the order or passing that derived price into execution, editing, dragging or cancellation payloads.

## 2. Proof after implementation

- [ ] 2.1 Add utility and ticket regressions for another contract's tick, stop-limit valuation and trigger-only fallback.
- [ ] 2.2 Add dock regressions for filled USDT and exact executed-contract detail.
- [ ] 2.3 Add chart regressions for a regular/algo stop-market at trigger and a stop-limit at limit price, including a guard that actions still receive the original order unchanged.
- [ ] 2.4 Run the focused utility/component tests, `npm run lint`, `npm run build` and `npm run check:futures-production`.

## 3. Change completion

- [ ] 3.1 Run `git diff --check` and strict OpenSpec validation for `finish-futures-order-values` after implementation.
- [ ] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [ ] 3.3 Commit the completed change directly to `main` without archiving it.
