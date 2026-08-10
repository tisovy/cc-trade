## ADDED Requirements

### Requirement: A working order's size is stated in USDT
The working-orders list SHALL state an order's size as the USDT amount it
commits, under a header that names the unit, using the same derivation as every
other surface that sizes an order — the ticket, the order editor and the chart
label — so one order reads as one number wherever it appears. The exact contract
quantity SHALL remain available on the cell without occupying the column. An
order whose size is carried against a trigger price SHALL be valued at that
trigger price, because a stop-market carries a `price` of `0`.

#### Scenario: A limit order is listed
- **WHEN** a working order rests at `58445.00` for `0.004` contracts
- **THEN** the size cell reads `234` under a `Size (USDT)` header, and its title states `0.004 contracts`

#### Scenario: An algo order is listed
- **WHEN** a stop order carries `price` `0`, a trigger price of `57000.00` and `0.01` contracts
- **THEN** the size cell reads `570` rather than a zero

#### Scenario: The same order is read on two surfaces
- **WHEN** the operator compares a working order's size in the list against the same order on the chart or in the editor
- **THEN** both state the same USDT amount
