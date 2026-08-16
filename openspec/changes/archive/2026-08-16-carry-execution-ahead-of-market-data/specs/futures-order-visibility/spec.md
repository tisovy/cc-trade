## ADDED Requirements

### Requirement: An execution is applied without waiting for market data
An execution report SHALL reach the surfaces that show working orders and
positions without waiting for market data the desk delivered before it. The cost
of reading quotes SHALL NOT be charged to the path that applies a fill: the
handler that applies account events SHALL NOT be given market-data frames, and
SHALL NOT do work to discard them.

The delay from an execution report arriving at the desk to the working-orders
list and the chart reflecting it SHALL be measurable, and SHALL be measured with
a market-data backlog present as well as without one — a fill matters most during
the burst that produces the backlog.

#### Scenario: A fill arrives during a burst
- **WHEN** an order fills while depth frames are arriving at the exchange's full cadence
- **THEN** the filled order leaves the working-orders list and the chart at the same point it would in a quiet market

#### Scenario: The account handler receives a depth frame
- **WHEN** the desk delivers a book to the renderer
- **THEN** the handler that applies execution reports is not given it and does no work on it

#### Scenario: The delay is measured
- **WHEN** the desk is exercised with and without a market-data backlog
- **THEN** the delay from execution report to applied state is recorded for both, rather than being inferred from the absence of complaints
