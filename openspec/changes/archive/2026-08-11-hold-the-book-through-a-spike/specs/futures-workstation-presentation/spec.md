## ADDED Requirements

### Requirement: A burst of market data does not end the market data
An upstream frame that exceeds the desk's frame ceiling SHALL NOT terminate the
session it arrived on. The desk SHALL keep delivering depth, trades, header and
candles across such a frame, recovering whatever state the dropped frame carried
without a full resynchronization of the workspace.

#### Scenario: A depth frame exceeds the ceiling during a sharp move
- **WHEN** a depth frame larger than the ceiling arrives on a live session
- **THEN** the session stays live and the book is recovered, rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: A stream genuinely disconnects
- **WHEN** an upstream socket closes for any reason other than a frame this desk refused
- **THEN** the session resynchronizes as it does today

### Requirement: A resynchronization names its cause
A resynchronization SHALL carry a reason that distinguishes a connection lost by
the exchange, a connection this desk closed on its own rule, and a resource that
went stale without a close.

#### Scenario: The desk closed the connection itself
- **WHEN** the desk terminates a stream because of its own limit
- **THEN** the reason shown to the operator names that limit rather than reporting a plain socket disconnect

#### Scenario: The desk refused a frame and kept the stream
- **WHEN** the desk drops an upstream frame that exceeds its own ceiling
- **THEN** the refusal is named on the workspace's reason line under a code of its own, the session stays live, and a burst of such frames is stated once rather than once per frame
