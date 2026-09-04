## Why

Audit F02 reproduced two failures with the installed Spot SDK: network errors lose transport metadata and are reported as refusals, while HTTP 400 loses Binance code -2013 and prevents absence reconciliation. An SDK-level DELETE retry can also replay a cancellation before the command owner has reconciled it.

## What Changes

- Protect the shared Spot REST API before any consumer can use it: retain HTTP responses, disable hidden SDK retries, and normalize failures into a main-process error contract.
- Preserve HTTP status and numeric exchange code; explicitly mark transport detail unavailable when the SDK has already discarded it. Never infer absence from a message string.
- Treat unreadable responses and exchange unknown-execution codes as unresolved; preserve normal acceptance and business rejection behavior.
- Verify the installed SDK with local transport fixtures and the service's bounded reconciliation path. No real exchange commands.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trading-command-integrity`: a Spot SDK failure must retain the evidence needed to distinguish rejection, absence, and an unknown outcome.

## Impact

New Spot REST boundary, shared-client initialization, adapter lookup, and regression tests. No credential flow, renderer protocol, signing implementation, or dependency changes. F01 (stream), F06 (action-specific reconciliation), and other audit findings remain separate work.
