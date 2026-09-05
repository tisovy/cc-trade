## Implement

- [x] 1.1 Inspect entrypoint/quit policy and graph, verify official termination contracts, validate artifacts.
- [x] 1.2 Implement terminal global-fault owner and install before main initialization.
- [x] 1.3 After production, add unit, isolated-process and main-wiring regressions.

## Verify

- [x] 2.0 Package the final series without launching it and consolidate audit status/owner decisions.
- [x] 2.1 Run targeted/full gates, graph/source audit and strict validation; record policy/trade-offs.
- [x] 2.2 Commit directly to main.
- [x] 2.3 Obtain operator live confirmation before archive; never inject a fault into a live trading process.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
