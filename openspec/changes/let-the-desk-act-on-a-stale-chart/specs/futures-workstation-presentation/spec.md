## ADDED Requirements

### Requirement: Market data state does not disarm order entry
Chart price picking, chart trading gestures and order-book level selection SHALL
remain available while the market data is stale, disconnected or
resynchronizing. They SHALL be unavailable only where the surface has never
received data and therefore has no price to act on.

#### Scenario: The workspace is resynchronizing
- **WHEN** the market data resynchronizes while the operator holds a position
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: Nothing has ever been received
- **WHEN** a contract's chart has received no candle at all
- **THEN** picking a price from it is unavailable, because there is no price on it

### Requirement: A price taken from a non-live reading states its age
A price picked from a surface that is not live SHALL be presented with the age
of the reading it came from, on the ticket and on the confirmation panel, so the
operator confirms a price whose age they can see.

#### Scenario: A gesture is made on a stale chart
- **WHEN** the operator opens an order from a chart whose data is stale
- **THEN** the confirmation states how old the price it carries is
