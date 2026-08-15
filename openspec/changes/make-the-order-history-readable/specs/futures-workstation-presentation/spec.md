## MODIFIED Requirements

### Requirement: A reading is never silently sliced by its column
A cell whose content can outgrow it SHALL keep the whole of the reading the
operator is looking for and SHALL carry the exact figures on the element. Where a
cell holds a primary amount and a secondary percentage, the percentage SHALL NOT
be the part that is cut.

A column of money SHALL be sized for the amounts the account can actually reach —
five figures and two decimals — rather than for the amounts it holds today. Where a
table cannot fit every reading in the width it has, a component of a result SHALL
give up its column to the element's title before the result itself does.

Where a cell states a word the exchange reported — a status, an order type — and
its track cannot hold that word, the desk SHALL state a form that fits and SHALL
carry the exchange's own word on the element. A word cut to an ellipsis with
nothing on the element is not a reading.

#### Scenario: A uPnL and its ROE together outgrow the column
- **WHEN** an unrealized PnL and the ROE beside it are wider than the column allows
- **THEN** the percentage is shown whole, the amount gives way with an ellipsis, and both figures are stated exactly in the cell's title

#### Scenario: A five-figure amount is reported beside its percentage
- **WHEN** a position's unrealized PnL reaches five figures and two decimals
- **THEN** both the amount and its percentage are shown whole, with neither shortened

#### Scenario: A history table has more readings than width
- **WHEN** the closed-position history cannot fit every reading in the dock's width
- **THEN** the realized PnL keeps its column and the fee is stated in that cell's title together with the net

#### Scenario: An exchange word is wider than its track
- **WHEN** a status or order type the exchange reported is wider than the track it is shown in
- **THEN** the cell states a form that fits its track and carries the exchange's own word on the element
