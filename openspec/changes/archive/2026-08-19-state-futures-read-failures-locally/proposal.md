## Why

Three Futures account refreshes are intentionally detached from the command or stream path that starts them, but their rejected promises currently escape to the process-wide `unhandledRejection` handler. The resulting diagnostic loses the refresh reason and makes an expected background-read failure look like an unrelated process failure.

## What Changes

- Settle each detached Futures account refresh at its launch site.
- Report a bounded, understandable failure that includes the refresh reason without exposing signed request data.
- Keep the refresh detached and preserve the existing account-resource failure reporting.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-live-readiness`: Require every detached Futures account refresh to settle its failure locally with a reason-specific diagnostic instead of reaching the process-wide unhandled-rejection path.

## Impact

- `electron/services/binance-connection.js`
- Futures account-refresh diagnostics and focused service tests
- No protocol or exchange API change
