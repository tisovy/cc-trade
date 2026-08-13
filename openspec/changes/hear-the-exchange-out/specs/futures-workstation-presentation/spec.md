## ADDED Requirements

### Requirement: A stream that delivers nothing is treated as disconnected
An upstream market socket that stays open while delivering nothing SHALL be
treated as a disconnection once its silence passes a stated bound, and SHALL
enter the same recovery a closed socket enters. Marking the resources it feeds
as stale SHALL NOT be the whole of the desk's answer: a route that answers the
handshake and then says nothing raises no error and never closes, so a desk that
only marks staleness sits on a dead feed for as long as the operator leaves it
there.

The bound SHALL be chosen by what the exchange guarantees about that stream, and
SHALL be measured rather than assumed:

- A stream that pushes on an unconditional cadence, regardless of whether
  anything trades, SHALL be judged by its frames. Silence past the bound on such
  a stream is a feed that stopped delivering, not a market with nothing to say.
- A stream whose silence can be legitimate SHALL be judged by the connection's
  own traffic instead — its frames or the exchange's protocol pings, whichever
  came last — at a bound of no fewer than two missed pings. A quiet contract
  SHALL NOT be read as a dead route.

The judgement SHALL be made per socket and SHALL NOT depend on whether the
contract it serves is the one displayed, because a contract held warm behind the
one on screen is exactly the one whose dead feed would otherwise go unnoticed
until the operator switched to it.

The disconnection SHALL name which bound was crossed, distinctly from a socket
the exchange closed and from one the desk retired on its own rule.

A watchdog belonging to a socket that has been closed, rotated or torn down
SHALL report nothing.

#### Scenario: The guaranteed cadence stops
- **WHEN** the socket carrying the per-second mark stream delivers no frame for longer than its bound
- **THEN** the session reports a disconnection naming that bound and recovers as it does from a closed socket

#### Scenario: The contract is genuinely quiet
- **WHEN** a contract trades nothing for minutes and the exchange keeps sending protocol pings on its streams
- **THEN** no disconnection is reported, and the streams stay live

#### Scenario: The route stops answering entirely
- **WHEN** a socket receives neither a frame nor a protocol ping for longer than two ping intervals
- **THEN** the session reports a disconnection naming that bound, without waiting for a close that is not coming

#### Scenario: The contract is warm but not displayed
- **WHEN** a session that is not the displayed one has a socket go silent past its bound
- **THEN** it is judged and recovered the same as the displayed one

#### Scenario: The generation was released
- **WHEN** a socket is closed, rotated at its lifetime, or torn down with its session
- **THEN** its silence watchdog reports nothing thereafter

### Requirement: A book that goes silent while its tape prints is not a quiet book
Where the desk carries an aggregate-trade stream and a depth stream for the same
contract, the book's silence SHALL be judged against the tape's activity: a trade
printing against the book is a change to the book, so depth cannot be silent
through one. Depth silent past a stated margin while its own tape has printed
SHALL be reported as a disconnection.

The margin SHALL be set from measurement of the thinnest contract the desk
carries, and SHALL leave room for the longest silence observed there while its
tape was printing. Where the measurement leaves no such room, this rule SHALL NOT
be enforced at all, rather than enforced at a bound that resynchronizes a live
desk.

Both streams silent together SHALL NOT be judged by this rule; that is a quiet
market, and the connection's own traffic already answers for it.

This rule SHALL be reported under a reason of its own, because it states
something a cadence bound does not: not that a connection died, but that one of
two independently served routes stopped carrying while the other kept talking.

#### Scenario: The book stops while trades print
- **WHEN** aggregate trades keep arriving for a contract and its depth stream delivers nothing past the margin
- **THEN** the session reports a disconnection under this rule's own reason and recovers

#### Scenario: Nothing is trading
- **WHEN** neither the tape nor the book has anything to deliver
- **THEN** this rule reports nothing, and the streams are judged only by the connection's own traffic

#### Scenario: The margin is not there to be had
- **WHEN** measurement of the thinnest carried contract shows book silences through printing trades that reach the proposed margin
- **THEN** the rule is not enforced, and the measurement that ruled it out is written down
