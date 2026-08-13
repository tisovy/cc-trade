## MODIFIED Requirements

### Requirement: Values no stream carries are read, not computed
The liquidation price, the margin a position commits and the free margin an
order may be sized against are not carried by any authenticated stream. The
system SHALL show, and SHALL size an order against, only what the exchange
answered — never a value it derived itself. It SHALL read them from the
exchange, and SHALL do so only when a fold moved something they depend on: a
position whose size, entry, margin mode or isolated wallet changed, or a wallet
balance that moved. Such a read SHALL name only the resources whose unstated
values moved, and SHALL issue nothing when none did.

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

## ADDED Requirements

### Requirement: The desk computes the values no stream carries
The system SHALL compute, from what it already holds, the values no stream
carries: each held position's notional, initial margin, maintenance margin and
liquidation price, and the account's free margin. While a read of the same
values is available, what it computes SHALL be used for comparison only and
SHALL reach the record and nothing else. It SHALL compute them from the
contract's maintenance-margin brackets, the contract's leverage and margin mode,
the mark price, the folded position and wallet, and the resting orders — without
issuing a read of its own for the purpose.

Where a bracket, a mark price, a leverage or a margin mode is missing, the system
SHALL state that it could not compute the value rather than substitute a default,
a zero or a value from a different contract.

The maintenance-margin brackets SHALL be kept from the answer the desk already
reads for a contract's leverage ceiling, held per contract and forgotten on the
same terms as the contract's other settings.

#### Scenario: A position is held with everything the arithmetic needs
- **WHEN** the desk holds a position, the contract's brackets, its leverage and a mark price
- **THEN** it computes that position's notional, initial margin, maintenance margin and liquidation price

#### Scenario: A contract with no brackets held
- **WHEN** a position is held on a contract whose brackets have not been read
- **THEN** the desk states that it could not compute that position's maintenance margin and liquidation price, and computes nothing in their place

#### Scenario: The brackets come from a read already made
- **WHEN** the desk reads a contract's leverage ceiling
- **THEN** the whole bracket table from that answer is kept, and no further read is issued to obtain it

#### Scenario: A resting order commits margin
- **WHEN** the account has resting orders that are not reduce-only
- **THEN** the computed free margin counts the margin they commit, and counts nothing for a reduce-only order
