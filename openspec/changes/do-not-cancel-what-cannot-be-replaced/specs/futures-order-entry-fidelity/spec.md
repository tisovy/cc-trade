## ADDED Requirements

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
