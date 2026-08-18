## MODIFIED Requirements

### Requirement: An order is valued at the price it rests at
An order's stated value SHALL use its own usable positive limit price where it has one. A stop-limit or take-profit-limit order therefore SHALL be valued at its limit price, not at the trigger that decides when it becomes active. Only an order without a usable limit price, including a market-triggered stop whose ordinary `price` is zero, SHALL fall back to its positive trigger price. The normalized order SHALL carry that trigger for regular orders as it already does for algorithmic ones, and SHALL omit the field where the exchange reports no trigger rather than carrying a zero that would be read as a price.

An order SHALL NOT be valued at zero because a field it needs is missing. An order with no usable price or no usable size SHALL be reported as unvaluable, so that a row which could not be read is distinguishable from an order that commits nothing.

#### Scenario: A stop rests in the list
- **WHEN** the exchange reports a resting stop with `price` `0` and a trigger of `58000` for `0.5` contracts
- **THEN** the order is shown at `58000` and valued at `29000` USDT, in the list and in any total of the working orders

#### Scenario: A stop-limit has both prices
- **WHEN** a stop-limit order has a trigger of `58000`, a limit price of `57900` and a working quantity of `0.5` contracts
- **THEN** its stated value is `28950` USDT from the limit price, while the trigger remains separately available as the activation price

#### Scenario: A limit order has no trigger
- **WHEN** the exchange reports a plain limit order
- **THEN** the normalized order carries no trigger price at all, and is shown and valued at its limit price

#### Scenario: An order cannot be valued
- **WHEN** an order carries no usable price, or a close-position stop carries no quantity of its own
- **THEN** it is reported as unvaluable and shown as absent, not as an order worth zero, and it is left out of the working-orders total rather than adding zero to it

### Requirement: The working-orders list is read as a table, not as sentences
The list of working orders SHALL state the unit of each column once, at the head
of the list, and no row SHALL repeat it. Every column SHALL occupy a bounded
track and SHALL shorten its own content when it does not fit, so that no column
can be squeezed out of the row by another and the cancel control keeps its
place at every width.

A price SHALL be stated at the precision the row's own contract quotes where
that precision is known, regardless of which contract is currently selected,
and with the exchange's float padding removed where it is not; the padded string
the exchange sends SHALL NOT be rendered as though it were precision. A symbol
MAY be shortened to its base asset where the quote asset is the one every
contract on the desk settles in, provided the whole name remains available on
the cell and on every control that acts on the contract.

#### Scenario: A row states a value
- **WHEN** an order worth 10 982 USDT rests in the list
- **THEN** the row states `10982`, the unit is stated once by the column heading, and the exact contract count is available on the cell

#### Scenario: The exchange pads a price
- **WHEN** the exchange reports the order resting at `0.0148410`
- **THEN** the row states `0.014841`, and a contract whose tick size is known is stated at that tick instead

#### Scenario: An order rests on another contract
- **WHEN** the account holds orders on contracts other than the one on screen
- **THEN** every row names its own contract, shortened to its base asset with the whole name on the cell, rather than losing the column to its neighbours

#### Scenario: Another contract uses its own tick
- **WHEN** an order belongs to another contract whose tick is `0.0000100` while the selected contract's tick is `0.1`
- **THEN** its price is formatted to that order contract's tick rather than the selected contract's tick or a generic float trim

## ADDED Requirements

### Requirement: A working order's filled portion is stated in USDT
The working-orders table SHALL state the filled portion as a USDT value under a header naming USDT, using the same order-price selection rules as the order's stated size. The exact executed contract quantity SHALL remain available as secondary detail. A zero filled quantity SHALL be presented as zero USDT rather than as an absent reading.

#### Scenario: A limit order is partly filled
- **WHEN** a working limit order at `100` has executed `2` contracts
- **THEN** its Filled column states `200` USDT and its secondary detail states exactly `2 contracts`

#### Scenario: A market-triggered stop is partly filled
- **WHEN** a working stop has no positive limit price, a trigger of `58000` and an executed quantity of `0.1` contracts
- **THEN** its Filled column states `5800` USDT from the trigger and retains `0.1 contracts` as secondary detail

### Requirement: A market-triggered stop has a chart price
A working order drawn on the chart SHALL use its positive limit price where it has one and otherwise SHALL use its positive trigger price. A regular or algorithmic market-triggered stop whose ordinary price is zero SHALL therefore remain visible at its trigger. This presentation rule SHALL NOT change submission, execution, editing, dragging or cancellation semantics.

#### Scenario: A stop-market reports price zero
- **WHEN** a working stop-market order reports ordinary price `0` and trigger price `58000`
- **THEN** the chart draws the order at `58000`, keeps the original order data unchanged, and keeps all execution and cancellation actions governed by their existing rules

#### Scenario: A stop-limit reports both prices
- **WHEN** a working stop-limit reports a positive limit price and a different trigger price
- **THEN** the chart draws its working order line at the limit price and keeps the trigger as activation information
