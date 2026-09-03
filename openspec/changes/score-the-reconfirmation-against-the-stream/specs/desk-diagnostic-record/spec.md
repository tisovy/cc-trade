## ADDED Requirements

### Requirement: A reconfirmation read keeps its own score against the stream
Every REST read whose purpose is to reconfirm what the private stream already
delivered SHALL leave one event stating, as counts, what it found beyond the
stream. For a trade-history pass: the rows the exchange returned, the rows
outside the span the stream stood for, the rows the stream had reported, the
rows it had not, the rows whose fields differed from the stream's own report,
and whether the stream stood for the whole span. For a settled-income pass: the
held rows the exchange no longer states and the held rows it restates
differently, inside the span the pass covered, with how many lanes were
compared.

A count SHALL be measured on that pass, never carried from an earlier one or
written as a constant; a pass that compared nothing SHALL say so rather than
write zeros that read as agreement. Only rows inside the span the stream or the
re-read actually covered SHALL be judged, so that a socket's downtime is not
recorded as the socket's failure. The reason the read was issued SHALL come
from a closed vocabulary named by the caller — for a trade-history pass
`fill`, `open`, `refresh`, `full`, `stream` or `bootstrap` from the renderer,
`continuation` for the main process's own walker, `unstated` for a command
that named none — and a word outside it SHALL be dropped at the command
boundary rather than recorded. No price, size, commission, PnL, identity or raw
row SHALL enter the event.

The day's summary SHALL state both scores — passes run, passes that compared,
and the counts — so that a month of agreement, or a single disagreement, can
be read from the summaries alone.

#### Scenario: A gap read returns what the stream reported
- **WHEN** the read ten seconds after a fill burst returns exactly the fills the stream had reported, with the same fields, and the stream stood throughout
- **THEN** the event counts every returned row as held, none as unreported, none as differing, and states the stream stood

#### Scenario: The exchange returns a fill the stream never reported
- **WHEN** a reconfirmation read returns a trade inside the stream's span whose identity the stream never reported
- **THEN** the event counts it as unreported

#### Scenario: The exchange restates a field
- **WHEN** a returned trade the stream had reported carries a different commission, price, quantity or realized PnL
- **THEN** the event counts that row once as differing, and no amount is written

#### Scenario: The same amount at another scale
- **WHEN** a returned trade states an amount the stream reported with more or fewer trailing zeros
- **THEN** the row is not counted as differing

#### Scenario: The stream dropped during the read
- **WHEN** the authenticated stream closes or reopens between the start of a trade-history pass and the acceptance of its rows
- **THEN** the event states that the stream did not stand for the span, and its counts are not read as evidence

#### Scenario: A read that named no reason
- **WHEN** a history command arrives without a reason, or with a word outside the vocabulary
- **THEN** the event names the reason `unstated`, and the main process's own continuation rounds name `continuation`

#### Scenario: A fill inside the read's own flight
- **WHEN** the read returns a fill that executed after the pass began, less the time a report takes to cross the socket
- **THEN** that row is counted as outside the stream's span, not as unreported, and the pass's count of such rows states how many fills went unjudged

#### Scenario: The stream reconnected inside the window
- **WHEN** the read returns rows older than the moment the current stream connection was made
- **THEN** those rows are counted as outside the stream's span, not as unreported

#### Scenario: A settled pass walked the window
- **WHEN** a full-window income pass answers a lane that no longer states a row the desk held inside the lane's covered span
- **THEN** the event counts that row as missing and the lane as compared

#### Scenario: A settled pass did not walk the window
- **WHEN** an income pass extends the newest end only
- **THEN** the event states that no lane was compared, and the summary lists the pass as run, not as compared

#### Scenario: The summary is read
- **WHEN** the operator reads the day's summary
- **THEN** it states, for history reads and for settled passes, how many ran, how many compared, and the counts found beyond the stream
