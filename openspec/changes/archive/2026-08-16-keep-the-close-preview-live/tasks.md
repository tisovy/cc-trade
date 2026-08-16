## 1. Pre-implementation Safety

- [x] 1.1 Run upstream GitNexus impact analysis for `FuturesProductionWorkstation` and `FuturesPositionCloser`; report direct callers, affected execution flows and risk before editing either symbol.
- [x] 1.2 Run `OPENSPEC_TELEMETRY=0 openspec validate keep-the-close-preview-live` and resolve any artifact errors before production implementation.

## 2. Production Implementation

- [x] 2.1 Resolve the open close-panel target from the latest matching `executionState.positions` row in `FuturesProductionWorkstation`, retaining the opening row only as the transient fallback and keeping a stable panel key.
- [x] 2.2 Price market-close value and estimated PnL from the live position's resolved `valuationPrice`, falling back to `markPrice`, while leaving the normalized operator limit price authoritative in limit mode.
- [x] 2.3 Verify in the implementation that live valuation props do not reset order type, close size or limit-price draft state, and that quantity validation uses the current live open quantity.

## 3. Regression Coverage

- [x] 3.1 After production code is in place, add a `FuturesPositionCloser` rerender test proving a partial market preview updates from `valuationPrice` without changing the entered size and a limit preview retains its typed price.
- [x] 3.2 Add a `FuturesProductionWorkstation` boundary test proving an already-open close panel receives the latest matching position object when `executionState.positions` is replaced.
- [x] 3.3 Run the focused React tests for the closer and production workstation, then run the repository's relevant static checks.

## 4. Scope Verification

- [x] 4.1 Re-run `OPENSPEC_TELEMETRY=0 openspec validate keep-the-close-preview-live` after implementation.
- [x] 4.2 Run GitNexus `detect_changes` against `master`, verify only the intended symbols and execution flows are affected, and report the result before committing directly to `master`.
- [x] 4.3 Leave the change unarchived until the operator confirms the live-data behavior.

## 5. Post-implementation Audit

- [x] 5.1 Re-index GitNexus on `main`, trace the live close-preview flows, audit the committed implementation and report upstream impact before any production fix.
- [x] 5.2 Fix every production defect found in live target selection, valuation, draft preservation, quantity validation or submit behavior, keeping production changes ahead of test changes.
- [x] 5.3 After production fixes, add or strengthen regression coverage for every confirmed defect and uncovered requirement edge.
- [x] 5.4 Run focused and relevant broader tests, static checks, and `OPENSPEC_TELEMETRY=0 openspec validate keep-the-close-preview-live`.
- [x] 5.5 Run GitNexus `detect_changes` against `main`, verify the final scope, commit directly to `main`, and leave the change unarchived pending live-data confirmation.
