## Purpose

Adds the duplicate and ordering guarantees deferred out of
`harden-trading-command-integrity`.

## ADDED Requirements

### Requirement: Duplicated commands cannot reach the exchange twice
The main process SHALL maintain a bounded registry of in-flight and recently
completed trading commands, keyed by command identity. A command whose identity
is already in flight or already completed SHALL be answered from the registry
instead of being submitted to the exchange. The registry SHALL be bounded in
size and age so it cannot grow without limit.

#### Scenario: The same frame is delivered twice
- **WHEN** two identical trading command frames arrive concurrently
- **THEN** exactly one exchange submission occurs and both frames receive the same outcome

#### Scenario: A completed command is redelivered
- **WHEN** a command identity that already completed is delivered again
- **THEN** the recorded outcome is returned and no new submission occurs

#### Scenario: The registry stays bounded
- **WHEN** commands accumulate over a long session
- **THEN** the registry evicts by age and size and never grows without limit

### Requirement: Mutating commands on the same order are serialized
The system SHALL execute mutating commands that target the same order identity,
and the same symbol, in the order they were accepted. An amendment and a
cancellation of one order SHALL NOT be in flight against the exchange
simultaneously.

#### Scenario: Amend and cancel arrive together
- **WHEN** an amendment and a cancellation for one order are accepted in that order
- **THEN** the exchange receives the amendment first and the cancellation only after the amendment has resolved

#### Scenario: Commands on different symbols
- **WHEN** mutating commands target different symbols
- **THEN** they may proceed concurrently
