## ADDED Requirements

### Requirement: Detached Futures account reads settle where they are started
A Futures account refresh that is deliberately started without delaying its caller SHALL settle any rejection at that launch site. Its diagnostic SHALL identify the bounded refresh reason and sanitized failure category, SHALL expose no credential, signature, signed query or raw response body, and SHALL NOT reach the process-wide unhandled-rejection path. Resource-level failure reporting and retained account data SHALL remain unchanged.

#### Scenario: An unstated-value refresh fails
- **WHEN** the coalesced background refresh for unstated account values rejects
- **THEN** the launch site records a sanitized failure naming the `unstated` reason and no process-wide unhandled rejection is produced

#### Scenario: A stream refresh fails
- **WHEN** the refresh started after the private stream connects rejects
- **THEN** the launch site records a sanitized failure naming the `stream` reason and the stream callback remains detached

#### Scenario: A bootstrap refresh fails
- **WHEN** the refresh started during Futures account bootstrap rejects
- **THEN** the launch site records a sanitized failure naming the `bootstrap` reason and the existing per-resource failure states remain the account truth
