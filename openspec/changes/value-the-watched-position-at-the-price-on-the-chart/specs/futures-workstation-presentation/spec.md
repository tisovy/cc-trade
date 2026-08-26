# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: The position on the contract on screen says what it is worth at the price on the chart

The exchange publishes a mark once a second, and the mark is a different
quantity from the price the chart is drawn from. A position in the contract the
operator is currently watching SHALL therefore state, under a name of its own
and beside the mark-based figure, what that position is worth at the last price
the contract traded at.

That reading SHALL be fed from the tape the workstation already receives for
the contract on screen. No additional subscription, socket or signed request
SHALL be made for it, and no contract other than the one on screen SHALL have
its tape read for this purpose.

It SHALL be a secondary reading in the sense the canonical valuation
requirement already fixes: it SHALL NOT be labelled uPnL, SHALL NOT enter the
dock total, and SHALL NOT reach return on margin, position value, margin,
liquidation or any risk decision. The mark-based figure SHALL remain the
headline on every surface.

The reading SHALL be withdrawn when the operator leaves that contract or the
workstation stops carrying its tape, so a price drawn from a chart no longer on
screen cannot stand beside a live mark. A withdrawn reading SHALL leave the
mark-based figure untouched.

#### Scenario: The contract on screen prints between marks

- **WHEN** the contract carrying an open position prints trades after the latest mark
- **THEN** the position states what it is worth at that printed price under its own name, while its uPnL, return on margin, position value and the dock total stay on the mark

#### Scenario: The tape prints faster than the surface can usefully redraw

- **WHEN** prints arrive faster than the bounded rate the desk redraws that reading at
- **THEN** they are coalesced to that rate and the newest printed price is the one stated

#### Scenario: The operator switches to another contract

- **WHEN** the workstation moves to a different contract, or stops carrying the tape of the one it was on
- **THEN** the tape-priced reading for the contract left behind is withdrawn rather than left standing beside a live mark, and that position's mark-based valuation is unchanged

#### Scenario: A position is open on a contract that is not on screen

- **WHEN** a position exists in a contract the operator is not currently watching
- **THEN** it is valued from the mark alone and no tape subscription is made for it
