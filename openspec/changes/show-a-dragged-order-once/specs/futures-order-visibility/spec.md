## ADDED Requirements

### Requirement: An order has one representation on the chart at a time
At any moment the chart SHALL carry exactly one representation of a given
working order. While an order is being dragged, its resting representation —
price line, axis label and handle — SHALL be withdrawn, and the dragged
representation SHALL be the only mark standing for that order. Other orders SHALL
continue to be drawn as they are.

#### Scenario: A working order is dragged
- **WHEN** the operator holds the drag modifier and moves a working order on the chart
- **THEN** the order is drawn once, at the price under the pointer, and no full-strength copy of it remains at the price it is leaving

#### Scenario: Other orders during a drag
- **WHEN** one order is being dragged and others rest on the same contract
- **THEN** the others keep their own lines, labels and handles unchanged

### Requirement: The level an order is leaving is marked, not duplicated
While a drag is in flight the price the order rests at SHALL carry at most one
marker, visibly distinct from a working order and carrying no axis label, so the
move reads as a move rather than as a second order.

#### Scenario: The order has moved away from its resting price
- **WHEN** an order is dragged away from the price it rests at
- **THEN** that price carries a single faint marker and no order label

### Requirement: An abandoned drag restores what it withdrew
A drag that does not result in an amendment SHALL restore the order's resting
representation exactly as it was. This SHALL hold whether the drag was abandoned
by releasing the modifier, by cancelling, or by dropping the order at the price
it started from.

#### Scenario: The modifier is released mid-drag
- **WHEN** the operator releases the drag modifier before dropping
- **THEN** the order is drawn again at its resting price, with its line, label and handle

#### Scenario: The order is dropped where it started
- **WHEN** the operator drops an order at the price it already rests at
- **THEN** no amendment is prepared and the order's resting representation is restored

### Requirement: An order the exchange still holds is shown where it holds it
Between a drag being dropped and the exchange confirming the amendment, the
order SHALL be shown once, at the price the exchange is known to hold it at, and
SHALL be marked as being amended. It SHALL NOT be drawn at both prices, and it
SHALL NOT be shown at the new price before the exchange has reported it there.

#### Scenario: An amendment is awaiting the exchange
- **WHEN** a drag has been confirmed and the exchange has not yet reported the order at its new price
- **THEN** the order is drawn once, at the price it is still known to rest at, marked as being amended

#### Scenario: The exchange reports the moved order
- **WHEN** the exchange reports the order at its new price
- **THEN** the order is drawn once, at the new price, and no mark remains at the old one

#### Scenario: The amendment is refused
- **WHEN** the exchange refuses the amendment
- **THEN** the order is drawn at the price it still rests at, and the refusal is stated
