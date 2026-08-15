## Purpose

Defines the integrity guarantees that apply to every Spot and USDⓈ-M Futures
trading command: an execution outcome is never ambiguous to the operator, a
command carries one stable identity across retries, and the reconciliation that
follows a mutating command cannot be lost or overwritten by older state.

Protection against a redelivered or concurrently duplicated command frame, and
serialization of mutating commands on one order, are deliberately out of scope
here and are carried by `serialize-and-deduplicate-trading-commands`.

## ADDED Requirements

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
