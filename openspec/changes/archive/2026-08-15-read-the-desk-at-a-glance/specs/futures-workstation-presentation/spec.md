## ADDED Requirements

### Requirement: The active workspace keeps local time in sight
While a Spot or Futures workspace is active, the application SHALL present a centered local clock immediately beneath the market-mode switch. The clock SHALL use the host system's local time, SHALL show an English abbreviated weekday and month with day, hour, minute, and second in the form `Sat 15 Aug 15:00:56`, and SHALL advance through seconds without requiring market data or operator interaction. Its fixed-width numeric presentation SHALL not displace the mode switch or cover workspace controls as the value changes.

#### Scenario: An active workspace is mounted
- **WHEN** credential preflight has completed and either Spot or Futures is the active workspace
- **THEN** a centered clock is visible beneath the market-mode switch and states the current local weekday, day, month, hour, minute, and second

#### Scenario: Local time advances
- **WHEN** the host system clock advances to the next second while the workspace remains mounted
- **THEN** the visible clock advances to that local second without a market frame or operator action

#### Scenario: The clock crosses a calendar boundary
- **WHEN** local time advances into a new day or month
- **THEN** the weekday, day, month, and time are all recomputed from the host system clock rather than incrementing only the displayed seconds

### Requirement: Recent contracts fill three complete pill rows
The Futures workstation SHALL retain at most the nine most recently selected unique contracts and SHALL present them in the existing three-column recent-contract group. A tenth distinct selection SHALL discard only the least recent retained contract, and reading an existing persisted history SHALL preserve up to nine valid entries without changing the storage identity or the most-recent-first ordering.

#### Scenario: Nine recent contracts are retained
- **WHEN** the operator has selected nine distinct valid Futures contracts
- **THEN** all nine are retained and shown as three complete rows of three recent-contract pills

#### Scenario: A tenth contract is selected
- **WHEN** nine distinct recent contracts are retained and the operator selects a tenth distinct contract
- **THEN** the new contract becomes first, the previous least recent contract is discarded, and exactly nine unique contracts remain

#### Scenario: Nine persisted contracts are restored
- **WHEN** the app starts with nine valid unique contracts stored by the existing symbol-history record
- **THEN** all nine are restored in their persisted most-recent-first order
