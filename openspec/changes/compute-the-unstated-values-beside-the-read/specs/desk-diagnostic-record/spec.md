## ADDED Requirements

### Requirement: The desk's own arithmetic is recorded as its distance from the exchange's
When a read answers with a value the desk also computed, the record SHALL keep
one event per value per read pass stating how many rows were compared, the
largest disagreement in basis points of the exchange's own answer, and the
contract that disagreement was on. The values themselves SHALL NOT be recorded:
the record accepts no amount, and a deviation SHALL be a bounded whole number of
basis points so that no price, size or balance can be reconstructed from the
file.

A value the desk could not compute SHALL be recorded as such, distinctly from
one it computed and got right, so that a fortnight of silence cannot be mistaken
for a fortnight of agreement.

The day's summary SHALL report, per value, how many passes were compared, the
worst disagreement and the contract it was on, and how many passes the desk
could not compute at all.

#### Scenario: The desk agrees with the exchange
- **WHEN** a read answers a liquidation price the desk had also computed
- **THEN** the record carries one event naming that value, the rows compared and the deviation in basis points, and no price

#### Scenario: The desk could not compute
- **WHEN** a read answers a value the desk had no brackets, mark or leverage to compute
- **THEN** the record carries an event stating that it could not be computed, and it does not read as agreement

#### Scenario: A deviation offered as an amount
- **WHEN** a comparison offers a deviation that is not a bounded whole number
- **THEN** the event is refused and no line is written for it

#### Scenario: The summary is read
- **WHEN** the operator reads the day's summary
- **THEN** it states, for each computed value, how many passes agreed, the worst disagreement and where, and how many could not be computed
