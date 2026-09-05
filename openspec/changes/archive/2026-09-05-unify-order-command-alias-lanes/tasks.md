## Implement

- [x] 1.1 Inspect ordering owners, disclose impact and validate artifacts before code.
- [x] 1.2 Add typed, bounded alias-aware dependency admission with safe unknown/conflict fallback.
- [x] 1.3 Learn aliases from main-owned regular-order evidence without recording private traffic as outcomes.
- [x] 1.4 After production changes, add registry/main regressions and preserve known-order concurrency tests.
- [x] 1.5 Measure repeated snapshot observation and avoid scanning all retained aliases for unchanged pairs.

## Verify

- [x] 2.1 Run targeted/full checks, graph/source review and strict validation; record decisions and limits.
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
