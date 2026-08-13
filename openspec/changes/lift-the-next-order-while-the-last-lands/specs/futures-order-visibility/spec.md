## MODIFIED Requirements

### Requirement: A drag owes a replacement
From the moment a lifted order's cancellation is confirmed, the system SHALL owe
a replacement order and SHALL discharge that obligation in exactly one of three
ways: by placing the replacement at the price the drag ended on, by placing it
again at the price it was lifted from when the drag is abandoned, or by stating
that neither could be placed. The third case SHALL name the order that is gone,
state why the replacement failed, and offer to place it again. It SHALL NOT be
reported only in a log.

Obligations SHALL be held per order, and SHALL be discharged independently. An
outstanding obligation for one order SHALL NOT prevent another order from being
lifted: the wait it imposes is a round trip through the operator's proxy, during
which every order on every contract was unmovable. Lifting an order that is
already lifted SHALL be refused, because it is no longer on the book.

Where more than one obligation is outstanding, each SHALL be stated on its own,
naming its own order, its own reason and its own price to place it again, and
answering one SHALL NOT clear the record of another.

No path out of a lift SHALL be silent. A lift that is refused SHALL say so and
SHALL make clear that the order was left where it was, which is not the same
thing as an order that is gone.

#### Scenario: The drag ends at a new price
- **WHEN** the operator drops a dragged order at a price the desk accepts
- **THEN** a replacement order is placed at that price

#### Scenario: The drag is abandoned
- **WHEN** the operator abandons the drag by releasing the modifier, by cancelling, or by dropping at the price the order was lifted from
- **THEN** the order is placed again at the price it was lifted from

#### Scenario: The replacement cannot be placed
- **WHEN** the replacement is refused by the exchange or by a local limit
- **THEN** the desk states that the order was cancelled and not replaced, names it, gives the reason, and offers to place it again

#### Scenario: The replacement's outcome is unknown
- **WHEN** the replacement is sent and its outcome is not confirmed
- **THEN** it is presented as unknown and no further replacement is placed automatically, because a second attempt could leave two orders on the book

#### Scenario: A second order is reached for before the first has landed
- **WHEN** the operator lifts another order while a replacement for an earlier one is still in flight
- **THEN** the second order is lifted, and the two obligations are discharged independently

#### Scenario: Two replacements both fail
- **WHEN** two outstanding replacements are both refused
- **THEN** each is stated on its own, naming its own order and reason, and placing one again leaves the other's statement standing

#### Scenario: The same order is lifted twice
- **WHEN** a lift is attempted for an order that is already lifted
- **THEN** it is refused with a statement, rather than nothing happening
