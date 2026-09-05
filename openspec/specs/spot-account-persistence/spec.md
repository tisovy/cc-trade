# spot-account-persistence Specification

## Purpose

Isolate Spot account history and PnL by the main-owned configured-key namespace without silently migrating legacy data or accepting a retired account stream.

## Requirements

### Requirement: Main-owned Spot account namespace
The system SHALL identify configured Spot private data with a domain-separated opaque API-key fingerprint produced in main and SHALL NOT send credentials to the renderer or change Futures/public envelopes.

#### Scenario: Configured key changes
- **WHEN** main starts with a different Spot API key
- **THEN** private frames carry a different fingerprint and the old namespace is not reused, even if the keys might belong to the same exchange account

#### Scenario: No verified private identity
- **WHEN** private data lacks a valid current-connection fingerprint
- **THEN** the renderer does not apply or persist that private data

### Requirement: Scoped and non-destructive persistence
Spot history and PnL SHALL be isolated by schema version, market, and account fingerprint. Unattributed legacy keys SHALL remain unchanged and SHALL NOT be loaded or automatically assigned to an account.

#### Scenario: Account B has a smaller balance
- **WHEN** account A has a stored baseline of 10000 and account B loads with 1000
- **THEN** B starts its own baseline and does not show a loss against A's 10000

#### Scenario: Invalid stored ownership
- **WHEN** a storage envelope is malformed or has mismatching identity, market or version
- **THEN** it is ignored without deleting legacy or other-account data

#### Scenario: Account returns
- **WHEN** the same configured key is used again
- **THEN** only its own scoped history and valid baseline are restored

### Requirement: Atomic private account switching
The renderer SHALL switch private history/orders/balances before applying the first new-account frame, reject old-socket private frames, and wait for a full balance snapshot before calculating PnL.

#### Scenario: Private delta precedes account snapshot
- **WHEN** a new connection supplies an incremental balance update before a full balance snapshot
- **THEN** the delta alone cannot create a portfolio baseline

#### Scenario: Late old-account frame
- **WHEN** the prior socket delivers private data after replacement
- **THEN** current account state and both accounts' stored data remain unchanged

#### Scenario: Same-account reconnect
- **WHEN** the current connection is replaced and identifies the same configured key
- **THEN** live data waits for current evidence and unresolved command warnings remain held

#### Scenario: UI effect has not recomputed
- **WHEN** the account or selected period changes before PnL's effect recomputes
- **THEN** an old result is not rendered as the new account or period's result
