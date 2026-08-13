## ADDED Requirements

### Requirement: An algorithmic order that has fired does not read as resting
An algorithmic order that is finished by the regular order it spawned SHALL,
once it reports one, be presented as triggered and awaiting confirmation, not as
an order resting at its trigger price. Every surface that draws working orders —
the chart marker, the working-orders list and the portfolio dock — SHALL state it
the same way, and SHALL withhold the controls that apply only to a working order,
because a marker drawn at a price the market has left invites the operator to
move or cancel something the exchange has already acted on.

An algorithmic order that outlives the order it spawned — a scheduled algorithm
that fills one child and places the next, naming the current one in the same
field — SHALL NOT be read this way. It is still working, and reading a child's
settlement as the parent's own would take a running algorithm off the desk. The
kinds that are finished by their spawned order SHALL be named explicitly, and a
kind the desk has not been shown SHALL read as still working.

A control the exchange still accepts on a triggered parent SHALL remain
available, and one it does not SHALL be stated rather than silently absent.

#### Scenario: A stop fires
- **WHEN** a conditional algorithmic order reports a spawned regular order
- **THEN** it reads as triggered and awaiting confirmation on every surface that draws it, rather than as a working order at its trigger price

#### Scenario: The operator reaches for a triggered parent
- **WHEN** the operator opens the controls on an algorithmic order that has fired
- **THEN** repricing and resizing are not offered, and whether the exchange will still cancel it is stated

#### Scenario: The order has not fired
- **WHEN** an algorithmic order reports no spawned order
- **THEN** it reads as working at its trigger price, exactly as it does today

#### Scenario: A scheduled algorithm names its current child
- **WHEN** an algorithmic order that outlives the orders it spawns names one of them
- **THEN** it reads as working, and the settlement of that child neither removes it from the desk nor keeps it from being listed again

#### Scenario: The exchange reports a kind the desk has not been shown
- **WHEN** an algorithmic order names a spawned order under a kind the desk does not recognize
- **THEN** it reads as working, as it did before spawned orders were carried at all

## MODIFIED Requirements

### Requirement: The account order model includes regular and algorithmic orders
The system SHALL synchronize both regular open orders and currently open algorithmic orders from the authenticated USDⓈ-M account. Each normalized order SHALL retain its source kind, exchange identity, symbol, side, type, status, quantity, prices relevant to that type, reduce-only or close-position intent when supplied, and exchange update time.

An algorithmic order SHALL additionally retain the identity and price of the
regular order it spawned, when the exchange reports them. The exchange reports an
order that has not fired with an empty value, and that value SHALL be retained as
the exchange states it rather than coerced into a null or a zero — the difference
between "has not fired" and "fired at nothing" is the difference between an order
the operator can still move and one they cannot.

#### Scenario: Account has regular and algorithmic orders for TUTUSDT
- **WHEN** Binance returns one regular order and one algorithmic order for `TUTUSDT`
- **THEN** both orders are present in the normalized account order state with distinct source kinds and identities

#### Scenario: The same numeric identifier occurs in two namespaces
- **WHEN** a regular order and an algorithmic order share the same numeric identifier
- **THEN** they remain distinct because order identity includes the source kind

#### Scenario: One order endpoint fails
- **WHEN** either the regular-order or algorithmic-order request fails while the other succeeds
- **THEN** the successful source is updated, the failed source retains its last confirmed snapshot if any, and the UI reports partial synchronization rather than claiming the combined order list is complete

#### Scenario: An algorithmic order has fired
- **WHEN** Binance reports an algorithmic order carrying the identity and price of the regular order it spawned
- **THEN** both are retained on the normalized order, so the spawned order can be recognized when the stream reports it

#### Scenario: An algorithmic order has not fired
- **WHEN** Binance reports an algorithmic order whose spawned-order identity is the documented empty value
- **THEN** that value is retained as reported, and the order is not read as having fired

### Requirement: Orders the stream does not report are read on their own beat
Order kinds the authenticated stream does not report — the algorithmic orders
the desk lists and cancels but cannot place — SHALL be read on the periodic
reconciliation and on an operator-requested refresh, and SHALL NOT be read in
response to an execution report or a position change.

The one exception SHALL be an execution report whose order identity is one a
listed algorithmic order reports having spawned. That parent SHALL be resolved
from the report rather than left on screen until the beat comes round, and it
MAY be read once for that match alone. The read SHALL be deduplicated and SHALL
remain inside the read budget, so a burst of fills against one parent is one
read. An execution report matching no listed parent SHALL still read nothing.

#### Scenario: A fill arrives while an algorithmic order rests
- **WHEN** an execution report arrives for a regular order and an algorithmic order is listed
- **THEN** no algorithmic-order read is issued, and the listed algorithmic order stays as last read

#### Scenario: The operator asks for a refresh
- **WHEN** the operator requests an account refresh
- **THEN** the algorithmic orders are read again alongside the regular ones

#### Scenario: A fill arrives on an order a listed parent spawned
- **WHEN** an execution report carries the identity a listed algorithmic order reports having spawned
- **THEN** that parent is resolved from the report, and at most one algorithmic-order read is issued for the match

#### Scenario: A burst of fills lands on one spawned order
- **WHEN** several execution reports arrive for the same spawned order
- **THEN** they resolve the same parent and produce one read, not one per report
