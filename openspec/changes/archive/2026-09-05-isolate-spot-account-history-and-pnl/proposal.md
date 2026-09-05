## Why

Audit F09 found global Spot history and PnL keys. Changing credentials can compare one account's balance with another account's baseline and present fictitious losses. Unattributed legacy data cannot be safely assigned retrospectively.

## What Changes

- Main stamps Spot private data with a domain-separated SHA-256 fingerprint of the configured API key, never the key or secret.
- History and PnL storage is versioned and scoped to Spot plus that fingerprint. Legacy global keys are preserved but not consumed or migrated.
- Renderer ownership follows current-socket private evidence. Account changes reset private views synchronously; PnL waits for a full balance snapshot.
- Missing/invalid ownership fails closed for persistence; key rotation intentionally starts an independent namespace.

## Capabilities

### New Capabilities
- `spot-account-persistence`: account-scoped history and portfolio baseline ownership.

### Modified Capabilities
None.

## Impact

Main Spot envelope delivery, DataContext private state, PnL utilities and InfoPanel. No new exchange calls, credential transport, Futures schema changes or deletion of user data. CRITICAL impact at shared broadcaster (15 processes) requires targeted Spot/Futures regression coverage and full checks.
