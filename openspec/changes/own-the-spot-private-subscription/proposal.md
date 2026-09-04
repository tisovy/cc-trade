## Why

Audit F01 found that Spot still opens and renews the retired REST `/api/v3/userDataStream` listenKey endpoint. A market-data connection and configured credentials cannot establish private account-stream health.

## What Changes

- Replace the retired Spot listenKey lifecycle with `userDataStream.subscribe.signature` on the production WebSocket API, using the existing main-only BK/BS HMAC credentials.
- Give one controller ownership of connection, acknowledgement, subscription identity, liveness, bounded reconnect and teardown. Remove the obsolete Spot adapter methods and renewal timers.
- Publish explicit private-subscription health; show a persistent warning and refuse new Spot placements until the subscription is confirmed. Cancels and read-only refresh remain available.
- Re-read balances and open orders after subscription/reconnection without replaying mutations.

## Capabilities

### New Capabilities

- `spot-private-stream`: authenticated private subscription ownership, health and recovery.

### Modified Capabilities

- `trading-command-integrity`: a new Spot placement requires a confirmed private subscription; cancellations remain possible.

## Impact

New main-process controller, shared Spot orchestration, obsolete adapter methods, DataContext and Spot warning UI, and lifecycle tests. No Futures stream or public-market transport changes. No new key type, dependency, real order, session launch or deployment.
