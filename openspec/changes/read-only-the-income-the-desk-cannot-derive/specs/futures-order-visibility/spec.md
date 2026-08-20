## ADDED Requirements

### Requirement: The desk asks the exchange only for what it cannot already derive
A read against a metered endpoint SHALL ask for the narrowest set of rows that
answers the question, where the endpoint offers a way to narrow it. Asking for
every kind of flow because no filter was sent is not a decision the desk is
entitled to make on the operator's rate budget: on 2026-08-20 that omission cost
thirteen thousand rows a week to find forty-five, and every one of the thirteen
thousand was already held from another record the desk reads anyway.

A figure the desk can compute from a record it already holds SHALL NOT be read a
second time from another. Two records stating one number is not redundancy, it is
two numbers that can disagree, and the cheaper of the two is the one already paid
for.

Where the two records may state a component differently — the income record's
commission may or may not already be net of the rebates it reports as rows of
their own — the desk SHALL construct the figure so that it is right under either
reading, rather than adopt the cheaper record and assume one. It takes the part
the trade record states, and it keeps reading whatever that record cannot state:
gross charge from the fill, credits from the income record, and their sum is the
cost whether the metered record's own charge row was gross or net.

Measurement against the live account SHALL be required only where no such
construction exists — where the desk must pick one record and be wrong if it
picks the other. A cost stated gross on a rebated account is not a rounding
difference; it is the wrong number, quietly, and neither an assumption nor a
default is an acceptable way to arrive at it.

#### Scenario: The endpoint offers a filter for the rows that are wanted
- **WHEN** the desk needs one kind of flow from a record that carries many
- **THEN** it asks for that kind, and the reading reaches its window's start in the requests that kind actually needs

#### Scenario: A component is available from a record already read
- **WHEN** an open position's realized PnL and commission are already folded out of the fills the desk reads for its history
- **THEN** the settled figure takes them from that fold rather than reading them again from the income record

#### Scenario: The two records may state a component differently
- **WHEN** it is not established whether the income record's commission is already net of the rebates it reports separately
- **THEN** the charge is taken from the fill and the credits are still read from the income record, so that the cost is correct under either reading rather than under an assumed one

### Requirement: A read is scheduled by the event it observes
A read that exists to observe an event SHALL be scheduled by that event where the
exchange announces it, and SHALL NOT be driven by a clock faster than the event.
Funding settles six times a day on this account; a thirty-second tick spends
2 880 requests a day to observe six of them.

The desk SHALL use the announcements it already receives: the private stream
pushes `ACCOUNT_UPDATE` at the instant funding settles, and the mark-price frame
carries the next settlement's time. Neither costs a request.

A clock-driven reconciliation MAY remain, at a cadence matched to the cost of
being wrong rather than to the cost of asking, so that a missed announcement is
eventually corrected rather than carried forever.

#### Scenario: The exchange announces the event
- **WHEN** the private stream reports that funding has settled
- **THEN** the read runs, and no read runs in the interval between settlements merely because time passed

#### Scenario: An announcement is missed
- **WHEN** the stream was down across a settlement
- **THEN** a reconciliation still reaches that settlement, and the reading states its coverage rather than assuming the stream told it everything

### Requirement: A reading kept across restarts is exact or it is not kept
The desk MAY keep what it has read of the income record on disk and extend it
rather than reading it again. A kept reading SHALL satisfy all of the following,
and a reading that cannot SHALL be discarded and re-read rather than shown.

**It SHALL be keyed to the account it was read from**, by a fingerprint of the
credential rather than the credential, so that a desk started against a different
account cannot show the previous one's money.

**It SHALL carry the span it covers**, and SHALL claim exactly that span and no
more. A file of rows without the window they were read over cannot be told from a
complete record, which is the failure every other requirement on this path exists
to prevent — made permanent by writing it down.

**Each row SHALL be held under an identity that separates two charges the
exchange actually made.** A reading that collapses two rows recomputes itself
correctly every pass and a kept one is wrong forever: persistence turns a
transient defect into a stored one, so the identity requirement is a
precondition of keeping anything at all.

**It SHALL be verifiable against the exchange, cheaply enough to verify often.**
Where the read has been narrowed to one kind of flow, a full re-read of the
window is a single request, so the desk SHALL periodically re-read it whole and
compare. A disagreement SHALL be resolved in favour of the exchange and SHALL be
recorded.

**It SHALL never be preferred to the exchange.** The file is a way of not asking
again for what was already answered, never a source of record.

#### Scenario: The desk restarts
- **WHEN** a desk with a kept reading starts against the same account
- **THEN** it reads only the span since that reading ends, and the figures on screen are complete from the first pass

#### Scenario: The desk starts against another account
- **WHEN** the credential does not match the one the kept reading was read under
- **THEN** the kept reading is not used, and the read starts from nothing

#### Scenario: The kept reading disagrees with the exchange
- **WHEN** a periodic whole-window re-read returns a row the kept reading does not hold, or an amount it holds differently
- **THEN** the exchange's answer replaces the kept one and the disagreement is recorded

#### Scenario: The kept reading cannot state its own coverage
- **WHEN** a kept reading is loaded without the span it was read over, or under an identity scheme the desk no longer uses
- **THEN** it is discarded and the window is read again, rather than shown as a reading
