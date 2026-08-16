# futures-order-entry-fidelity Specification

## Purpose
Defines the fidelity guarantees of the Futures order-entry surfaces: the
numbers the operator confirms are the numbers the exchange receives, a control
reports whether its command actually left the desk, and a draft never outlives
the object it was written for.
## Requirements
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

### Requirement: An amendment does not cancel what it cannot replace
An amendment carried out as a cancellation and a placement SHALL evaluate the
replacement against every bound the desk enforces on a placement, and SHALL do so
before every step it cannot take back — not only before the placement.

Where the whole amendment is known before anything is sent, it SHALL be refused
whole: no cancellation is sent, the existing order stays live at the exchange,
and the refusal names the bound in the same words a refused placement would.

Where the desk cancels before the replacement exists — a drag takes the order off
the book when it is picked up, and the price it will be dropped at is not known
until the operator lets go — the cancellation SHALL be evaluated against the
order at the price it is resting at, and an order the desk could not place back
where it rests SHALL NOT be picked up at all. When the drop is then refused by a
bound the desk holds, the move SHALL be refused rather than the order: the order
is placed again at the price it was resting at, no price is invented to make the
drop fit, and the operator is told which bound refused the move.

Where the replacement is refused for a reason the desk could not have known in
advance, the existing behaviour stands — the operator is told the order was
cancelled and not replaced.

A refusal SHALL state only what the desk knows: an order it could not value
SHALL be refused as one it could not value, never as one of a size it never
measured. And the desk SHALL NOT offer to place an order again at a price it has
itself just refused — a control that cannot do what it says is worse than no
control, and where the price the order was resting at is refused too, the
operator is told the order is gone rather than told it merely did not move.

#### Scenario: The order could not be placed back where it rests
- **WHEN** a drag would pick up an order that a bound the desk holds would refuse at its own resting price
- **THEN** no cancellation is issued, the order stays live, and the refusal names the bound

#### Scenario: The drop falls under a bound the desk enforces
- **WHEN** an order is dropped at a price the placement path would refuse
- **THEN** the order is placed again at the price it was resting at, and the refusal names the bound

#### Scenario: A dragged order is returned to where it rests
- **WHEN** the replacement for a refused move is confirmed
- **THEN** the order is drawn at the price it rests at, and the drag's mark at the price it was dropped on is gone

#### Scenario: A bound the desk does not hold refuses nothing
- **WHEN** the drop would fall under a bound whose value the desk has not loaded for that contract
- **THEN** the move is sent and the exchange decides, rather than being refused against a bound invented here

#### Scenario: The price it was resting at is refused as well
- **WHEN** an amendment is refused and the price the order was resting at is refused by a bound the desk holds too
- **THEN** the operator is told the order was cancelled and not replaced, and is offered no control to place it again at that price

#### Scenario: The order cannot be valued at all
- **WHEN** an amendment cannot be valued against a bound the desk holds
- **THEN** it is refused, and the refusal says the order could not be valued rather than naming a size

#### Scenario: The exchange refuses something the desk could not judge
- **WHEN** a replacement the desk had no bound for is refused by the exchange
- **THEN** the operator is told the order was cancelled and not replaced, as today

### Requirement: The order size is one value across every surface that states it
When the size of a staged order is changed on the confirmation panel, the rail
that staged it SHALL state the same size. The desk SHALL NOT leave two different
sizes on screen at once, one of them the figure the operator set deliberately.

The **amount** SHALL be what is carried between the two surfaces, not the
percentage. The rail's slider is a share of the available balance; an exit's
slider on the confirmation is a share of the position being closed. The two
percentages measure different things, and the amount is the only reading that
means the same on both.

#### Scenario: The size is changed at the cursor
- **WHEN** the operator sets a size on the rail, stages an order by gesture, and then moves the size slider on the confirmation panel
- **THEN** the rail states the new size — both the amount and its share — rather than the size it was left at

#### Scenario: An exit is resized against its own position
- **WHEN** the size of a staged exit is changed on the confirmation, where the slider is a share of the position rather than of the balance
- **THEN** the rail states the resulting amount, and its own share is recomputed against the balance rather than copied from the confirmation

