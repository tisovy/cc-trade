## MODIFIED Requirements

### Requirement: An unresolved outcome is reconciled before any resubmission
The system SHALL reconcile an unresolved order mutation using bounded read-only
queries under its requested identity. Confirmation SHALL require the requested
action's postcondition: placement acceptance, cancelled status, or exact requested
amendment terms. Repeated explicit absence may settle placement only; it SHALL
NOT prove cancellation or amendment. Any permitted resubmission SHALL reuse the
original intent identity. Inconclusive reconciliation SHALL remain unresolved
and SHALL NOT offer a retry control.

#### Scenario: The ambiguous order actually executed
- **WHEN** reconciliation finds the requested order and proves the requested action's postcondition
- **THEN** that evidence becomes the outcome of the command and no second mutation is submitted

#### Scenario: The ambiguous order never reached the exchange
- **WHEN** all bounded reconciliation observations explicitly confirm that no order exists under an ambiguous placement's client identity
- **THEN** the intent may be resubmitted, and it is resubmitted under the same client identity

#### Scenario: Reconciliation itself keeps failing
- **WHEN** the bounded reconciliation attempts are exhausted without an answer
- **THEN** the command remains reported as unresolved, the operator is told the exchange state is unconfirmed, and no retry control is offered

### Requirement: Every trading command failure reaches the operator
A determinate Spot or Futures command failure SHALL produce a market-scoped
`command_rejected` carrying a stable local code and sanitized explanation. An
indeterminate failure SHALL instead produce `command_unresolved`; a failed
request alone SHALL NOT prove that a mutation was rejected. Neither outcome
SHALL be reported only to the application log.

#### Scenario: Spot placement fails
- **WHEN** a Spot order placement fails at the exchange or in transport
- **THEN** the operator receives a market-scoped rejection for a determinate refusal or an unresolved warning for insufficient execution evidence

#### Scenario: Spot cancellation fails
- **WHEN** a Spot cancellation fails
- **THEN** a market-scoped rejection or unresolved warning is emitted according to the evidence, rather than a log-only entry

#### Scenario: An unresolved outcome is not a rejection
- **WHEN** a command ends unresolved rather than failed
- **THEN** it is reported as unresolved and is not emitted as a rejection

### Requirement: Trading commands are ordered no more coarsely than the order they name
The main process SHALL order a mutating command against its proven order aliases
and SHALL NOT hold it behind a command about a proven distinct order. A command that
speaks for a whole contract rather than for one order on it — cancelling every
order, setting leverage, setting margin type, adjusting position margin — SHALL
run alone on that contract: every command about an order on it that was accepted
earlier SHALL complete first, and every command accepted after it SHALL wait for
it. A command whose target aliases are unknown or contradictory SHALL be ordered
against its whole contract rather than assumed independent.

This is the granularity of the ordering guarantee, not a relaxation of it: two
commands about one order stay serialized exactly as before.

#### Scenario: Two orders on one contract are worked at once
- **WHEN** a placement for one order is in flight and a cancellation for a proven distinct order on the same contract is accepted
- **THEN** the cancellation reaches the exchange without waiting for the placement to be answered

#### Scenario: A contract-wide command is accepted while an order command is running
- **WHEN** a cancel-all, leverage, margin-type or position-margin command is accepted on a contract that already has an order command in flight
- **THEN** it runs only after that command has completed, so no order placed before it was accepted can survive it

#### Scenario: An order command is accepted while a contract-wide command is running
- **WHEN** a command about a single order is accepted on a contract whose cancel-all, leverage, margin-type or position-margin command is still running
- **THEN** it waits for that command to complete

#### Scenario: A command names no order the desk can identify
- **WHEN** a mutating command about an order carries no usable target identity or its target aliases are unproved or contradictory
- **THEN** it is ordered against every other command on its contract

### Requirement: An unresolved outcome is cleared only by an answer to that command
An unresolved command SHALL be held together with the identity of the command
it belongs to — the symbol and the order identifiers the command was issued
with. The system SHALL clear it only on a matching action-specific rejection or
reconciliation result, or on a report carrying an explicit matching symbol and
order identity that proves the held action's postcondition or terminal outcome. Traffic belonging to any other
order or symbol SHALL leave the unresolved state exactly as it was.

#### Scenario: Unrelated order updates while an outcome is unknown
- **WHEN** a placement on one contract has an unresolved outcome and an execution update for a different contract arrives
- **THEN** the unresolved outcome remains on screen and no retry is offered

#### Scenario: The command's own answer arrives
- **WHEN** an execution report proves the held action's postcondition or terminal outcome, or a rejection names that same action and identity
- **THEN** the unresolved outcome is cleared and replaced by that answer

#### Scenario: Both markets hold it the same way
- **WHEN** a Spot command's outcome is unknown and a different Spot order is refused afterwards
- **THEN** the unknown outcome is still shown, beside the refusal rather than replaced by it

#### Scenario: The command could not be identified
- **WHEN** an ambiguous failure occurred on a command whose identity the system could not determine
- **THEN** the unresolved outcome is cleared only by the reconciliation result for that command, never by unrelated traffic

### Requirement: An order the exchange does not report is asked for again before it is called absent
When reconciling an ambiguous placement, the system SHALL treat a lookup that
reports no such order as provisional. It SHALL repeat the lookup up to the
bounded attempt count, spaced in time, and SHALL conclude absence only when
every configured observation explicitly reports absence. Failed or HTTP-indeterminate
reads SHALL NOT count as absence. For cancellation or amendment, absence SHALL
remain inconclusive. The total number of exchange reads SHALL remain bounded.

#### Scenario: Order appears on a later lookup
- **WHEN** the first placement reconciliation lookup reports no such order and a later attempt finds it
- **THEN** the command resolves as executed, its execution report is emitted, and no rejection is produced

#### Scenario: Order absent on every attempt
- **WHEN** every configured placement lookup explicitly reports no such order
- **THEN** the command resolves as not executed and the market's absent-outcome handling applies

#### Scenario: Both markets reconcile alike
- **WHEN** a Spot command reconciles an ambiguous outcome
- **THEN** it retries a "no such order" answer exactly as the Futures path does
