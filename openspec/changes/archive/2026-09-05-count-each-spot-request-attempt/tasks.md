## 1. Implement

- [x] 1.1 Verify current published weights, inspect exact-path graph impact and validate artifacts.
- [x] 1.2 Correct declared account/public read weights and reserve every legacy retry in production.
- [x] 1.3 Update weight expectations and add actual production-limiter retry/capacity/cancellation tests after implementation.

## 2. Verify

- [x] 2.1 Run targeted/full tests and graph/diff review, record boundaries, validate and commit main.
- [x] 2.2 Obtain operator live acceptance before archive without deliberately exhausting exchange quotas.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
