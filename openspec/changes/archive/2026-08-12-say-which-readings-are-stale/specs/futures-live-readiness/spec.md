## ADDED Requirements

### Requirement: An account reading states whether it is still confirmed
A held account snapshot SHALL carry whether it is confirmed by the current
transport connection. Losing the transport SHALL mark the held resources
unconfirmed while retaining their last values for reference. A resource SHALL
become confirmed again only when a read answers on the current connection, not
when a read is requested. Order sizing SHALL require a confirmed balance and
SHALL state the unconfirmed balance as the reason when it refuses.

#### Scenario: Transport reconnects
- **WHEN** the local transport drops and reconnects and the account refresh has been sent but not answered
- **THEN** the balance is presented as unconfirmed, order sizing is refused with that reason, and the last known values remain readable

#### Scenario: Refresh answers after reconnect
- **WHEN** the account read answers on the new connection
- **THEN** the balance is confirmed again and order sizing is available

### Requirement: A stalled market reading is not presented as current
When a streamed market reading — mark price above all — stops arriving for
longer than its stall window, the system SHALL present it as stale rather than
as the current value, and SHALL attempt to restore the stream. Numbers derived
from a stale reading SHALL be presented as derived from a stale reading.

#### Scenario: Mark price stream goes quiet
- **WHEN** no mark price arrives for longer than the stall window
- **THEN** the mark and every number derived from it are presented as stale, and the feed attempts to restore the stream

#### Scenario: Stream resumes
- **WHEN** mark prices arrive again
- **THEN** the readings are presented as current and the staleness is withdrawn

### Requirement: An unknown account reading is not presented as an empty one
Position and order surfaces SHALL distinguish "not yet read", "read failed" and
"none open". A surface with no rows and no successful read SHALL NOT state a
count of zero or describe the account as flat.

#### Scenario: Before the first successful account read
- **WHEN** the workspace opens and no account read has answered
- **THEN** the dock states that positions and orders are not yet known, and shows no count

#### Scenario: Account read failed
- **WHEN** the positions read fails
- **THEN** the dock states that the reading failed rather than reporting no open positions

### Requirement: A command outcome is not displaced by a background failure
The outcome of the operator's own last command SHALL remain visible while a
background account synchronization failure is being reported. An unresolved
outcome SHALL continue to rank above both. A rejection SHALL carry the
exchange-reported code when the exchange supplied one.

#### Scenario: Rejection during an account synchronization failure
- **WHEN** an order is rejected while an account resource is failing to refresh
- **THEN** both are readable, and the rejection names the exchange's own code

#### Scenario: Unresolved outcome outranks both
- **WHEN** a command outcome is unresolved
- **THEN** it is presented above the rejection and the synchronization failure, and offers no retry control
