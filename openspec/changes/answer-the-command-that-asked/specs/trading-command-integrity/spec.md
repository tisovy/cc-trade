## ADDED Requirements

### Requirement: An unresolved outcome is cleared only by an answer to that command
An unresolved command SHALL be held together with the identity of the command
it belongs to — the symbol and the order identifiers the command was issued
with. The system SHALL clear it only on an execution report, rejection or
reconciliation result carrying that identity. Traffic belonging to any other
order or symbol SHALL leave the unresolved state exactly as it was.

#### Scenario: Unrelated order updates while an outcome is unknown
- **WHEN** a placement on one contract has an unresolved outcome and an execution update for a different contract arrives
- **THEN** the unresolved outcome remains on screen and no retry is offered

#### Scenario: The command's own answer arrives
- **WHEN** an execution report or rejection carrying the unresolved command's identity arrives
- **THEN** the unresolved outcome is cleared and replaced by that answer

#### Scenario: The command could not be identified
- **WHEN** an ambiguous failure occurred on a command whose identity the system could not determine
- **THEN** the unresolved outcome is cleared only by the reconciliation result for that command, never by unrelated traffic

### Requirement: An order the exchange does not report is asked for again before it is called absent
When reconciling an ambiguous outcome, the system SHALL treat a lookup that
reports no such order as provisional. It SHALL repeat the lookup up to the
bounded attempt count, spaced in time, and SHALL conclude that the order is
absent only when the final attempt also reports no such order. The total number
of exchange reads SHALL remain bounded.

#### Scenario: Order appears on a later lookup
- **WHEN** the first reconciliation lookup reports no such order and a later attempt finds it
- **THEN** the command resolves as executed, its execution report is emitted, and no rejection is produced

#### Scenario: Order absent on every attempt
- **WHEN** every bounded attempt reports no such order
- **THEN** the command resolves as not executed and the market's absent-outcome handling applies

#### Scenario: Both markets reconcile alike
- **WHEN** a Spot command reconciles an ambiguous outcome
- **THEN** it retries a "no such order" answer exactly as the Futures path does

### Requirement: Cancel all cancels every order it presented
A cancel-all SHALL cancel every open order in the scope the operator was shown,
including orders of a kind that the exchange keeps in a separate book, using the
cancellation route each kind requires. When one kind cannot be cancelled the
system SHALL report which orders may still be live rather than reporting an
unqualified success.

#### Scenario: Conditional orders are open alongside regular ones
- **WHEN** the operator cancels all with both regular and conditional (ALGO) orders open
- **THEN** both books are cancelled and the resulting account read shows neither

#### Scenario: One book fails to cancel
- **WHEN** the regular cancellation succeeds and the conditional one fails
- **THEN** the operator is told that conditional orders may still be live, and the failure names the reason

#### Scenario: A single conditional order is cancelled
- **WHEN** the operator cancels one conditional order from any surface that lists it
- **THEN** the cancellation is sent on the route that accepts that order's identifier
