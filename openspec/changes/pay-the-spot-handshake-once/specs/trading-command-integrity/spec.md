## ADDED Requirements

### Requirement: A spot request does not buy a connection the desk already has
The spot REST leg SHALL issue its requests on a bounded connection pool, so a
request that can be served on an open connection does not pay for a new one. A
request that opens a connection SHALL say so in the record; one served from the
pool SHALL say nothing, so the working case cannot bury its own evidence.

Each leg SHALL hold its own agent. The spot REST pool, the futures REST pool and
the agent the WebSocket callers use are three, so none can exhaust another's
sockets, and the stream agent SHALL NOT pool — a stream opens one connection and
holds it.

Reuse introduces exactly one new failure: the far side closes a connection while
it sits idle, and the next request on it fails before any byte of a response.
This SHALL be carried as the indeterminate outcome it already is — the command
reconciled against the exchange before any resubmission — and SHALL NOT be
retried blindly.

#### Scenario: A run of spot requests
- **WHEN** the desk issues several spot REST requests in succession
- **THEN** they are served on connections already open, and only the first opens one

#### Scenario: A connection is opened
- **WHEN** a spot request has no free connection and opens one
- **THEN** the record says a connection was opened, and a request served from the pool records nothing

#### Scenario: An idle connection was closed by the exchange
- **WHEN** a spot command fails on a pooled connection the far side had already closed
- **THEN** it is reported as an outcome the desk does not know and reconciled against the exchange, not reported as a refusal and not resubmitted

#### Scenario: The stream agent
- **WHEN** the spot client opens its WebSocket streams
- **THEN** it uses an agent that does not pool, and that agent is not the one the REST leg uses
