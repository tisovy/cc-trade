## Implement

- [x] 1.1 Inspect ownership and callers, disclose impact, create and validate artifacts before code.
- [x] 1.2 Add main-owned Spot identity stamping and scoped storage helpers.
- [x] 1.3 Fence DataContext private state/history by current connection and account.
- [x] 1.4 Scope PnL APIs and rendered results; wait for complete account balances.
- [x] 1.5 After production, add adversarial helper, PnL, renderer and main regressions.

## Verify

- [x] 2.1 Run targeted/full checks, graph/source audit and strict validation; record evidence and decisions.
- [x] 2.2 Commit directly to main.
- [x] 2.3 Obtain operator live confirmation before archive; do not generate real test trades.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
