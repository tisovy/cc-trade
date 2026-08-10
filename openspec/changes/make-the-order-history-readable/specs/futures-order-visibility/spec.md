## ADDED Requirements

### Requirement: An order review states what became of each order
Every row of the order review SHALL state the order's outcome, and that outcome
SHALL be readable without horizontal scrolling at every width the workspace
supports. An order that was cancelled or expired without a fill SHALL be
distinguishable from one that is still working and from one that filled, by the
outcome alone rather than by inference from a quantity pair.

#### Scenario: An order was cancelled without filling
- **WHEN** the review contains an order that was cancelled with nothing executed
- **THEN** the row states that it was cancelled, without the reader having to compare an executed quantity against an original one

#### Scenario: The panel is at its narrowest supported width
- **WHEN** the order review is rendered at the narrowest width the workspace supports
- **THEN** the outcome of every row is within the visible area

#### Scenario: An order filled in part
- **WHEN** an order executed part of its quantity
- **THEN** the row states that it filled in part and by what proportion

### Requirement: A review row is sized in the desk's own unit
An order review row SHALL state its size in USDT, as every other size on this
desk does, and SHALL carry the exact contract quantities — executed and original
— where an exact reading is available without taking column width.

#### Scenario: A row is read for its size
- **WHEN** an order review row is displayed
- **THEN** its size is stated in USDT and its exact contract quantities are available on the row

#### Scenario: The quantities are long
- **WHEN** the executed and original quantities are long enough to overflow their track
- **THEN** the displayed reading remains complete, because the exact quantities are not what the track carries

### Requirement: A timestamp is unambiguous about its day
A review that shows times of day SHALL make the day of each row explicit,
grouping rows under the day they belong to, so that two rows from different days
are never read as two moments of the same day.

#### Scenario: The review spans more than one day
- **WHEN** the review contains rows from today and from an earlier day
- **THEN** each row is under a heading naming its day, and the row itself shows the time of day

### Requirement: An order that did nothing is quieter than one that did
Rows whose orders executed nothing SHALL be presented less prominently than rows
whose orders executed, so a review of many cancellations does not obscure the
fills within it. Presentation SHALL NOT remove or hide such rows.

#### Scenario: The review is mostly cancellations
- **WHEN** the review contains many cancelled orders and a few filled ones
- **THEN** the filled ones are the more prominent, and the cancelled ones are still present and readable

### Requirement: An abbreviation on a review row is labelled
A marker on a review row that abbreviates an order property SHALL carry its
meaning in words for a reader who does not know the abbreviation.

#### Scenario: A reduce-only order is listed
- **WHEN** the review contains a reduce-only order
- **THEN** the row marks it as reduce-only in words rather than by an unexplained abbreviation

### Requirement: A review can be narrowed without reading the exchange again
The order review SHALL offer narrowing by outcome and to the contract on screen.
Narrowing SHALL act on the reading already held and SHALL issue no exchange
read, and the statement of what the underlying read covered SHALL continue to
describe the read rather than the narrowed view.

#### Scenario: The operator narrows to filled orders
- **WHEN** the operator narrows the review to filled orders
- **THEN** only filled orders are listed, no exchange read is issued, and the scope statement still describes what was read
