## ADDED Requirements

### Requirement: Trading commands are ordered no more coarsely than the order they name
The main process SHALL order a mutating command against the order it names and
SHALL NOT hold it behind a command about a different order. A command that
speaks for a whole contract rather than for one order on it — cancelling every
order, setting leverage, setting margin type, adjusting position margin — SHALL
run alone on that contract: every command about an order on it that was accepted
earlier SHALL complete first, and every command accepted after it SHALL wait for
it. A command that names an order the desk cannot identify SHALL be ordered
against its whole contract rather than against nothing.

This is the granularity of the ordering guarantee, not a relaxation of it: two
commands about one order stay serialized exactly as before.

#### Scenario: Two orders on one contract are worked at once
- **WHEN** a placement for one order is in flight and a cancellation for a different order on the same contract is accepted
- **THEN** the cancellation reaches the exchange without waiting for the placement to be answered

#### Scenario: A contract-wide command is accepted while an order command is running
- **WHEN** a cancel-all, leverage, margin-type or position-margin command is accepted on a contract that already has an order command in flight
- **THEN** it runs only after that command has completed, so no order placed before it was accepted can survive it

#### Scenario: An order command is accepted while a contract-wide command is running
- **WHEN** a command about a single order is accepted on a contract whose cancel-all, leverage, margin-type or position-margin command is still running
- **THEN** it waits for that command to complete

#### Scenario: A command names no order the desk can identify
- **WHEN** a mutating command about an order carries neither an exchange order id nor a client order id
- **THEN** it is ordered against every other command on its contract
