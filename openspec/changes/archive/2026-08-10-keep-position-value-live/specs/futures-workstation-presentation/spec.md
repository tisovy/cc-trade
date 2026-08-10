## ADDED Requirements

### Requirement: Position size is stated as an unsigned USDT amount
The positions dock SHALL state the size of a position as the USDT amount it is
worth at the current mark price, without a direction sign, under a header that
names the unit. Direction SHALL be carried by the side badge and the row accent
that already state it. The exact contract quantity SHALL remain available on
the cell without occupying the column.

#### Scenario: A short is displayed
- **WHEN** a position of `-0.5` contracts is marked at `60600`
- **THEN** the size cell reads `30300.00` with no leading sign, and the row still states `SHORT`

#### Scenario: Contract quantity is still needed
- **WHEN** the operator inspects the size cell of a position of `-0.5` contracts
- **THEN** the cell's title states `-0.5 contracts`

### Requirement: Row controls are rendered as part of their row
Every interactive cell in the positions dock SHALL carry an explicit style that
matches the row's own typography, colour and alignment, and SHALL express its
affordance through hover and keyboard focus rather than through a
browser-default control face. A cell SHALL NOT change its appearance merely
because its row is the selected contract.

#### Scenario: The selected contract's size cell is interactive
- **WHEN** the row of the selected contract offers the size shortcut
- **THEN** the cell reads as the same text as any other size cell, and reveals its affordance on hover and on keyboard focus

#### Scenario: A position on another contract
- **WHEN** the row belongs to a contract that is not selected
- **THEN** no size shortcut is offered and the cell reads identically to the selected row's cell

### Requirement: Position rows are valued at the live mark price
Between account snapshots, position rows SHALL be re-valued from the live mark
price feed: mark price, USDT size, unrealized PnL and return on margin SHALL
all follow the incoming mark, and the dock total SHALL be the sum of the
re-valued rows. Unrealized PnL SHALL be derived as
`(mark price − entry price) × signed quantity`. A position whose entry price,
quantity or mark is unusable SHALL be left exactly as the account snapshot
reported it, rather than partially re-valued.

#### Scenario: The market moves with no account event
- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140`
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change, and the dock total changes with them

#### Scenario: The mark feed is not connected
- **WHEN** the feed reports no mark for a symbol
- **THEN** the row shows the mark and unrealized PnL from the account snapshot, and no aged mark is presented as a live one

#### Scenario: A mark arrives for a symbol with no open position
- **WHEN** a mark arrives for a symbol that is not in the position list
- **THEN** no row is created or changed
