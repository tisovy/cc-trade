## ADDED Requirements

### Requirement: An account read is recorded with the reason it was issued
Every read of the signed account resources SHALL carry a reason from the site
that asked for it, and the record SHALL keep one event per read pass stating
that reason, how many resources the pass asked for and what it cost in exchange
weight. The reason SHALL come from a fixed vocabulary the record can verify, so
that a reason it does not recognise loses its line rather than widening the
record's shape.

The day's summary SHALL report the reads grouped by reason, with how many were
issued and the weight they spent.

#### Scenario: The account is read after a fold
- **WHEN** the desk reads the balances back because a folded frame moved the free margin
- **THEN** the record carries one read event naming that reason, one resource and its weight

#### Scenario: A reason the record does not know
- **WHEN** a read is recorded with a reason outside the vocabulary
- **THEN** the event is refused and no line is written for it

#### Scenario: The summary is read
- **WHEN** the operator reads the day's summary
- **THEN** it states how many account reads went out for each reason and the weight they cost
