## Implement

- [x] 1.1 Inspect graph/source transport ownership and validate artifacts before code.
- [x] 1.2 Enforce independent byte/frame/backlog-duration bounds with safe market eviction and terminal cleanup.
- [x] 1.3 Record bounded overflow diagnostics in main without payload contents.
- [x] 1.4 After production, add adversarial bound/lifecycle tests and synthetic workload evidence.

## Verify

- [x] 2.1 Run targeted/full gates, graph/source audit, strict validation and document choices/limits.
- [x] 2.2 Commit directly to main.
- [x] 2.3 Obtain operator live confirmation before archive; do not intentionally stall a live trading renderer.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
