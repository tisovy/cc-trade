## ADDED Requirements

### Requirement: An order is valued at the price it rests at
An order's stated price and value SHALL be taken from the price it is actually
working at. For a stop or take-profit that is the trigger, which the exchange
reports separately and alongside a `price` of zero for the market-triggered
kinds; the normalized order SHALL carry that trigger for regular orders as it
already does for algorithmic ones, and SHALL omit the field where the exchange
reports no trigger rather than carrying a zero that would be read as a price.

An order SHALL NOT be valued at zero because a field it needs is missing. An
order with no usable price or no usable size SHALL be reported as unvaluable, so
that a row which could not be read is distinguishable from an order that commits
nothing.

#### Scenario: A stop rests in the list
- **WHEN** the exchange reports a resting stop with `price` `0` and a trigger of `58000` for `0.5` contracts
- **THEN** the order is shown at `58000` and valued at `29000` USDT, in the list and in any total of the working orders

#### Scenario: A limit order has no trigger
- **WHEN** the exchange reports a plain limit order
- **THEN** the normalized order carries no trigger price at all, and is shown and valued at its limit price

#### Scenario: An order cannot be valued
- **WHEN** an order carries no usable price, or a close-position stop carries no quantity of its own
- **THEN** it is reported as unvaluable and shown as absent, not as an order worth zero, and it is left out of the working-orders total rather than adding zero to it
