# desk-diagnostic-record (delta)

## MODIFIED Requirements

### Requirement: The record carries no credential and no money value

No credential, signature, or authenticated request or response body SHALL appear
in the record. No price, quantity, notional, balance, or profit-and-loss value
SHALL appear in it either. A trading command MAY be recorded by its contract,
side, type, identity and outcome, which describe what the desk did rather than
what it was worth. A command the exchange refused MAY additionally be recorded
by the code the exchange gave for the refusal, which SHALL be constrained to a
shape that cannot express an amount, and the exchange's own message SHALL NOT be
recorded. A command the desk itself refused MAY additionally be recorded by the
condition that failed, constrained to the same amount-proof shape; a condition
in a shape the record will not repeat SHALL cost the condition and not the
refusal.

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

#### Scenario: The desk refuses a command for a named condition

- **WHEN** the desk itself refuses a command and names which condition failed
- **THEN** the outcome line carries that condition in a shape that cannot express an amount, and a condition in any other shape is dropped without dropping the line

### Requirement: Refusals can be counted by their cause

The summary over a day of the record SHALL report how many commands each
refusal cause accounts for — the code the exchange gave, or, for a refusal the
desk issued itself, the condition the desk named — so that a run of refusals
can be read as one cause or as several without opening the record itself.
Desk-named conditions SHALL NOT be folded into one "no exchange code" bucket.

#### Scenario: An evening of refused orders

- **WHEN** the summary is run against a day in which several commands were refused
- **THEN** it reports the refusals grouped by the exchange's code or the desk's named condition, and how many commands each accounts for

#### Scenario: Desk refusals with different named conditions

- **WHEN** the summary is run against a day in which the desk refused commands for more than one named condition
- **THEN** each condition is its own count, named with its market, and none of them is reported as a refusal the exchange left uncoded
