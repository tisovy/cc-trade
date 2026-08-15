## ADDED Requirements

### Requirement: A price the order does not have is reported as absent
Where the exchange reports no price for an order — a market order has no limit
price, an order that has not filled has no average price — the desk SHALL show that
as absent rather than as a zero rendered through the contract's tick.

#### Scenario: A filled market order is listed
- **WHEN** order history lists a market order
- **THEN** its price column reads as absent and its average column carries the price it actually got

#### Scenario: A working order has not filled
- **WHEN** order history lists an order with nothing executed
- **THEN** its average column reads as absent and its limit price is shown

### Requirement: A history row is stamped for when it happened
A history row SHALL carry the half of its timestamp that the row is read for: the
time of day for a row from today, the date for a row from any other day. The whole
stamp SHALL remain available on the element.

#### Scenario: The row is from today
- **WHEN** a history row's timestamp falls on the current day
- **THEN** the column shows its time of day, seconds included, and the full stamp is in the title

#### Scenario: The row is older
- **WHEN** a history row is from any earlier day
- **THEN** the column shows its date and the full stamp is in the title

### Requirement: Executions are reported as the positions they formed
The trade history SHALL report round trips rather than fills: a position opens when
exposure is taken and closes when it returns to flat, and each is reported with its
side, the size it closed, the average price it entered and left at, the fees paid
and the realized PnL of the whole round. Realized PnL SHALL be reported as the
exchange reports it, with the fees kept as their own reading and the net stated.

#### Scenario: One close arrives as several fills
- **WHEN** a position is closed by an order that fills in several parts
- **THEN** the tab shows one row for the position, carrying the summed PnL and fees of every fill in it

#### Scenario: The position is still open
- **WHEN** the fills in the window have not returned the position to flat
- **THEN** the row is marked as still open and states no exit price for what has not been closed

#### Scenario: The position was opened before the window
- **WHEN** the oldest fills in the window reduce a position whose opening fills are not in it
- **THEN** the round is reported on the leg that was closed, with no entry price claimed

#### Scenario: A fill flips the position
- **WHEN** a fill reduces more than the position holds and opens the opposite one
- **THEN** it is reported as two rounds, with the realized PnL on the one it closed and the leftover size opening the other
