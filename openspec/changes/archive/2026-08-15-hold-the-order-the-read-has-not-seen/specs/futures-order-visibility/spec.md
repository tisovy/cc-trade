## MODIFIED Requirements

### Requirement: Confirmed order updates survive an older account snapshot
The system SHALL treat a confirmed execution report as authoritative until the
account snapshot it is reconciled against is at least as recent. An account
snapshot SHALL NOT replace an open order with an older version of that same
order, and SHALL NOT remove an open order the stream has recently reported
working. A snapshot requested before that report could not have seen the order;
a snapshot requested shortly after it may still be answered from a view of the
exchange that has not caught up with its own matching engine. Neither silence is
evidence that the order is gone. Only when the stream has said nothing about the
order for longer than the window the exchange's answer may trail the stream by
does the snapshot decide, and an order it omits is no longer working.

An order the exchange has reported settled SHALL NOT be listed as working again,
by any message. This covers both a report that left the exchange before the
settlement — the reply to a placement that filled the instant it was made — and
an account snapshot read from a service that had not yet seen the settlement.
Settlement is remembered by the order's exchange identity rather than compared by
time, because the exchange does not reuse an order id; the memory SHALL be
bounded, since it guards messages in flight rather than recording history. A
settlement report that carries no order id SHALL settle nothing, its identity
being the prefix every unidentified order on that contract would share.

What the stream has reported working SHALL be remembered on the desk's own clock
and compared against when the read was issued, less that window, so the
comparison does not depend on the exchange's clock agreeing with the desk's. That
memory SHALL be bounded on the same grounds as the settled one, and an order
reported settled SHALL leave it — a settlement the stream reports ends the hold
at once rather than waiting for the window to close.

#### Scenario: Snapshot arrives with pre-amendment values
- **WHEN** an amendment is confirmed and the account synchronization that follows returns the order with an earlier update time
- **THEN** the order keeps the confirmed price and size, and no operator refresh is required to see them

#### Scenario: Snapshot is newer than the local report
- **WHEN** the account snapshot reports the order with a later update time than the last locally applied report
- **THEN** the snapshot values replace the local ones

#### Scenario: A read issued before the order existed answers without it
- **WHEN** an order is placed, the stream reports it working, and an account read issued before that report returns a working-order list that does not contain it
- **THEN** the order stays listed as working, and it is not removed and re-added as later reads catch up

#### Scenario: A read issued after the placement has not caught up with it
- **WHEN** an order is placed, the stream reports it working, the desk reads the account it has just changed, and that read — issued after the report — returns a working-order list that does not contain the order
- **THEN** the order stays listed as working, because the exchange's own answer may trail its stream

#### Scenario: A read reports an order the stream has not spoken about
- **WHEN** an account read returns a working-order list without an order the desk holds, and the stream has reported nothing about that order for longer than the window the exchange's answer may trail it by
- **THEN** the order is removed, because the read is the newer statement about it

#### Scenario: The placement's reply arrives after the fill
- **WHEN** an order fills the instant it is placed, so the stream reports it filled before the reply to the placement arrives describing it as new
- **THEN** the order is not listed as working, and no reload is required to clear it

#### Scenario: A snapshot still describes a settled order
- **WHEN** an account snapshot lists an order the exchange has already reported settled, alongside an order that is genuinely resting
- **THEN** the settled one is refused and the resting one is listed
