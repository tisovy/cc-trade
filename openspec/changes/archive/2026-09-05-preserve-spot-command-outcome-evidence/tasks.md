## 1. Contract and impact

- [x] 1.1 Inspect installed SDK, official protocol, all shared REST consumers, and GitNexus impact; record decisions and validate the change before implementation.

## 2. Implementation

- [x] 2.1 Implement the protected Spot REST boundary and install it on the shared client; preserve evidence and disable hidden retries.
- [x] 2.2 Require determinate explicit exchange evidence for a Spot lookup to report absence.
- [x] 2.3 After production changes, add installed-SDK contract and service regression tests for ambiguous failures, absence, rejection, and no replay.

## 3. Verification

- [x] 3.1 Run targeted and full checks, inspect the final diff and GitNexus all/compare-main output, and document evidence and residual risks.
- [x] 3.2 Validate OpenSpec and commit the completed implementation directly on main.
- [x] 3.3 Obtain operator confirmation on live data before archiving; do not simulate this acceptance with unit tests or place real orders for verification.

## Operator observation — 2026-09-05

The operator replied “проверил - вроде всё ок” after the requested ordinary
live check (default DevTools state and normal balances/history/charts).
This records ordinary-use acceptance, not an observed failure, forced trade,
key rotation, quota exhaustion, or packaged-build launch. Account and launched
revision were not supplied. Deterministic edge cases remain test-only evidence.
The generic operator-confirmation gate is satisfied within that stated scope.
See [acceptance scope](../../../audit-live-acceptance-2026-09-05.md).
