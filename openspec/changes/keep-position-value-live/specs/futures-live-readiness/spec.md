## ADDED Requirements

### Requirement: Open positions are marked to the live market
While at least one Futures renderer is active, the system SHALL subscribe to the
public USDⓈ-M mark price stream for exactly the symbols carrying an open
position and SHALL broadcast the received marks to Futures renderers. The feed
SHALL be unauthenticated, SHALL consume no REST weight, and SHALL NOT alter the
account snapshot resources or their reported synchronization state. The
subscription SHALL be reconciled only when the open-position symbol set
changes, and SHALL be torn down when no position is open or when the last
Futures renderer disconnects. On disconnect the system SHALL clear the marks it
has broadcast, so a consumer falls back to the account snapshot instead of
holding a mark that has stopped updating.

#### Scenario: A position is opened on a new contract
- **WHEN** the account snapshot first reports an open `BMTUSDT` position
- **THEN** the mark price stream is subscribed for `BMTUSDT` and its marks are broadcast to Futures renderers

#### Scenario: The position set is unchanged
- **WHEN** a further account snapshot reports the same open symbols
- **THEN** the existing subscription is kept and no socket is reconnected

#### Scenario: The last position is closed
- **WHEN** the account snapshot reports no open position
- **THEN** the mark price stream is closed and the broadcast marks are cleared

#### Scenario: The mark stream drops
- **WHEN** the mark price socket closes unexpectedly while positions are open
- **THEN** the marks are cleared for consumers, reconnection is attempted, and no account resource is reported as failed on account of the mark feed

#### Scenario: A malformed frame arrives
- **WHEN** the mark price socket delivers a frame that is not a mark price update
- **THEN** it is ignored, and no mark is broadcast for it
