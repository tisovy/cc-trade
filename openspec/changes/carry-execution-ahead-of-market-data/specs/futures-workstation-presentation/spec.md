## ADDED Requirements

### Requirement: Account traffic is carried ahead of market data
The local transport SHALL carry account traffic and market data on separate
lanes. Account traffic — account state, execution reports, symbol configuration
and command outcomes — SHALL be delivered without loss and ahead of market data
already queued. Market data — depth, header, candles and tape — SHALL be
latest-wins: a frame still waiting to be accepted by the socket SHALL be replaced
by a newer frame for the same resource rather than both being queued behind each
other.

Only a resource that repeats everything the frame before it said may be
superseded. A book, a header, a tape window and a candle series each state the
whole of what they are, so the newer frame says everything the undelivered older
one said. A catalog page, a history page and a status line do not: a catalog is
assembled by offset and a dropped page discards the whole of it, a history page
is the answer to one request, and a status line names a cause the next line does
not repeat. Those SHALL be queued as market data and never replaced, and SHALL
NOT be dropped to make room either: what may not be superseded may not be
discarded, since the renderer assembles it and a missing part loses the whole.
A resource carried on more than one series SHALL be superseded per series, since
one series is not a newer statement of another.

The transport SHALL account for what the socket has not yet accepted, and SHALL
supersede rather than stack when it is behind. What was superseded SHALL be
counted per resource and made available to the diagnostic record, because a frame
dropped without a count is indistinguishable from a market that went quiet. That
count SHALL be stated when a backlog clears rather than per superseded frame: the
backlog worth recording is a socket blocked for a minute at the exchange's full
cadence, which is exactly when a line per frame would cost more than it tells.

"Without loss" SHALL have a stated end. A renderer that has not accepted a
bounded number of queued account frames SHALL be closed rather than served a hole
in its own account state, and reads the account again when it reconnects.

#### Scenario: A fill lands during a depth backlog
- **WHEN** an execution report is issued while depth frames are queued and not yet accepted by the socket
- **THEN** the execution report is delivered ahead of them, and none of it is dropped

#### Scenario: The renderer falls behind on depth
- **WHEN** depth frames arrive faster than the socket accepts them
- **THEN** the newest book is delivered and the frames it superseded are counted, rather than the operator reading a book that is several frames old

#### Scenario: Account traffic is never superseded
- **WHEN** two account frames are queued and the transport is behind
- **THEN** both are delivered, because an account fact is not replaced by a later one the way a quote is

#### Scenario: A paged resource is queued while the transport is behind
- **WHEN** a catalog page, a history page or a status line is queued behind an unaccepted send
- **THEN** it is delivered rather than replaced by a later frame of the same resource, because it states part of something and not the whole of it

#### Scenario: A catalog is sent as more pages than the queue is sized for
- **WHEN** the desk sends a contract catalog as pages back to back and the socket stops accepting bytes partway through
- **THEN** every page is delivered — a book already replaced by a newer one gives way first, and the queue grows rather than losing a page the renderer is assembling

#### Scenario: A contract's two candle series are both waiting
- **WHEN** the contract's own series and the index series are queued for the same contract
- **THEN** each is superseded only by a newer frame of its own series

#### Scenario: A renderer stops taking its account traffic
- **WHEN** a renderer has not accepted a bounded number of queued account frames
- **THEN** it is closed rather than served a hole in its account state, and reads the account again on reconnect

### Requirement: A delivered frame is serialized once and parsed once
A workstation event SHALL be serialized once on the way out: the representation
measured against the byte ceiling SHALL be the representation that is sent. An
incoming frame SHALL be parsed once, at the boundary it arrives on, and
subscribers SHALL receive the parsed, typed event rather than the raw frame.

A subscriber SHALL be delivered only the event kinds it handles. No subscriber
SHALL parse a frame in order to discover that it does not want it.

#### Scenario: An event is delivered to the renderer
- **WHEN** the desk delivers a workstation event
- **THEN** it is serialized once, and the size it was checked against is the size that was sent

#### Scenario: An oversized event is refused
- **WHEN** an event exceeds the byte ceiling
- **THEN** it is refused exactly as it is today, from the single serialization

#### Scenario: A depth frame arrives with several subscribers listening
- **WHEN** a depth frame is delivered and both market-data and account subscribers are attached
- **THEN** it is parsed once, reaches the market-data subscriber, and is never handed to an account subscriber

## MODIFIED Requirements

### Requirement: Transport bounds are derived from the payload they carry
Every bound that a workstation event must satisfy to be delivered and read — its
byte ceiling and the level count the payload rules accept — SHALL be derived from
a single statement of how much book is delivered, rather than written
independently. Exceeding any of these bounds stops the resource entirely instead
of degrading it, so the bounds SHALL be proven against the widest payload the
rules call legal rather than against a representative one.

The byte ceiling SHALL be enforced before a frame is parsed, so an unbounded
frame is refused without being read. What a parsed frame is then permitted to
contain SHALL be decided by the structural validators — exact keys, canonical
decimals, exchange identities, timestamps and level counts — rather than by a
budget counted during parsing.

#### Scenario: The deepest legal book is delivered
- **WHEN** an event carries a full book at the longest decimals and identities the payload rules accept
- **THEN** it is within the byte ceiling and is parsed to completion, rather than being refused for size or for resource limits

#### Scenario: The delivered depth is changed
- **WHEN** the number of levels delivered per side is changed
- **THEN** the payload validator's bound follows it without a second edit

#### Scenario: A frame arrives over the byte ceiling
- **WHEN** an incoming frame is larger than the ceiling derived from the payload
- **THEN** it is refused before it is parsed, rather than being read and then rejected

#### Scenario: A frame is within the ceiling but malformed
- **WHEN** a frame within the byte ceiling carries a payload the rules do not accept
- **THEN** the structural validators reject it, and every payload refused before this change is still refused
