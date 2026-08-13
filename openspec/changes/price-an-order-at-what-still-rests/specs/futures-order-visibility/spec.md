## MODIFIED Requirements

### Requirement: A working order's size is stated in USDT
The working-orders list SHALL state an order's size as the USDT amount it
commits, under a header that names the unit, using the same derivation as every
other surface that sizes an order — the ticket, the order editor and the chart
label — so one order reads as one number wherever it appears. The exact contract
quantity SHALL remain available on the cell without occupying the column. An
order whose size is carried against a trigger price SHALL be valued at that
trigger price, because a stop-market carries a `price` of `0`.

The size an order is valued at SHALL be what is still working: the quantity it
was placed at, less the quantity that has traded. A partly filled order commits
its remainder, and the filled part is already reported as the position it
formed — valuing the order at the size it was placed at states that part twice.
The traded quantity SHALL be read whether the source names it as a stream report
does or as an account snapshot does, and the exact contract count offered beside
the value SHALL state the same working quantity rather than the original one.

What has traded SHALL remain separately readable. Stating what is still working
answers a different question from stating what has filled, and neither SHALL be
derived from the other's absence.

#### Scenario: A limit order is listed
- **WHEN** a working order rests at `58445.00` for `0.004` contracts
- **THEN** the size cell reads `234` under a `Size (USDT)` header, and its title states `0.004 contracts`

#### Scenario: An algo order is listed
- **WHEN** a stop order carries `price` `0`, a trigger price of `57000.00` and `0.01` contracts
- **THEN** the size cell reads `570` rather than a zero

#### Scenario: The same order is read on two surfaces
- **WHEN** the operator compares a working order's size in the list against the same order on the chart or in the editor
- **THEN** both state the same USDT amount

#### Scenario: An order is partly filled
- **WHEN** an order placed for `10` contracts at `100` has `5` contracts filled and is still working
- **THEN** every surface values it at `500` rather than at `1000`, and the exact count offered beside that value states the working `5` contracts

#### Scenario: The filled part is asked for on its own
- **WHEN** the operator reads how much of a working order has traded
- **THEN** that quantity is stated in its own right, unchanged by the order being valued at its remainder
