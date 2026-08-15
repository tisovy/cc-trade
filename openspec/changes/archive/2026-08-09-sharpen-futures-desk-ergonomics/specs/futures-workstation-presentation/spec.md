## ADDED Requirements

### Requirement: The order book is denominated in USDT and groupable
The order book SHALL express each level's size and cumulative size in USDT,
SHALL let the operator group levels by a price step derived from the contract's
tick size, and SHALL show the levels reached by that grouping rather than a
fixed ten per side. The `Spread` and raw update-id readouts SHALL be replaced by
the last traded price.

#### Scenario: Operator reads a level
- **WHEN** a level rests at a price with a base quantity
- **THEN** the row shows the price, the level's value in USDT, and the cumulative value in USDT from the top of the book

#### Scenario: Operator groups the book
- **WHEN** the operator selects a price step that is a multiple of the contract tick size
- **THEN** levels within one step are aggregated into a single row whose price is the step boundary on that side, and their USDT values are summed

#### Scenario: Contract has no usable tick size
- **WHEN** the contract's filters have not arrived
- **THEN** the book renders ungrouped at exchange precision instead of failing

### Requirement: The order book states which side is leaning on it
The order book SHALL show the split between resting buy and sell value across
the levels it displays, as a two-colour bar with both percentages stated in
text, measured in USDT rather than by level count.

#### Scenario: Bids rest more value than asks
- **WHEN** the visible bids hold three times the USDT the visible asks hold
- **THEN** the bar is three quarters positive-coloured and states 75.00% buy against 25.00% sell

#### Scenario: Operator changes the price step
- **WHEN** the grouping step changes the range of prices on screen
- **THEN** the split is recomputed over exactly the levels now displayed

#### Scenario: No book is available
- **WHEN** neither side has any resting value
- **THEN** no split is shown at all, rather than an even one

### Requirement: Instrument recency survives a restart independently of the catalogue
The instrument rail SHALL list the persisted recent contracts from the first
frame after a restart, before the contract catalogue has arrived, and SHALL
state that the catalogue is still loading rather than showing an empty list.

#### Scenario: Application restarts
- **WHEN** the workstation mounts with a persisted recency list and no catalogue yet
- **THEN** the recent contracts are listed and selectable, and the list reports that the catalogue is loading

#### Scenario: Catalogue arrives
- **WHEN** the catalogue arrives
- **THEN** each recent entry is replaced by its catalogue row in place, keeping recency ordering

### Requirement: Position rows are read at contract precision without dead fields
Position rows SHALL render entry, mark and liquidation prices at the contract's
tick precision, SHALL NOT show fields the account endpoint does not report, and
SHALL derive return on margin from the reported initial or isolated margin.

#### Scenario: Exchange reports a repeating float
- **WHEN** the exchange reports an entry price such as `3.3449999999999998`
- **THEN** the row shows it rounded to the contract's tick precision

#### Scenario: Margin mode and leverage are not reported
- **WHEN** the position endpoint reports neither margin mode nor leverage
- **THEN** no margin cell is shown, and return on margin is computed from the reported initial or isolated margin

#### Scenario: No margin figure is reported at all
- **WHEN** the position carries no usable margin figure
- **THEN** return on margin is shown as unavailable instead of as zero

### Requirement: Chrome states only what the desk reads
The market header SHALL NOT repeat mark price or basis, SHALL colour funding by
its sign, and the trading rail header SHALL NOT repeat the market identity or
the selected symbol shown elsewhere. Direction controls SHALL be coloured by
direction, and available balance SHALL be shown to cents.

#### Scenario: Funding is negative
- **WHEN** the funding rate is negative
- **THEN** it is rendered in the negative colour, and positive funding in the positive colour

#### Scenario: Operator reaches for a direction
- **WHEN** the long and short controls are displayed
- **THEN** long controls carry the positive colour and short controls the negative colour, so direction is readable without reading the label

#### Scenario: Balance carries exchange precision
- **WHEN** the exchange reports an available balance such as `245228.33961912`
- **THEN** the ticket shows it to two decimals
