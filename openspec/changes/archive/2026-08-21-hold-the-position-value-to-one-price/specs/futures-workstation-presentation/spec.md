## MODIFIED Requirements

### Requirement: Position rows are valued at the live mark price
Between account snapshots, position rows SHALL be re-valued from the live mark
price feed: mark price, USDT size, unrealized PnL and return on margin SHALL
all follow the incoming mark, and the dock total SHALL be the sum of the
re-valued rows. Unrealized PnL SHALL be derived as
`(valuation price − entry price) × signed quantity`, where the valuation price
is the confirmed mark, or — between two marks — that mark carried forward by the
change in the contract's traded price since it was taken. A position whose entry
price, quantity or mark is unusable SHALL be left exactly as the account snapshot
reported it, rather than partially re-valued.

The mark column SHALL state the confirmed mark, not the carried-forward
valuation: it names the price the exchange settles and liquidates on, and a
column that quietly showed an extrapolation would make the row's own arithmetic
unreproducible.

#### Scenario: The market moves with no account event
- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140`
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change, and the dock total changes with them

#### Scenario: The mark feed is not connected
- **WHEN** the feed reports no mark for a symbol
- **THEN** the row shows the mark and unrealized PnL from the account snapshot, and no aged mark is presented as a live one

#### Scenario: A mark arrives for a symbol with no open position
- **WHEN** a mark arrives for a symbol that is not in the position list
- **THEN** no row is created or changed

#### Scenario: The row is valued between two marks
- **WHEN** the tape has moved since the last mark was taken
- **THEN** the unrealized PnL follows the tape while the mark column still states the last confirmed mark
