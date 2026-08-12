## MODIFIED Requirements

### Requirement: The record carries no credential and no money value
No credential, signature, or authenticated request or response body SHALL appear
in the record. No price, quantity, notional, balance, or profit-and-loss value
SHALL appear in it either. A trading command MAY be recorded by its contract,
side, type, identity and outcome, which describe what the desk did rather than
what it was worth. A command the exchange refused MAY additionally be recorded
by the code the exchange gave for the refusal, which SHALL be constrained to a
shape that cannot express an amount, and the exchange's own message SHALL NOT be
recorded.

#### Scenario: A command is recorded
- **WHEN** a trading command is sent and answered
- **THEN** the record states the contract, side, type, identity and outcome, and states no price, quantity or profit-and-loss value

#### Scenario: An event carries a value it must not
- **WHEN** an event offered to the record contains a credential, signature or money value
- **THEN** it is refused or that value is dropped, and nothing of it reaches the file

#### Scenario: The exchange refuses a command
- **WHEN** the exchange refuses a command and states a code for it
- **THEN** the record carries that code beside the refusal, and carries neither the exchange's message nor the value that was refused

#### Scenario: A refusal code arrives shaped like an amount
- **WHEN** the code offered for a refusal is not a bounded signed integer or a bounded uppercase identifier
- **THEN** the code is refused, and the refusal is still recorded without it

## ADDED Requirements

### Requirement: Refusals can be counted by their cause
The summary over a day of the record SHALL report how many commands each
exchange refusal code accounts for, so that a run of refusals can be read as one
cause or as several without opening the record itself.

#### Scenario: An evening of refused orders
- **WHEN** the summary is run against a day in which several commands were refused
- **THEN** it reports the refusals grouped by the code the exchange gave, and how many commands each code accounts for
