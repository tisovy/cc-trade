## Why

Audit F06 found that an existing order ends ambiguous cancel/modify reconciliation even when cancellation or amendment has not happened. Futures warning state also clears on any matching execution report regardless of the command's requested postcondition.

## What Changes

- Share a pure action-specific postcondition evaluator between main and renderer: placement existence, cancellation status, amendment price and original quantity.
- Keep working orders after cancel, old amendment parameters, unknown statuses and unsupported/missing evidence unresolved through bounded read-only reconciliation. Absence alone does not prove cancellation or amendment.
- Confirm CANCELED distinctly from FILLED/expired terminal outcomes; show the latter as an explained non-achievement of the requested mutation, never as cancellation success.
- Carry expected amendment parameters in uncertainty envelopes; require them before matching execution traffic withdraws the warning. Preserve Spot client-order identity during normalization.
- Allow a delayed matching private event to settle only its own action-specific warning; retain unrelated warnings and avoid duplicate mutations.

## Capabilities

### New Capabilities

- `order-mutation-postconditions`: shared evidence rules for place, cancel and modify.

### Modified Capabilities

- `trading-command-integrity`: ambiguous mutation reconciliation and warning dismissal require action-specific evidence.

## Impact

Spot/Futures reconciliation, Spot report identity, a pure shared utility, DataContext outcome state and Futures warning handling/tests. No cancel-replace endpoint is added, no account or SDK-major migration, no real orders, no automatic resend. Existing cancel-then-place UI confirmation remains restricted to actual cancellation.
