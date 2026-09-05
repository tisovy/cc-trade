## Implement

- [x] 1.1 Inspect graph/source boundaries and validate artifacts before code.
- [x] 1.2 Add scoped render boundaries and explicit manual recovery UI.
- [x] 1.3 Keep account/trading owners outside content boundaries and isolate Spot chart/analytics.
- [x] 1.4 After production, add injected render-failure and recovery regressions.

## Verify

- [x] 2.1 Run targeted/full gates, graph/source audit and strict validation; record evidence.
- [x] 2.2 Commit directly to main.
- [x] 2.3 Obtain operator live confirmation before archive; do not inject failures into the live desk.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
