## MODIFIED Requirements

### Requirement: A command does not wait on a read the operator is not waiting for
A mutating spot command SHALL be complete when the exchange has answered it and
that answer has been emitted. An account read issued because the command changed
something SHALL NOT be awaited inside the command, so the operator's next action
does not queue behind a refresh they were not waiting for.

A futures configuration command — the margin mode, the leverage multiple — SHALL
be complete when the exchange has answered it and the re-read configuration has
been broadcast: the configuration is the surface the operator is watching, and
the account pass behind it prices consequences, not the answer. That pass SHALL
still run, and a pass that fails SHALL still be recorded.

The read SHALL still happen. What changes is only whether the command holds until
it answers.

Where the screen would be wrong until the read answers, the wait SHALL be kept
and the reason stated at that call site. That is the case after an unresolved
outcome has been reconciled: the desk has just learned what became of an order,
and the operator must not act on a screen that predates it.

Because mutating commands are serialized per contract, a wait inside one
command's answer is a wait in front of the operator's next command on that
contract. A command SHALL NOT hold that lane on work the operator did not ask
to wait for.

#### Scenario: An order is accepted
- **WHEN** the exchange accepts a spot order and the desk emits the execution report
- **THEN** the command is done, and the account read it triggers runs without the command waiting on it

#### Scenario: A margin-mode change is accepted
- **WHEN** the exchange accepts a futures margin-mode change and the re-read configuration has been broadcast
- **THEN** the command is done, and the account pass it triggers runs without the command — or the next command on that contract — waiting on it

#### Scenario: The account pass behind a configuration change is deferred by the budget
- **WHEN** the desk's own read budget defers the account pass that follows a configuration change
- **THEN** a second configuration command on the same contract is answered in round-trip time rather than queuing behind the deferred pass

#### Scenario: An unknown outcome has just been resolved
- **WHEN** a spot command's outcome was unknown and reconciliation has just established what happened
- **THEN** the account read is awaited, because the screen is wrong until it answers and the operator may act on it

#### Scenario: The read is the command
- **WHEN** the operator asks the desk to refresh the spot account
- **THEN** the read is awaited, because it is the whole of what was asked for and no outcome was emitted in front of it
