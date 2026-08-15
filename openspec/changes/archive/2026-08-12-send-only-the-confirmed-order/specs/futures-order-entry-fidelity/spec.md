## Purpose

Defines the fidelity guarantees of the Futures order-entry surfaces: the
numbers the operator confirms are the numbers the exchange receives, a control
reports whether its command actually left the desk, and a draft never outlives
the object it was written for.

## ADDED Requirements

### Requirement: A confirmed order is sent with the numbers it was confirmed with
When an order is staged for confirmation, the system SHALL record the complete
draft — symbol, side, price, quantity, notional and reduce-only flag — and on
confirmation SHALL send exactly those values. The system SHALL NOT re-derive
the quantity or the notional at confirmation time from the current balance, the
current size percentage or any other value that may have changed while the
confirmation was open.

#### Scenario: Balance grows while the confirmation is open
- **WHEN** the available balance increases between staging and confirmation
- **THEN** the order sent carries the staged quantity and price, not a quantity re-derived from the larger balance

#### Scenario: Size controls move while the confirmation is open
- **WHEN** the size percentage or custom notional changes while a confirmation is open
- **THEN** confirming sends the staged quantity, and the changed size applies only to the next staged order

### Requirement: A staged order that no longer passes is refused, not re-sized
At confirmation the system SHALL re-evaluate readiness — connection, trading
pause, contract tradability, exchange filters, the local order cap and the
available balance — against the present state, and SHALL refuse the send when
the staged order no longer passes. The refusal SHALL name what was staged and
which bound it breaks. The system SHALL NOT alter the staged quantity or price
to make it pass.

#### Scenario: Balance falls below the staged notional
- **WHEN** the available balance drops below the staged notional before confirmation
- **THEN** nothing is sent, and the operator is told the staged size no longer fits the confirmed balance

#### Scenario: Trading is paused while the confirmation is open
- **WHEN** trading is paused between staging and confirmation
- **THEN** nothing is sent and the pause is stated as the reason

### Requirement: A command panel closes only when its command left the desk
An amend, cancel, close, margin or leverage control SHALL determine whether its
command was delivered to the main process, and SHALL close only on delivery.
When delivery fails the panel SHALL remain open and state that nothing was
sent.

#### Scenario: Socket closed when the panel submits
- **WHEN** the operator submits an amend, a close or a margin move while the local transport is closed
- **THEN** the panel stays open, states that the command was not sent, and no further command is issued on its behalf

#### Scenario: Command delivered
- **WHEN** the command reaches the main process
- **THEN** the panel closes, and the outcome is reported by the execution path as it is today

### Requirement: An open editor belongs to the object it was opened for
A floating editor SHALL be bound to the identity it edits. Re-targeting an
editor at a different order or position SHALL discard the previous draft and
seed the editor from the new target.

#### Scenario: Editor re-targeted at another order
- **WHEN** an order editor holding an unsubmitted price is re-targeted at a different order
- **THEN** the editor shows the new order's own values, and submitting sends the new order's identity with values derived from it

### Requirement: A leverage choice is bounded by the ceiling that arrives
The leverage editor SHALL bound the operator's choice by the contract's
reported maximum whenever that maximum arrives, including after the choice was
made. The bounded value SHALL be what is displayed and what submission sends.

#### Scenario: Ceiling arrives after the pick
- **WHEN** the operator picks 100× while the contract's maximum is still unknown and the exchange then reports a maximum of 20×
- **THEN** the editor shows 20× and Apply would send 20×
