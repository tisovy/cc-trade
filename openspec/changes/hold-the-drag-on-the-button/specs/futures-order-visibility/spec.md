## MODIFIED Requirements

### Requirement: A drag lifts the order off the book
Beginning a drag on a working order SHALL cancel that order. A drag SHALL begin
only on a working order picked up with the trading modifier held, and SHALL be
held by the pointer from then on: the modifier SHALL NOT be required for the
gesture to continue, and releasing it SHALL neither end the gesture nor change
where the order is going. The drag SHALL follow the pointer from the moment the
gesture begins, without waiting for the cancellation to be answered; the desk
SHALL NOT present the order as gone until the cancellation is confirmed. If the
cancellation is refused or its outcome is unknown, the drag SHALL end with
nothing lifted and the order SHALL be left alone. Once the cancellation is
confirmed the order SHALL leave the chart, the order list and every other
surface that lists working orders, because it no longer exists.

#### Scenario: The operator picks an order up
- **WHEN** the operator begins a drag on a working order and the exchange confirms the cancellation
- **THEN** the order is no longer listed as working and no longer drawn at the price it rested at

#### Scenario: The pointer moves before the exchange answers
- **WHEN** the operator begins a drag and moves the pointer while the cancellation is still in flight
- **THEN** the mark for where the order is going follows the pointer, without waiting for the answer

#### Scenario: The modifier is released during the gesture
- **WHEN** the operator lets the trading modifier go while the button is still down
- **THEN** the drag continues and the mark keeps following the pointer, whether or not the cancellation has been answered

#### Scenario: The cancellation is refused
- **WHEN** the exchange refuses the cancellation
- **THEN** the drag ends, the order remains working and drawn where it was, and the refusal is stated

#### Scenario: The cancellation's outcome is unknown
- **WHEN** the cancellation is sent and the exchange does not confirm it either way
- **THEN** the drag ends and the unknown outcome is presented as unknown, so the operator is not told the order is gone

### Requirement: A drag owes a replacement
From the moment a lifted order's cancellation is confirmed, the system SHALL owe
a replacement order and SHALL discharge that obligation in exactly one of three
ways: by placing the replacement at the price the drag ended on, by placing it
again at the price it was lifted from when the drag is abandoned, or by stating
that neither could be placed. The price the drag ended on SHALL be the price
under the pointer when the button came up, and SHALL NOT depend on whether the
modifier was still held at that moment. A gesture that ends before the
cancellation is answered SHALL be discharged at the price it ended on, on the
same terms as one that ends after. The third case SHALL name the order that is
gone, state why the replacement failed, and offer to place it again. It SHALL
NOT be reported only in a log.

#### Scenario: The drag ends at a new price
- **WHEN** the operator drops a dragged order at a price the desk accepts
- **THEN** a replacement order is placed at that price

#### Scenario: The button comes up with the modifier already released
- **WHEN** the operator lets the modifier go and then releases the button at a new price
- **THEN** the replacement is placed at that price rather than at the price the order was lifted from

#### Scenario: The drop lands before the cancellation is answered
- **WHEN** the operator drops the order at a new price while the cancellation is still in flight, and the cancellation is then confirmed
- **THEN** the replacement is placed at the price it was dropped at rather than at the price it was lifted from

#### Scenario: The drag is abandoned
- **WHEN** the operator abandons the drag by dropping it at the price the order was lifted from, or the gesture is cancelled
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

#### Scenario: Two orders are lifted before either is dropped
- **WHEN** the operator lets go of one drag inside its cancellation round trip, lifts another, and both are then dropped
- **THEN** each order is placed at the price its own drag ended on and in its own size, and neither obligation is discharged by the other's drop

#### Scenario: A drop names an order nothing is owed for
- **WHEN** a drop names an order the system holds no outstanding obligation for
- **THEN** nothing is placed, because that would be a new order rather than a replacement

#### Scenario: One drag ends twice
- **WHEN** the same drag is dropped more than once
- **THEN** one replacement is placed, not one per drop

#### Scenario: An earlier drag is discharged during a later gesture
- **WHEN** an earlier drag's cancellation or replacement is answered while the operator is in the middle of another drag
- **THEN** the drag in hand keeps the pointer and still ends where the operator releases it
