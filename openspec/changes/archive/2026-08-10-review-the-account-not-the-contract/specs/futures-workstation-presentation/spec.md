## MODIFIED Requirements

### Requirement: An amount too large to read is abbreviated by magnitude
An amount whose magnitude is what it is read for SHALL be shown abbreviated —
thousands, millions and billions — rather than as its full digit string, and the
exact figure SHALL remain available on the element. No abbreviation SHALL leave a
suffix that abbreviates nothing, such as thousands of millions.

An abbreviated amount SHALL name the unit it is stated in, and SHALL be the leg
that unit measures: a day's volume in USDT is the quote leg, never the count of
contracts traded. Where both legs exist, the other SHALL remain available on the
element with its own unit named.

#### Scenario: A daily volume is displayed
- **WHEN** the market header shows a 24-hour volume of tens of millions
- **THEN** it is shown as a magnitude with one decimal and its unit, and the exact figure is on the element's title

#### Scenario: An amount reaches the billions
- **WHEN** an abbreviated amount is a billion or more
- **THEN** it carries a billions suffix rather than being printed as a four-digit millions figure

#### Scenario: The contract trades billions of units of a cheap asset
- **WHEN** a contract's 24-hour base volume is billions of contracts and its quote volume is hundreds of millions of USDT
- **THEN** the header states the quote volume against a USDT label, and the base count is on the element's title with the base asset named

### Requirement: A reading is never silently sliced by its column
A cell whose content can outgrow it SHALL keep the whole of the reading the
operator is looking for and SHALL carry the exact figures on the element. Where a
cell holds a primary amount and a secondary percentage, the percentage SHALL NOT
be the part that is cut.

A column of money SHALL be sized for the amounts the account can actually reach —
five figures and two decimals — rather than for the amounts it holds today. Where a
table cannot fit every reading in the width it has, a component of a result SHALL
give up its column to the element's title before the result itself does.

#### Scenario: A uPnL and its ROE together outgrow the column
- **WHEN** an unrealized PnL and the ROE beside it are wider than the column allows
- **THEN** the percentage is shown whole, the amount gives way with an ellipsis, and both figures are stated exactly in the cell's title

#### Scenario: A five-figure amount is reported beside its percentage
- **WHEN** a position's unrealized PnL reaches five figures and two decimals
- **THEN** both the amount and its percentage are shown whole, with neither shortened

#### Scenario: A history table has more readings than width
- **WHEN** the closed-position history cannot fit every reading in the dock's width
- **THEN** the realized PnL keeps its column and the fee is stated in that cell's title together with the net
