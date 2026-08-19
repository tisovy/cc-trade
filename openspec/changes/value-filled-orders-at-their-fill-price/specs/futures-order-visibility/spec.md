## MODIFIED Requirements

### Requirement: A working order's filled portion is stated in USDT
The working-orders table SHALL state the filled portion as a USDT value under a header naming USDT. The filled portion SHALL be valued at the exchange's stated average fill price when the payload carries a positive one, because that is the price the fill actually happened at; only when no positive average fill price is stated SHALL the value fall back to the same order-price selection rules as the order's stated size. The exact executed contract quantity SHALL remain available as secondary detail. A zero filled quantity SHALL be presented as zero USDT rather than as an absent reading.

#### Scenario: A stop-limit fills through a gap
- **WHEN** a working stop-limit resting at `58000` has executed `0.1` contracts at an average fill price of `58120`
- **THEN** its Filled column states `5812` USDT — the executed quantity at the average fill price — not `5800` from the price the order rested at

#### Scenario: Nothing has filled yet
- **WHEN** a working limit order at `100` for `10` contracts reports an executed quantity of `0` and the exchange's average fill price of `0`
- **THEN** its Filled column falls back to the resting price and states zero USDT, rather than reading as absent

#### Scenario: A limit order is partly filled
- **WHEN** a working limit order at `100` has executed `2` contracts at an average fill price of `99.5`
- **THEN** its Filled column states `199` USDT and its secondary detail states exactly `2 contracts`

#### Scenario: A market-triggered stop is partly filled without a stated average
- **WHEN** a working stop has no positive limit price, a trigger of `58000`, an executed quantity of `0.1` contracts and no stated average fill price
- **THEN** its Filled column states `5800` USDT from the trigger and retains `0.1 contracts` as secondary detail
