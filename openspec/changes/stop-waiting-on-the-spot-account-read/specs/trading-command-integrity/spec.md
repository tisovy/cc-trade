## ADDED Requirements

### Requirement: A command does not wait on a read the operator is not waiting for
A mutating spot command SHALL be complete when the exchange has answered it and
that answer has been emitted. An account read issued because the command changed
something SHALL NOT be awaited inside the command, so the operator's next action
does not queue behind a refresh they were not waiting for.

The read SHALL still happen. What changes is only whether the command holds until
it answers.

Where the screen would be wrong until the read answers, the wait SHALL be kept
and the reason stated at that call site. That is the case after an unresolved
outcome has been reconciled: the desk has just learned what became of an order,
and the operator must not act on a screen that predates it.

#### Scenario: An order is accepted
- **WHEN** the exchange accepts a spot order and the desk emits the execution report
- **THEN** the command is done, and the account read it triggers runs without the command waiting on it

#### Scenario: An unknown outcome has just been resolved
- **WHEN** a spot command's outcome was unknown and reconciliation has just established what happened
- **THEN** the account read is awaited, because the screen is wrong until it answers and the operator may act on it

#### Scenario: The read is the command
- **WHEN** the operator asks the desk to refresh the spot account
- **THEN** the read is awaited, because it is the whole of what was asked for and no outcome was emitted in front of it
