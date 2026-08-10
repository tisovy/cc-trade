## ADDED Requirements

### Requirement: A completion mark states only what was performed
A task marked complete SHALL correspond to work that was actually performed. An
operator confirmation SHALL be marked only after the operator confirmed the
behaviour on live data. Work that shipped without its live confirmation SHALL be
recorded as outstanding in a single ledger, naming the change and the behaviour
that remains unverified.

#### Scenario: A change ships before it can be confirmed live
- **WHEN** code is archived but the operator has not confirmed it on live data
- **THEN** the confirmation item stays unchecked and the outstanding verification is recorded in the ledger

#### Scenario: The operator confirms later
- **WHEN** the operator confirms the behaviour on live data
- **THEN** the ledger entry is closed with the date of the confirmation

### Requirement: The verification commands declare the runtime they require
The repository SHALL declare the Node version range its verification commands
are supported on, so a failing run can be told apart from an unsupported
runtime. The deterministic storage contract the suite relies on is owned by
`stabilize-vitest-web-storage`.

#### Scenario: An undeclared runtime
- **WHEN** a contributor runs the suite on a version outside the declared range
- **THEN** the tooling states the requirement rather than failing obscurely

### Requirement: The production guards run with the ordinary verification
The guard checks that protect the production boundary — the runtime-mock layer,
the futures workstation boundary and the trading command path — SHALL run as
part of the repository's ordinary verification command. The runtime-mock guard
SHALL cover every source that can bridge the mock layer into the renderer,
including the preload bridge.

#### Scenario: Verification is run before committing
- **WHEN** the verification command runs
- **THEN** lint, the suite and all three guards run, and any failure fails the command

#### Scenario: The preload bridge imports the mock layer
- **WHEN** `electron/preload.cjs` references the runtime mock layer
- **THEN** the runtime-mock guard fails
