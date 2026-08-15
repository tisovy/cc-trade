## MODIFIED Requirements

### Requirement: The desk computes the values no stream carries
The system SHALL compute, from what it already holds, the values no stream
carries: each held position's notional, initial margin, maintenance margin and
liquidation price, and the account's free margin. These computed values SHALL be
what the desk shows and what an order is sized against, and SHALL be recomputed
as the mark price moves rather than only when a read answers. It SHALL compute
them from the contract's maintenance-margin brackets, the contract's leverage and
margin mode, the mark price, the folded position and wallet, and the resting
orders — without issuing a read of its own for the purpose.

Where a bracket, a mark price, a leverage or a margin mode is missing, the system
SHALL state that it could not compute the value rather than substitute a default,
a zero or a value from a different contract — and SHALL show nothing in its place
rather than a value that has gone stale.

The maintenance-margin brackets SHALL be kept from the answer the desk already
reads for a contract's leverage ceiling, held per contract and forgotten on the
same terms as the contract's other settings.

The screen SHALL make clear that a liquidation price shown between account reads
is the desk's own estimate.

#### Scenario: A position is held with everything the arithmetic needs
- **WHEN** the desk holds a position, the contract's brackets, its leverage and a mark price
- **THEN** it computes that position's notional, initial margin, maintenance margin and liquidation price, and shows them

#### Scenario: A contract with no brackets held
- **WHEN** a position is held on a contract whose brackets have not been read
- **THEN** the desk states that it could not compute that position's maintenance margin and liquidation price, computes nothing in their place, and shows nothing rather than a stale value

#### Scenario: The brackets come from a read already made
- **WHEN** the desk reads a contract's leverage ceiling
- **THEN** the whole bracket table from that answer is kept, and no further read is issued to obtain it

#### Scenario: A resting order commits margin
- **WHEN** the account has resting orders that are not reduce-only
- **THEN** the computed free margin counts the margin they commit, and counts nothing for a reduce-only order

#### Scenario: The mark price moves
- **WHEN** the mark price of a held position changes
- **THEN** its notional, margins and liquidation price are recomputed and shown, without an account read

## ADDED Requirements

### Requirement: The account is read only when the stream cannot be trusted
The system SHALL read the signed account only when the stream cannot be relied
on to have said what happened: at start-up, when a user-data socket opens or
reopens, when a command's outcome is unknown, when the exchange refuses a command
in a way the desk did not expect, when a contract's leverage or margin mode
changed, and when the operator asks. A fold of an `ACCOUNT_UPDATE` SHALL issue no
read, and placing, amending or cancelling an order SHALL issue no read.

While the account holds a position or a working order, the system SHALL read it
on a slow beat measured in minutes, to catch what the stream did not report. The
beat SHALL carry a reason of its own, and SHALL keep recording the comparison
between what the desk computed and what the read answered.

Where such a read disagrees with the computed value by more than the tolerance
the desk accepts, the read SHALL be what is shown, and the system SHALL state
which value disagreed and on which contract rather than absorbing it silently.

#### Scenario: A fill arrives
- **WHEN** an `ACCOUNT_UPDATE` is folded after a fill
- **THEN** the position, its margins and the free margin move on screen, and no account read is issued

#### Scenario: An order is placed
- **WHEN** an order is placed, amended or cancelled
- **THEN** the free margin reflects the margin it commits from the order itself, and no account read is issued

#### Scenario: The stream is reconnected
- **WHEN** the user-data socket opens or reopens
- **THEN** the account is read in full, under the reason that names it

#### Scenario: The slow beat comes round
- **WHEN** the account holds a position or a working order and the beat's interval elapses
- **THEN** the account is read under the beat's own reason, and the comparison is recorded

#### Scenario: The beat disagrees
- **WHEN** a beat's read differs from the computed value by more than the accepted tolerance
- **THEN** the read replaces what was shown, and the desk states the value and the contract that disagreed

## REMOVED Requirements

### Requirement: Values no stream carries are read, not computed
**Reason**: Replaced by measurement. The requirement forbade deriving the
liquidation price, the position margins and the free margin because a derived
value would be wrong silently. `compute-the-unstated-values-beside-the-read` ran
the desk's arithmetic beside the exchange's answer and recorded the distance
between them; this change lands only if that record cleared the bar its proposal
set, which removes the reason the prohibition existed.

**Migration**: The reads the requirement mandated are replaced by the two
requirements above — the computed values become what the desk shows, and the
account is read only when the stream cannot be trusted, including on a slow beat
that keeps the comparison running. The read reason `unstated` is removed from the
vocabulary, so a site still issuing one loses its record line rather than passing
unnoticed.
