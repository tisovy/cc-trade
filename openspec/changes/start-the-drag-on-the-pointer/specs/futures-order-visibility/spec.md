## ADDED Requirements

### Requirement: A drag does not pay for the rest of the desk
Following the pointer SHALL cost a fixed, small amount of work per pointer move,
independent of how much of the desk is being redrawn at the same time.

The gesture SHALL NOT read the desk's layout while it runs: the chart's box SHALL
be measured once for the gesture and measured again only when the chart is
resized. A layout read is answered cheaply only against a layout that is already
clean, and the desk's never is — the book, the dock and the header write to it
throughout the drag — so a read at pointer rate lays the whole desk out again on
every frame of the gesture.

The mark that follows the pointer SHALL be moved by a property that does not
invalidate layout, so that neither the desk nor the charting library is charged a
fresh layout pass for the frame the operator is dragging in. A pointer move that
leaves the mark on the row it already occupies SHALL redraw nothing.

#### Scenario: The pointer moves while the desk is busy
- **WHEN** the operator drags an order while the rest of the desk is being redrawn from the stream
- **THEN** the mark follows the pointer, and the gesture measures no layout to do it

#### Scenario: The chart is resized during a drag
- **WHEN** the chart's box changes while a drag is in flight
- **THEN** the next pointer move is placed against the new box

#### Scenario: A move that changes nothing
- **WHEN** a pointer move leaves the mark on the row it already occupies
- **THEN** neither the chart nor the mark is redrawn

## MODIFIED Requirements

### Requirement: A drag lifts the order off the book
Beginning a drag on a working order SHALL cancel that order. The drag SHALL
follow the pointer from the moment the gesture begins, without waiting for the
cancellation to be answered; the desk SHALL NOT present the order as gone until
the cancellation is confirmed. If the cancellation is refused or its outcome is
unknown, the drag SHALL end with nothing lifted and the order SHALL be left
alone. Once the cancellation is confirmed the order SHALL leave the chart, the
order list and every other surface that lists working orders, because it no
longer exists.

#### Scenario: The operator picks an order up
- **WHEN** the operator begins a drag on a working order and the exchange confirms the cancellation
- **THEN** the order is no longer listed as working and no longer drawn at the price it rested at

#### Scenario: The pointer moves before the exchange answers
- **WHEN** the operator begins a drag and moves the pointer while the cancellation is still in flight
- **THEN** the mark for where the order is going follows the pointer, without waiting for the answer

#### Scenario: The cancellation is refused
- **WHEN** the exchange refuses the cancellation
- **THEN** the drag ends, the order remains working and drawn where it was, and the refusal is stated

#### Scenario: The cancellation's outcome is unknown
- **WHEN** the cancellation is sent and the exchange does not confirm it either way
- **THEN** the drag ends and the unknown outcome is presented as unknown, so the operator is not told the order is gone

### Requirement: The order being dragged is drawn
While a drag is in flight the order that will be placed SHALL be drawn at the
price under the pointer, carrying its side and its size. Until the cancellation
is confirmed that mark SHALL be drawn as pending — distinguishably from a lifted
order — and the working order SHALL remain drawn at the price it rests at,
because it is still on the book. From the confirmation onward the pointer's mark
SHALL be the only mark on the chart standing for that order, and the price it
was lifted from MAY carry one faint marker, distinct from a working order and
without an axis label.

#### Scenario: The cancellation is still in flight
- **WHEN** the operator is dragging an order whose cancellation has not been answered
- **THEN** the mark at the pointer is drawn as pending, and the working order is still drawn where it rests

#### Scenario: An order is being dragged
- **WHEN** an order is being dragged across the chart after its cancellation was confirmed
- **THEN** it is drawn once, at the pointer, and no working-order mark for it remains at the price it was lifted from

#### Scenario: Other orders during a drag
- **WHEN** one order is being dragged and others rest on the same contract
- **THEN** the others keep their lines, labels and handles unchanged

### Requirement: A drag owes a replacement
From the moment a lifted order's cancellation is confirmed, the system SHALL owe
a replacement order and SHALL discharge that obligation in exactly one of three
ways: by placing the replacement at the price the drag ended on, by placing it
again at the price it was lifted from when the drag is abandoned, or by stating
that neither could be placed. A gesture that ends before the cancellation is
answered SHALL be discharged at the price it ended on, on the same terms as one
that ends after. The third case SHALL name the order that is gone, state why the
replacement failed, and offer to place it again. It SHALL NOT be reported only in
a log.

#### Scenario: The drag ends at a new price
- **WHEN** the operator drops a dragged order at a price the desk accepts
- **THEN** a replacement order is placed at that price

#### Scenario: The drop lands before the cancellation is answered
- **WHEN** the operator drops the order at a new price while the cancellation is still in flight, and the cancellation is then confirmed
- **THEN** the replacement is placed at the price it was dropped at rather than at the price it was lifted from

#### Scenario: The drag is abandoned
- **WHEN** the operator abandons the drag by releasing the modifier, by cancelling, or by dropping at the price the order was lifted from
- **THEN** the order is placed again at the price it was lifted from

#### Scenario: The replacement cannot be placed
- **WHEN** the replacement is refused by the exchange or by a local limit
- **THEN** the desk states that the order was cancelled and not replaced, names it, gives the reason, and offers to place it again

#### Scenario: The replacement's outcome is unknown
- **WHEN** the replacement is sent and its outcome is not confirmed
- **THEN** it is presented as unknown and no further replacement is placed automatically, because a second attempt could leave two orders on the book
