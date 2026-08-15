## ADDED Requirements

### Requirement: The contract list keeps its rows at their own height
Every row of the instrument rail's contract list SHALL be drawn at the height its
own content needs, whatever the length of the list and whatever height the panel
around it has been given. A list longer than its panel SHALL scroll; it SHALL NOT
be fitted by compressing its rows.

The list SHALL keep a floor of readable rows next to the execution ticket. Where
the two together exceed the column, the column SHALL scroll rather than the list
being reduced to nothing.

#### Scenario: The catalogue is longer than the panel
- **WHEN** the rail lists the whole contract catalogue in a panel that can show only a few rows
- **THEN** each row keeps the height of its own content and the list scrolls to reach the rest

#### Scenario: The ticket beside it is tall
- **WHEN** the execution ticket grows past the height the column has left
- **THEN** the contract list keeps at least three readable rows and the column scrolls

### Requirement: The instrument rail is sized for the rows it carries
The instrument column SHALL be wide enough for a working-order row in the ticket
to state its contract, its side, its price and what it is worth in USDT without
any of them being cut, for the contracts and amounts this desk actually holds.
Where a reading still cannot fit, it SHALL be shortened by the rules that already
govern a sliced reading rather than by narrowing the column further.

#### Scenario: Working orders rest on several contracts
- **WHEN** the ticket lists working orders whose prices run to five significant digits and whose values run to six
- **THEN** every row states its price and its USDT value whole, with neither ellipsized
