## Why

The self-audit of commits 01fac99 through b5003fc found gaps between the new evidence contracts and their successful-response paths: cancellation adapters manufacture cancelled status, queried identities are not checked, and an indeterminate Futures response can count as absence. Spot snapshot invalidation can also discard the initial account catch-up without replacing it. The operator additionally requests DevTools closed on ordinary launch.

## What Changes

- Validate regular-order REST response identity and action postconditions before emitting success; retain uncertainty and use existing read-only reconciliation on insufficient evidence.
- Refuse contradictory Futures absence and incomplete/mismatching private-report identity.
- Convert SDK-native BigInt response fields to exact decimal text before JSON transport or persistence.
- Replace an invalidated Spot account read through the existing coalescing owner while its renderer remains active.
- Make DevTools automatic opening explicitly opt-in for development and packaged launches; preserve manual inspection.
- Re-audit the previous implementation, run regression/package checks, commit and synchronize its implemented spec deltas. Archive only changes whose live acceptance the operator confirms.

## Capabilities

### New Capabilities

- `order-response-evidence`: Evidence checks at successful regular-order REST and private-report boundaries.
- `spot-catchup-continuity`: Replacement of superseded account reads without reviving retired consumers.
- `desktop-devtools-policy`: Explicit opt-in to automatic DevTools opening.

### Modified Capabilities

- `trading-command-integrity`: Reconcile older generic outcome/ordering wording with the implemented action evidence, explicit absence and proven alias contracts, retaining every existing scenario.

## Impact

Spot/Futures trading adapters, shared order evidence matching, Spot account refresh orchestration, Electron launch policy and their tests. No new dependency, real exchange command, application restart or credential change. Existing unrelated changes remain outside the synchronization/archive scope.
