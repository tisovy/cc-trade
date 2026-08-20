## MODIFIED Requirements

### Requirement: Values no stream carries are read, not computed
The liquidation price, the margin a position commits, the free margin an order
may be sized against, and the money a position has already settled are not
carried by any authenticated stream. The system SHALL show, and SHALL size an
order against, only what the exchange answered — never a value it derived
itself. It SHALL read them from the exchange, and SHALL do so only when a fold
moved something they depend on: a position whose size, entry, margin mode or
isolated wallet changed, or a wallet balance that moved. Such a read SHALL name
only the resources whose unstated values moved, and SHALL issue nothing when none
did.

Settled money is unstated in a way of its own: `ACCOUNT_UPDATE` reports a funding
charge as a wallet movement and names no contract for it, so a fold can tell that
funding was charged but not against which position. It SHALL therefore be read
from the exchange's income history. That read SHALL be account-wide rather than
per contract and SHALL ask for every kind of flow in one request rather than one
request per kind — the endpoint answers without a symbol and, given no income
type, returns them all — so one read covers every open position and every
component for the weight a single contract would otherwise cost. It SHALL be
issued when a fold reports a realizing fill or a funding cause, when the private
stream connects, and when the operator asks for the account — and not on a timer.
The stream case is not redundant with the first two: a desk coming up on an
account that already holds positions has a history behind them that no fold will
report, and a settled column that stays empty until the operator happens to trade
reads as broken rather than as unread.

This read SHALL NOT be served from the contract-discovery walk's cache. That walk
answers which contracts the account has traded, which changes when a trade is
made; settled money changes on every fill and every funding boundary, and a
figure held behind a discovery hold would be correct once and stale afterwards.

The system MAY compute the same values for comparison, and SHALL keep any value
so computed out of everything the operator sees or trades against. A computed
value SHALL reach the desk's record and nothing else.

Placing, amending or cancelling an order changes the free margin and is reported
by no stream, so it SHALL cause the balances alone to be read.

These reads SHALL be coalesced, so that a burst of stream frames costs one pass
rather than one per frame, and the held reading SHALL remain usable while such a
read is in flight.

#### Scenario: A position's size changes
- **WHEN** a fold changes a held position's size
- **THEN** the positions and balances are read back for the liquidation price, the margins and the free margin

#### Scenario: Only the wallet moved
- **WHEN** a fold changes the wallet balance and no position
- **THEN** the balances are read back and the positions are not

#### Scenario: Nothing unstated moved
- **WHEN** a fold changes nothing the held account did not already say
- **THEN** no read is issued

#### Scenario: A burst of frames arrives
- **WHEN** several `ACCOUNT_UPDATE` frames are folded within the coalescing window
- **THEN** one read is issued covering everything they moved, not one per frame

#### Scenario: An order is placed
- **WHEN** an order is placed, amended or cancelled
- **THEN** the balances are read back so the free margin reflects the margin it locked or released, and the positions and order lists are not read for it

#### Scenario: A position opens before its liquidation price is known
- **WHEN** a position is folded onto a contract the desk holds no read for
- **THEN** the row is shown without a liquidation price rather than with one the desk computed, and the price appears when the read answers

#### Scenario: The desk's own answer disagrees with the exchange's
- **WHEN** the value the desk computed differs from the one the read answered
- **THEN** the exchange's value is what is shown and what an order is sized against, and the difference is recorded

#### Scenario: Funding is charged while several positions are open
- **WHEN** a fold reports a wallet movement caused by funding while three contracts carry open positions
- **THEN** one account-wide income read is issued, and the charge is attributed to the contract the exchange named on the income row rather than to the position the desk guessed

#### Scenario: A fill realizes PnL
- **WHEN** a fold reports a fill that realized profit or loss
- **THEN** the income history is read back so the position's settled money reflects it

#### Scenario: The desk comes up on an account that already holds positions
- **WHEN** the private stream connects and the account holds positions opened before this session
- **THEN** the income history is read once, so their settled money is stated rather than left absent until the operator trades

#### Scenario: The operator asks for the account
- **WHEN** the operator requests an account refresh
- **THEN** the income history is read with it
