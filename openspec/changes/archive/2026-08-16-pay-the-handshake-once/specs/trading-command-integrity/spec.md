## ADDED Requirements

### Requirement: A transport retry cannot become a second order
A retry issued by the transport, rather than by a caller that knows what it
sent, SHALL be confined to failures that prove the exchange did not receive the
request. Reusing connections makes one such failure possible — a connection the
far side closed while idle, whose reset is delivered in place of the request —
and the retry exists for that failure and no other.

The transport SHALL retry only when all of the following hold: the connection
was taken from the pool rather than opened for this request, no byte of a
response has arrived, and the failure is a connection-level reset or broken
pipe. It SHALL NOT retry a timeout, SHALL NOT retry any HTTP status including
5xx, and SHALL NOT retry once a response has begun — each of those may have been
received and acted on, which is an indeterminate outcome and is already carried
as one.

A transport retry SHALL reuse the request exactly as first composed, including
the identity the command was given, so that a duplicate arising from any cause
outside this rule is refused by the exchange rather than filled.

#### Scenario: A mutating command meets a closed pooled connection
- **WHEN** an order placement sent on a pooled connection fails with a connection reset before any response byte
- **THEN** it is sent once more on a new connection with the same command identity, and exactly one order can reach the exchange

#### Scenario: A mutating command times out
- **WHEN** an order placement exceeds the request timeout
- **THEN** the transport does not retry it, and the outcome stays indeterminate for the reconciliation path to resolve

#### Scenario: The exchange answers with a server error
- **WHEN** an order placement receives a 5xx response
- **THEN** the transport does not retry it, and the existing indeterminate handling applies unchanged

#### Scenario: The connection fails after the answer has begun
- **WHEN** a response has started arriving and the connection then fails
- **THEN** the transport does not retry, because the exchange has already acted on the request
