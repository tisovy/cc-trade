## MODIFIED Requirements

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it and prepend the result, keeping the
bars the operator is looking at in place rather than jumping the viewport. Only
one history request SHALL be in flight at a time, and a request that can no
longer be answered SHALL NOT count as one: a read outstanding when the session
behind it was rebuilt is not travelling, and the renderer SHALL let it go rather
than wait on it. When a response returns fewer candles than requested, the chart
SHALL treat that as the start of the contract's history and SHALL stop requesting
more. A read that was not served SHALL NOT be treated as such a response: the
chart SHALL conclude that a contract's history has a start only from a page the
exchange actually sent, and a page the exchange sent SHALL be the only thing the
renderer takes for one — a resource restated under a state of the desk's own is
not a page, whatever it carries.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

#### Scenario: The read failed rather than came back short
- **WHEN** a read of older candles is not served at all
- **THEN** the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The desk states an outage over the last answer it holds
- **WHEN** a state of the desk's own restates the last history answer while a read is outstanding for it
- **THEN** the restatement is not taken for a page, the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The session is rebuilt under an outstanding read
- **WHEN** the connection recovers and the session is rebuilt while a read of older candles is outstanding
- **THEN** the next scroll issues a new read rather than waiting on an answer that can no longer arrive

### Requirement: A failed futures history read leaves history loadable
A read of older candles that cannot be served SHALL be answered rather than
passed over in silence, and the answer SHALL name the read it belongs to. The
renderer SHALL release its in-flight read on that answer so the next scroll
issues a new one, SHALL leave the run on screen exactly as it was, and SHALL NOT
take the failure for the exchange saying there is nothing older. The operator
SHALL be told at the chart, and told until a read succeeds — a notice that
withdraws itself leaves the chart looking like a contract whose history ends
there.

A notice SHALL NOT instruct an action the desk will not carry out. Where the
chart will issue no further read for that contract and interval, the operator
SHALL be told that the history ends there rather than told to scroll again, and
SHALL be told whose end it is: the exchange having nothing older is a fact about
the contract, while a run this chart will not draw past is a fact about the desk,
and the desk SHALL NOT state its own limit as the contract's beginning.

#### Scenario: The exchange read fails
- **WHEN** the backend cannot serve a read of older candles
- **THEN** the failure is answered, the renderer's in-flight read is released, and the next scroll issues a new read

#### Scenario: The failure answers a read the chart moved on from
- **WHEN** a failure arrives naming a read other than the one being waited on
- **THEN** it is ignored and the read in flight is still in flight

#### Scenario: A page arrives after a failure
- **WHEN** a later read is served
- **THEN** the operator is no longer told that older candles could not be loaded

#### Scenario: The chart will not ask again
- **WHEN** the chart has concluded that the contract's history has a start
- **THEN** the operator is told the history ends there, and is not told to scroll again to retry

#### Scenario: The chart stops on its own ceiling
- **WHEN** the chart will issue no further read because the run it draws cannot be deepened
- **THEN** the operator is told the chart holds as far back as it draws, and is not told that the contract's history starts there
