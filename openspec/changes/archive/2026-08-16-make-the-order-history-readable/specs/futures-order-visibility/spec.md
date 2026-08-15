## REMOVED Requirements

### Requirement: A history row is stamped for when it happened
**Reason**: The requirement made the row's own format carry the day — time of day
for today, date for anything older — which is exactly what makes two rows in one
undivided list read on different scales. `20:42:12` and `09.08` sit one above the
other with nothing saying they are different kinds of stamp, and no reader can
tell whether the row above happened before or after the row below.

**Migration**: Replaced by *A history row's day is a heading, not a format*
below. The whole stamp stays on the element, and a closed position is still
stamped by when it closed with its whole span on the element — only the
day-versus-time switch is withdrawn, in favour of a heading that states the day
once for every row beneath it.

## MODIFIED Requirements

### Requirement: A price the order does not have is reported as absent
Where the exchange reports no price for an order — a market order has no limit
price, an order that has not filled has no average price — the desk SHALL show
that as absent rather than as a zero rendered through the contract's tick.

The order review SHALL state the order's price and the average it achieved as one
reading rather than as two columns. Where the two differ, the achieved average
SHALL be what is shown, marked as an average rather than as the price the order
names, and both readings SHALL be stated on the element.

#### Scenario: A filled market order is listed
- **WHEN** order history lists a market order
- **THEN** its price cell reads as the average it actually got, marked as an average, and the element states that the order named no price

#### Scenario: A working order has not filled
- **WHEN** order history lists an order with nothing executed
- **THEN** its price cell shows the limit price the order names, and no average is claimed

#### Scenario: An order filled away from its own price
- **WHEN** an order's average fill price differs from the price it was placed at
- **THEN** the cell shows the average, marked as one, and both prices are stated on the element

## ADDED Requirements

### Requirement: A history row's day is a heading, not a format
A history row SHALL show its time of day, and the day it belongs to SHALL be
stated by the heading it is grouped under rather than by switching the row's own
format. Rows SHALL be grouped under a heading naming their day, so two rows from
different days are never read as two moments of the same day. The whole stamp
SHALL remain available on the element. A closed position SHALL be stamped by when
it closed and grouped under the day it closed on, and the whole span from opening
to closing SHALL remain available on the element.

#### Scenario: The review spans more than one day
- **WHEN** a history table contains rows from today and from an earlier day
- **THEN** each row is under a heading naming its day, and every row shows its time of day

#### Scenario: A row is read for its exact moment
- **WHEN** a history row is displayed
- **THEN** the full stamp is on the element

#### Scenario: A closed position is listed
- **WHEN** the closed-position history lists a round trip
- **THEN** the stamp is when it closed, the row is grouped under that day, and the element carries the whole span it ran for

### Requirement: An order review states what became of each order
Every row of the order review SHALL state the order's outcome as its leading
reading, and that outcome SHALL be readable at every width the workspace
supports. An order that is still working, one that filled, one that filled in
part and one the exchange ended without a fill SHALL each be distinguishable by
the outcome alone rather than by inference from a quantity pair. Where the
outcome generalizes a status the exchange reported, the exchange's own word SHALL
be on the element.

#### Scenario: An order filled in part
- **WHEN** an order executed part of its quantity
- **THEN** the row states that it filled in part and by what proportion

#### Scenario: An order ended without filling
- **WHEN** the review contains an order the exchange expired or rejected with nothing executed
- **THEN** the row states that outcome, without the reader having to compare an executed quantity against an original one

#### Scenario: The panel is at its narrowest supported width
- **WHEN** the order review is rendered at the narrowest width the workspace supports
- **THEN** the outcome of every row is readable without an ellipsis

#### Scenario: The exchange reported a status the chip generalizes
- **WHEN** the exchange reported a status the review states in its own words
- **THEN** the exchange's own word is on the element

### Requirement: An abbreviation on a review row is labelled
A marker on a review row that abbreviates an order property SHALL carry its
meaning in words for a reader who does not know the abbreviation. A reduce-only
order SHALL be marked for what it does — that it can only close a position —
rather than by an unexplained pair of letters.

#### Scenario: A reduce-only order is listed
- **WHEN** the review contains a reduce-only order
- **THEN** the row marks it as an exit and states `reduce-only` in words on the element

### Requirement: An order that did nothing is quieter than one that did
Among the rows the review presents, those whose orders executed nothing SHALL be
presented less prominently than those whose orders executed, so a review of many
dead orders does not obscure the fills within it. This SHALL be a matter of
prominence only: presentation SHALL NOT remove a row the review is presenting.

#### Scenario: The review is mostly orders that did nothing
- **WHEN** the review contains many orders that executed nothing and a few that filled
- **THEN** the filled ones are the more prominent, and the others are still present and readable

### Requirement: A review can be narrowed without reading the exchange again
The order review SHALL offer narrowing by outcome — all, filled, unfilled — and
to the contract on screen. Narrowing SHALL act on the reading already held and
SHALL issue no exchange read, and the statement of what the underlying read
covered SHALL continue to describe the read rather than the narrowed view.

#### Scenario: The operator narrows to filled orders
- **WHEN** the operator narrows the review to filled orders
- **THEN** only orders that executed are listed, no exchange read is issued, and the scope statement still describes what was read

#### Scenario: The operator narrows to the contract on screen
- **WHEN** the operator narrows the review to the contract on screen
- **THEN** only that contract's rows are listed and no exchange read is issued
