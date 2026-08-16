## ADDED Requirements

### Requirement: A request does not pay again for a connection the desk already has
Futures REST requests SHALL be issued on connections that outlive the request
they were opened for, drawn from a bounded pool, so that a burst of requests to
one origin costs one handshake rather than one each. The pool SHALL bound both
the connections in use and the connections held idle.

Measured on 2026-08-16 against the live exchange on this desk's own route and
proxy: a request that opens its own connection answers in 630 ms, the same
request on a connection already open answers in 325 ms. The bound this justifies
is not a timeout but a cost — ~305 ms paid per request, on every account beat,
every history page and every command.

A request that fails on a connection taken from the pool, before any byte of a
response has arrived, SHALL be retried once on a connection opened for it, and
its answer SHALL be that retry's answer. This is the behaviour the pool
replaced, kept reachable for the one failure the pool introduces: a connection
the far side closed while it was idle, handed out in the instant before that
close was noticed.

The retry SHALL NOT be used to repair failures the desk had before the pool
existed. A request that opened its own connection and failed SHALL fail as it
did before. A retry that fails SHALL be reported as the request's failure, not
swallowed and not reported as the first failure.

#### Scenario: A second request follows the first
- **WHEN** a futures REST request is issued while a usable connection to the same origin is idle in the pool
- **THEN** it is sent on that connection and no new handshake is performed

#### Scenario: The far side closed a pooled connection
- **WHEN** a request sent on a pooled connection fails with a connection-level reset before any byte of a response
- **THEN** it is retried once on a connection opened for it, and the caller receives the retry's answer

#### Scenario: The fallback fails as well
- **WHEN** the retry on a newly opened connection also fails
- **THEN** the caller receives that failure, and it is distinguishable in the record from the reuse failure that caused the retry

#### Scenario: A request that opened its own connection fails
- **WHEN** a request that was not served from the pool fails
- **THEN** it is not retried, and the caller sees exactly the failure it would have seen before the pool existed

#### Scenario: The pool is bounded
- **WHEN** more requests are in flight than the pool's limit
- **THEN** the excess waits for a connection rather than opening connections without limit

### Requirement: The record says when a request paid for a connection
The record SHALL state each time a futures REST request had to open its own
connection, and what that opening cost, so that a pool which has silently
stopped being used is visible rather than merely slow. It SHALL state a fallback
to a fresh connection, and a fallback that itself failed, as distinct causes.

A request served from the pool SHALL record nothing of its own. The absence of
these lines is the evidence that reuse is working, and it is what keeps a
working pool from writing a line per request into a record that a history sweep
already fills.

#### Scenario: A request opens its own connection
- **WHEN** a futures REST request cannot be served from the pool and opens a connection
- **THEN** the record carries the cost of that request, marked as a pool miss

#### Scenario: Requests are served from the pool
- **WHEN** futures REST requests are served from connections already open
- **THEN** the record carries nothing per request for them

#### Scenario: The record is asked why the desk is slow again
- **WHEN** the pool stops serving requests for any reason
- **THEN** the connection-opening lines reappear at the rate requests are made, naming the cost each one paid
