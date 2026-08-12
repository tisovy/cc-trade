## ADDED Requirements

### Requirement: Market data state does not disarm order entry
Chart price picking, chart trading gestures and order-book level selection SHALL
remain available while the market data is stale, quiet, disconnected or
resynchronizing. They SHALL be unavailable only where the surface has never
received data and therefore has no price to act on. Lifting an order off the
chart SHALL NOT depend on the market data state at all, because the order being
lifted is the desk's own.

#### Scenario: The workspace is resynchronizing
- **WHEN** the market data resynchronizes while the operator holds a position
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: The contract is quiet
- **WHEN** the selected contract records no trade for longer than the freshness window
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: Nothing has ever been received
- **WHEN** a contract's chart has received no candle at all
- **THEN** picking a price from it is unavailable, because there is no price on it

#### Scenario: The book was delivered empty
- **WHEN** the order book carries no level on either side
- **THEN** there is no level to pick, and picking one is unavailable

### Requirement: A price taken from a non-live reading states its age
A price picked from a surface that is not live SHALL be presented with the age
of the reading it came from, on the ticket and on the confirmation panel, so the
operator confirms a price whose age they can see. The age SHALL be counted from
the time the reading was observed to the moment it is read, so a panel left open
states a growing age rather than the age it was staged at. A price the operator
typed carries no reading and SHALL state no age.

#### Scenario: A gesture is made on a stale chart
- **WHEN** the operator opens an order from a chart whose data is stale
- **THEN** the confirmation states how old the price it carries is

#### Scenario: The confirmation is left open
- **WHEN** a confirmation carrying a non-live price stays open
- **THEN** the age it states grows with the time the reading has been held

#### Scenario: The operator typed the price
- **WHEN** the price on the ticket was typed rather than picked off a surface
- **THEN** no reading age is stated for it

### Requirement: A silent stream on a live transport is named quiet
A market-data resource that has stopped updating while its transport is still
proven live SHALL be presented as quiet rather than stale. A resource whose
transport is not proven live SHALL keep the state the transport gave it.

#### Scenario: A contract with no trades
- **WHEN** the connection is live and the selected contract's candles stop arriving
- **THEN** the chart is marked quiet and states how long ago its last candle arrived

#### Scenario: The connection is gone
- **WHEN** the workspace is disconnected
- **THEN** the chart is not called quiet

### Requirement: A non-live reading is stated beside the chart, not over it
A chart that carries candles SHALL remain readable whatever its state: the state
and the age of its last reading SHALL be stated beside the chart rather than
drawn across it. The chart SHALL be covered only where it carries no candle at
all and therefore has nothing to read.

#### Scenario: The chart is quiet or stale but drawn
- **WHEN** the chart's data is not live and candles are on screen
- **THEN** the candles stay legible and the state and age are stated in a corner notice

#### Scenario: The chart has nothing on it
- **WHEN** the chart carries no candle
- **THEN** the chart is covered by a notice that states there is nothing to read
