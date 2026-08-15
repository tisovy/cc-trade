# trading-command-integrity Specification

## Purpose
States the absence of a parallel legacy submission path as a property of the
system, so the local band check found in `src/utils/operations.js` cannot
return and no unreachable order-entry code is left reading as available.
## Requirements
### Requirement: The renderer has one reachable trading-submission path
Every trading submission the renderer can make SHALL be built by the typed
command builders and SHALL carry the validation, the command identity and the
risk ceiling those builders and the main process apply. The renderer SHALL NOT
retain an unreachable order-entry or cancellation path alongside them, and
SHALL NOT evaluate an exchange filter that the desk has delegated to the
exchange.

#### Scenario: A legacy submission helper has no caller
- **WHEN** a renderer function that sends a trading frame has no caller
- **THEN** it is deleted rather than kept, so no path exists that bypasses typed validation, command identity and the risk ceiling

#### Scenario: A submission frame is built
- **WHEN** the renderer sends any trading command
- **THEN** the frame comes from the typed command builders and no other module composes one

#### Scenario: A delegated filter is evaluated locally
- **WHEN** renderer code evaluates the price minimum or maximum, the percent-price band, or the maximum open order count
- **THEN** that evaluation is removed, whether or not the code holding it is reachable

### Requirement: An indeterminate execution outcome is not reported as a rejection
The system SHALL distinguish a determinate outcome, where the exchange answered
with an acceptance or a business rejection, from an indeterminate outcome,
where the request may or may not have executed. A request timeout, a socket
error, an aborted response, and an exchange-side 5xx response on a mutating
request SHALL each produce an explicit unresolved outcome carrying the
command's client identity. An indeterminate outcome SHALL NOT be presented to
the operator as a rejection, and SHALL NOT be presented as a success.

#### Scenario: Order placement times out
- **WHEN** a submitted order request exceeds the transport timeout
- **THEN** the command reports an unresolved outcome carrying its client identity, and neither a rejection nor an execution acknowledgement is emitted

#### Scenario: Exchange returns an unknown-error response
- **WHEN** the exchange answers a mutating request with a 5xx response
- **THEN** the command reports an unresolved outcome, because the execution may already have occurred

#### Scenario: Exchange rejects the order on its merits
- **WHEN** the exchange answers with a business rejection such as a filter or margin failure
- **THEN** the command reports a determinate rejection with the exchange-reported reason

#### Scenario: Both markets classify alike
- **WHEN** an indeterminate transport failure occurs on a Spot command
- **THEN** it is classified exactly as the equivalent Futures failure is

### Requirement: An unresolved outcome is reconciled before any resubmission
The system SHALL resolve an unresolved outcome by querying the exchange for the
order under the command's client identity, with bounded retries, before the
same intent may be submitted again. Resubmission SHALL be permitted only when
the exchange reports no order under that identity, and SHALL reuse the original
identity. When reconciliation cannot resolve the outcome, the system SHALL
report it as unresolved and SHALL NOT offer a retry control.

#### Scenario: The ambiguous order actually executed
- **WHEN** reconciliation finds an order under the command's client identity
- **THEN** its execution report becomes the outcome of the command and no second order is submitted

#### Scenario: The ambiguous order never reached the exchange
- **WHEN** reconciliation confirms that no order exists under the command's client identity
- **THEN** the intent may be resubmitted, and it is resubmitted under the same client identity

#### Scenario: Reconciliation itself keeps failing
- **WHEN** the bounded reconciliation attempts are exhausted without an answer
- **THEN** the command remains reported as unresolved, the operator is told the exchange state is unconfirmed, and no retry control is offered

### Requirement: A command identity is stable across retries
The system SHALL mint one client identity per operator intent and SHALL preserve
it across every rebuild, retry, and redelivery of that intent on both markets.
The identity SHALL be sent to the exchange as the order's client order id on
Spot and on Futures. A retry SHALL NOT mint a new identity.

#### Scenario: A retried intent keeps its identity
- **WHEN** an intent is submitted again after an unresolved or transient failure
- **THEN** the exchange receives the client identity of the first attempt

#### Scenario: Spot placement carries the identity
- **WHEN** a validated Spot placement command carrying a client identity is submitted
- **THEN** the exchange request carries that identity as the new client order id

#### Scenario: Operator-supplied identity is honoured
- **WHEN** the command payload already carries a client identity
- **THEN** that identity is used unchanged rather than replaced by a generated one

### Requirement: Reconciliation after a mutating command cannot be lost
A reconciliation requested after a placement, amendment or cancellation SHALL
be performed even when another reconciliation is already running: it SHALL be
queued rather than discarded. Each account snapshot SHALL carry the mutation
epoch it was started under, and a snapshot whose epoch precedes the most recent
confirmed mutating command SHALL NOT replace state produced by that command.

#### Scenario: A refresh is already running
- **WHEN** a mutating command completes while an account refresh is in flight
- **THEN** a further refresh runs after the current one instead of being dropped

#### Scenario: An older snapshot lands late
- **WHEN** a snapshot started before a confirmed amendment returns after it
- **THEN** the snapshot does not restore the pre-amendment order state

#### Scenario: A newer snapshot lands
- **WHEN** a snapshot started after the last confirmed mutating command returns
- **THEN** it replaces the local state as the current account truth

### Requirement: Every trading command failure reaches the operator
A failed Spot or Futures trading command SHALL produce a market-scoped
`command_rejected` carrying a stable local code and a sanitized explanation. A
failure SHALL NOT be reported only to the application log.

#### Scenario: Spot placement fails
- **WHEN** a Spot order placement fails at the exchange or in transport
- **THEN** a market-scoped rejection is emitted and the operator sees the command as rejected

#### Scenario: Spot cancellation fails
- **WHEN** a Spot cancellation fails
- **THEN** a market-scoped rejection is emitted rather than a log-only entry

#### Scenario: An unresolved outcome is not a rejection
- **WHEN** a command ends unresolved rather than failed
- **THEN** it is reported as unresolved and is not emitted as a rejection

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

#### Scenario: Both markets hold it the same way
- **WHEN** a Spot command's outcome is unknown and a different Spot order is refused afterwards
- **THEN** the unknown outcome is still shown, beside the refusal rather than replaced by it

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

