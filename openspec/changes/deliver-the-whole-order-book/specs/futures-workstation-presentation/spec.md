## MODIFIED Requirements

### Requirement: The order book is denominated in USDT and groupable
The order book SHALL express each level's size and cumulative size in USDT,
SHALL let the operator group levels by a price step derived from the contract's
tick size, and SHALL show the levels reached by that grouping rather than a
fixed ten per side. The `Spread` and raw update-id readouts SHALL be replaced by
the last traded price.

Because grouping is applied after delivery, the number of raw levels delivered
to the renderer SHALL be at least the deepest view the grouping control can ask
for and fully fill, and SHALL NOT be reduced below the depth the exchange
publishes. Delivery SHALL carry the whole retained book, and the bound the
payload validator enforces SHALL be the same value the book is built to, so a
book that is legal to build is never rejected on arrival.

#### Scenario: Operator reads a level
- **WHEN** a level rests at a price with a base quantity
- **THEN** the row shows the price, the level's value in USDT, and the cumulative value in USDT from the top of the book

#### Scenario: Operator groups the book
- **WHEN** the operator selects a price step that is a multiple of the contract tick size
- **THEN** levels within one step are aggregated into a single row whose price is the step boundary on that side, and their USDT values are summed

#### Scenario: Contract has no usable tick size
- **WHEN** the contract's filters have not arrived
- **THEN** the book renders ungrouped at exchange precision instead of failing

#### Scenario: A coarse step is selected
- **WHEN** the operator selects a step of 25 or 50 ticks and the exchange has published enough levels to reach it
- **THEN** every visible row is filled from delivered levels, rather than the book appearing to end a fraction of a percent from the mid

#### Scenario: The book reaches the end of what the exchange publishes
- **WHEN** the selected step would need more levels than Binance serves for the contract
- **THEN** the rows that can be filled are filled and the remainder are absent, and no level is invented or inferred from diff traffic beyond the snapshot's window

### Requirement: The order book states which side is leaning on it
The order book SHALL show the split between resting buy and sell value across
the levels it displays, as a two-colour bar with both percentages stated in
text, measured in USDT rather than by level count. The split SHALL be
accompanied by the price range the displayed rows cover, expressed as a
percentage of the last traded price, because the same split across a fraction
of a percent and across ten percent are different readings.

#### Scenario: Bids rest more value than asks
- **WHEN** the visible bids hold three times the USDT the visible asks hold
- **THEN** the bar is three quarters positive-coloured and states 75.00% buy against 25.00% sell

#### Scenario: Operator changes the price step
- **WHEN** the grouping step changes the range of prices on screen
- **THEN** the split is recomputed over exactly the levels now displayed, and the stated range changes with it

#### Scenario: Operator reads how far the book reaches
- **WHEN** the farther of the two visible edges sits 2.43% from the last traded price
- **THEN** the legend states `±2.43%` beside the split

#### Scenario: No book is available
- **WHEN** neither side has any resting value
- **THEN** no split is shown at all, rather than an even one

## ADDED Requirements

### Requirement: Transport bounds are derived from the payload they carry
Every bound that a workstation event must satisfy to be delivered and read —
its byte ceiling, the parser's node budget, and the level count the payload
rules accept — SHALL be derived from a single statement of how much book is
delivered, rather than written independently. Exceeding any of these bounds
stops the resource entirely instead of degrading it, so the bounds SHALL be
proven against the widest payload the rules call legal rather than against a
representative one.

#### Scenario: The deepest legal book is delivered
- **WHEN** an event carries a full book at the longest decimals and identities the payload rules accept
- **THEN** it is within the byte ceiling and is parsed to completion, rather than being refused for size or for resource limits

#### Scenario: The delivered depth is changed
- **WHEN** the number of levels delivered per side is changed
- **THEN** the payload validator's bound and the parser's node budget follow it without a second edit
