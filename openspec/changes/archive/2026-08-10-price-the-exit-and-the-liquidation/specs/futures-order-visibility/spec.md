## MODIFIED Requirements

### Requirement: A position can be closed at market or with a reduce-only limit
The system SHALL let the operator close an open position either immediately at
market or through a reduce-only limit order at an operator-chosen price, for the
whole position or a smaller size, from the same control. The size SHALL be
choosable by dragging a control that spans the whole position as well as by
typing an exact size, with both floored to the contract's lot step, and the two
SHALL never disagree about the size being closed. The panel SHALL state what the
exit would settle — the size the position is left holding, the value coming off
the table and the profit that size would realize at the price the exit is priced
at — and SHALL NOT spend a summary cell restating the side or the reduce-only
nature that every close from it carries.

#### Scenario: Operator closes at market
- **WHEN** the operator confirms a market close
- **THEN** one reduce-only MARKET order is submitted on the side that reduces the position, for the requested size

#### Scenario: Operator closes with a limit
- **WHEN** the operator enters a close price and confirms a limit close
- **THEN** one reduce-only LIMIT order is submitted on the side that reduces the position, at the entered price, snapped to the contract's tick and step filters

#### Scenario: Requested close size exceeds the position
- **WHEN** the entered size is larger than the open position
- **THEN** the submission is refused with a stated reason and no order is sent, and the size control shows the whole position rather than more than it

#### Scenario: Operator drags the size control
- **WHEN** the operator drags the close size to a share of the position
- **THEN** the size becomes that share of the open quantity floored to the lot step, and the exact size appears in the field beside it

#### Scenario: Operator types a size
- **WHEN** the operator types an exact size
- **THEN** the control moves to the share of the position that size represents, computed as an exact decimal rather than as a float

#### Scenario: Size control is dragged to nothing
- **WHEN** the operator drags the size control to its lowest point
- **THEN** the panel holds no size, asks for one, and submits nothing

#### Scenario: Operator reads what the exit settles
- **WHEN** a close size is set
- **THEN** the panel states the size that would remain open, the value of the size being closed and the profit it would realize, each shown as absent rather than as zero when the account read cannot value it

#### Scenario: A limit price is entered
- **WHEN** the operator sets a limit close price
- **THEN** the value and the profit are computed at that price rather than at the mark, and the side the limit rests on is stated beside the price
