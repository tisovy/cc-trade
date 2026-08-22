## MODIFIED Requirements

### Requirement: A book that cannot be built costs the book, not the desk
A depth bootstrap that cannot be bridged SHALL NOT resynchronize the session.
The desk SHALL come live without the book — chart, candles, header and tape
delivering — with the book marked stale and rebuilt in the background on its own
cooldown, exactly as a live book already answers a sequence gap. The aggregate
timing SHALL distinguish a session that reached live with its book from one that
reached live without it.

The cooldown between rebuild rounds SHALL widen while rounds keep failing and
SHALL be bounded by a stated ceiling, and one bridged snapshot SHALL return it
to its floor. A round abandoned because the contract is being released or the
session is resynchronizing SHALL count as neither. Buying a deeper page of a
live book is not a recovery and SHALL stay exempt from this cooldown. A book
that cannot be bridged is one the exchange cannot serve a usable snapshot for,
and asking at a fixed rate for as long as that lasts spends the desk's read
budget against the exchange at exactly the moment it is refusing work.

#### Scenario: The book cannot be bridged at startup
- **WHEN** every snapshot attempt of a bootstrap fails to bridge
- **THEN** the session reports `live`, the header, candles and tape keep being delivered, and the book is reported stale rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: The book is rebuilt afterwards
- **WHEN** a later recovery bridges a snapshot for a session that came live without its book
- **THEN** the book is delivered live to the panel without the session having been rebuilt

#### Scenario: The timing log is read afterwards
- **WHEN** a session comes live without its book
- **THEN** its aggregate timing says so, distinctly from a session that came live with one and from one that failed

#### Scenario: The exchange cannot serve a bridgeable snapshot
- **WHEN** rebuild rounds keep failing because no snapshot bridges
- **THEN** each failed round widens the pause before the next, up to the stated ceiling, instead of asking at the same rate for as long as the condition lasts

#### Scenario: The exchange recovers
- **WHEN** a snapshot bridges after a run of failed rounds
- **THEN** the pause returns to its floor, and the next broken sequence is answered at the ordinary cadence
