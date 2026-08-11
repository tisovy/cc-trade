## ADDED Requirements

### Requirement: A public read waits for its budget rather than failing
Public market reads SHALL be paced by a local weight window. A read the window
has no room for SHALL be delayed until the window frees the weight it needs and
then issued, rather than refused. A read SHALL be refused for want of weight
only when no room appears within one window; that refusal SHALL name itself, and
SHALL NOT be reported as a market-data failure of the exchange.

#### Scenario: The window is full when a contract is selected
- **WHEN** the operator selects a contract while the window holds no room for the reads that contract needs
- **THEN** each read is issued as soon as the window frees the weight it needs, and the workspace reaches `live` without resynchronizing

#### Scenario: The operator moves on while a read is waiting
- **WHEN** a read is waiting for room and the selection it belongs to is abandoned
- **THEN** that read is dropped without being issued, and it holds no room in the window

#### Scenario: No room appears within a window
- **WHEN** a read would have to wait longer than one whole window for its weight
- **THEN** it is refused, and the refusal states that the local read budget, not the exchange, is what refused it

### Requirement: The read budget admits the work a session actually does
The local weight ceiling SHALL be stated against what the desk's own operations
cost, and SHALL admit a session's ordinary work — repeated contract switches and
the book recoveries a thin contract needs — within one window. The ceiling and
the account reader's ceiling together SHALL stay below the allowance the
exchange gives one address.

#### Scenario: The operator browses contracts
- **WHEN** the operator selects twenty contracts inside one window
- **THEN** every selection's reads are admitted, none of them waits, and none is refused

#### Scenario: The desk's ceilings against the exchange's
- **WHEN** the public-read ceiling and the account reader's ceiling are both at their maximum in one window
- **THEN** their sum is below the weight the exchange allows one address in that window
