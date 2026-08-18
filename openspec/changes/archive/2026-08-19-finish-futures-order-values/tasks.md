## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `finish-futures-order-values` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing order-price, order-value, ticket, dock and chart symbol that will be edited; report blast radius and risk before changing code.
- [x] 1.2 Pass the catalog's symbol-to-tick map to the trading ticket and format every account-wide order with its own contract tick.
- [x] 1.3 Add shared filled-notional presentation and render the working-orders Filled column in USDT with exact executed contracts in secondary detail.
- [x] 1.4 Select a positive limit price before trigger price for order valuation, falling back to trigger only when the order has no usable limit price.
- [x] 1.5 Draw a market-triggered stop line and handle at the shared display price without mutating the order or passing that derived price into execution, editing, dragging or cancellation payloads.

## 2. Proof after implementation

- [x] 2.1 Add utility and ticket regressions for another contract's tick, stop-limit valuation and trigger-only fallback.
- [x] 2.2 Add dock regressions for filled USDT and exact executed-contract detail.
- [x] 2.3 Add chart regressions for a regular/algo stop-market at trigger and a stop-limit at limit price, including a guard that actions still receive the original order unchanged.
- [x] 2.4 Run the focused utility/component tests, `npm run lint`, `npm run build` and `npm run check:futures-production`.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `finish-futures-order-values` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.

## 4. Post-implementation audit

- [x] 4.1 Run upstream GitNexus impact analysis for the workstation container and chart symbols before the audit fix.
- [x] 4.2 Preserve the original ALGO order price through the container and derive trigger/spawned chart coordinates only at the chart presentation boundary.
- [x] 4.3 Add container and chart regressions proving display prices never replace the order price carried by edit/drag/cancel actions.
- [x] 4.4 Re-run the focused workstation/chart tests, `npm run lint`, `npm run build`, `npm run check:futures-production`, `git diff --check` and strict OpenSpec validation.
