## ADDED Requirements

### Requirement: The working-orders list is read as a table, not as sentences
The list of working orders SHALL state the unit of each column once, at the head
of the list, and no row SHALL repeat it. Every column SHALL occupy a bounded
track and SHALL shorten its own content when it does not fit, so that no column
can be squeezed out of the row by another and the cancel control keeps its
place at every width.

A price SHALL be stated at the precision the contract quotes where that
precision is known, and with the exchange's float padding removed where it is
not; the padded string the exchange sends SHALL NOT be rendered as though it
were precision. A symbol MAY be shortened to its base asset where the quote
asset is the one every contract on the desk settles in, provided the whole name
remains available on the cell and on every control that acts on the contract.

#### Scenario: A row states a value
- **WHEN** an order worth 10 982 USDT rests in the list
- **THEN** the row states `10982`, the unit is stated once by the column heading, and the exact contract count is available on the cell

#### Scenario: The exchange pads a price
- **WHEN** the exchange reports the order resting at `0.0148410`
- **THEN** the row states `0.014841`, and a contract whose tick size is known is stated at that tick instead

#### Scenario: An order rests on another contract
- **WHEN** the account holds orders on contracts other than the one on screen
- **THEN** every row names its own contract, shortened to its base asset with the whole name on the cell, rather than losing the column to its neighbours
