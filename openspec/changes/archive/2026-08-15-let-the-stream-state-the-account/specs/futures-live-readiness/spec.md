## ADDED Requirements

### Requirement: The account moves with the stream that reports it
The authenticated user-data stream SHALL be the desk's first source for the
wallet and the open positions. An `ACCOUNT_UPDATE` SHALL be folded into the held
balances and positions as it arrives — the wallet balance it states, and per
position its size, entry price, margin mode and isolated wallet — without
waiting for a REST read of the same facts. A position the frame reports at zero
size SHALL leave the held set; a position the frame does not mention SHALL be
carried unchanged. A resource that has never been read successfully SHALL NOT be
folded into, so a frame describing part of the account is never presented as the
whole of it. The folded position set SHALL drive the mark price subscription and
the per-contract leverage read on the same terms an account read does.

An execution report reporting a fill SHALL NOT issue an account read of its own:
the `ACCOUNT_UPDATE` the exchange sends for the same fill is what carries the
wallet and the position it moved.

#### Scenario: A fill moves a position
- **WHEN** an `ACCOUNT_UPDATE` reports the position size and entry price after a fill
- **THEN** the held position carries the frame's size and entry price without waiting for a read, and the accompanying execution report issues no read of its own

#### Scenario: A position is closed on the stream
- **WHEN** an `ACCOUNT_UPDATE` reports a position at zero size
- **THEN** it leaves the held positions at once, and positions on other contracts are left as they were

#### Scenario: A wallet-only frame arrives
- **WHEN** an `ACCOUNT_UPDATE` reports a changed wallet balance and no position
- **THEN** the held wallet balance is updated and the held positions are left exactly as they were

#### Scenario: Nothing has been read yet
- **WHEN** an `ACCOUNT_UPDATE` arrives before any successful balance or position read
- **THEN** nothing is folded, and the resources stay as they were

#### Scenario: A position opens on a contract the desk holds nothing on
- **WHEN** an `ACCOUNT_UPDATE` reports a position on a contract with no held row
- **THEN** the row is created from what the frame states, the mark price stream is subscribed for that contract, and the contract's leverage is read

### Requirement: Values no stream carries are read, not computed
The liquidation price, the margin a position commits and the free margin an
order may be sized against are not carried by any authenticated stream. The
system SHALL NOT derive them from the values a stream does carry. It SHALL read
them from the exchange, and SHALL do so only when a fold moved something they
depend on: a position whose size, entry, margin mode or isolated wallet changed,
or a wallet balance that moved. Such a read SHALL name only the resources whose
unstated values moved, and SHALL issue nothing when none did.

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
