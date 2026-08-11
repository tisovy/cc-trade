## ADDED Requirements

### Requirement: Releasing a contract releases all of it
Stopping a Futures workstation session SHALL release every resource it holds —
its upstream sockets, its order book, its freshness, reconnect and
interval-reconnect timers, and its queued events — and SHALL complete that
release even when one of those steps fails. A failure in one step SHALL NOT
prevent the others, and SHALL be reported rather than raised to the caller.

#### Scenario: A socket is still connecting when the contract changes
- **WHEN** the operator selects another contract while an upstream socket has not finished its handshake
- **THEN** the session is released in full, no exception escapes the release, and the socket does not remain open

#### Scenario: A timer outlives its session
- **WHEN** a reconnect or freshness timer of a released session fires
- **THEN** it performs no work, because the session it belonged to is no longer current

### Requirement: A contract switch starts the contract that was asked for
A request that selects another contract SHALL start that contract's session even
when releasing the previous one reported a failure. The desk SHALL NOT be left
with the previous contract's data, with no session at all, or with the local
connection torn down.

#### Scenario: The previous session fails to release cleanly
- **WHEN** releasing the previous contract reports a failure and the operator has asked for another contract
- **THEN** the new contract's session is started and the failure is reported as a diagnostic, not as a refusal of the request

#### Scenario: The operator switches contract repeatedly
- **WHEN** the operator selects several contracts in quick succession
- **THEN** only the last selection delivers data, and no frame of an earlier selection reaches the desk after it
