# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: A position row states which price it is read at, and what the exchange holds it at

Every surface that states an open position's unrealized PnL SHALL make both
figures available on the element that carries the reading: the figure at the
price the row is read at, and the exchange's own figure on its mark.

The reading SHALL be the headline. The mark's figure SHALL be stated under a
name of its own — never as a second unlabelled number, never merged into the
headline, and never with the same visual weight. On a surface with room for a
line of its own it SHALL be drawn quieter than the headline in size, emphasis
and colour, and SHALL be omitted while the row is already read at the mark,
because there is then nothing to state twice.

Where a surface names a price, it SHALL name which price it is. A column or row
labelled as the mark SHALL show the mark.

A live close estimate SHALL be computed at the price the position is read at
rather than at the mark: an exit fills near what the contract is printing.

#### Scenario: The contract prints between two marks

- **WHEN** an open position's contract trades after its latest mark
- **THEN** the row's headline PnL, its return on margin and the dock total move to the printed price, and the mark's own figure remains stated beside them

#### Scenario: A position is open on a contract that is not on screen

- **WHEN** the operator is watching one contract while holding positions in others
- **THEN** every open position is read on its own contract's prices, at the same freshness, whether or not it is the one being watched

#### Scenario: The row is already read at the mark

- **WHEN** a contract has not printed recently enough for its trade to be the newer price
- **THEN** the row is read at the mark and states no separate mark figure beside it

#### Scenario: The mark moves under a contract that is still trading

- **WHEN** a new mark arrives while the row is read at a recent print
- **THEN** the headline is unchanged, and the mark's stated figure, the position's notional and its margin are recomputed
