## MODIFIED Requirements

### Requirement: A kept reading is verified against the exchange, not trusted
A reading kept on disk SHALL be re-read whole from the exchange on a cadence the
desk can afford, and what is held SHALL be replaced by what the exchange
answers wherever the two disagree. The disagreement SHALL be recorded as the
counts measured on that pass — held rows the exchange no longer states, and
held rows it restates differently, inside the span the re-read covered — and a
pass that did not compare SHALL record that it did not, rather than a zero
that reads as agreement. On 2026-09-02 sixteen passes recorded `missing: 0,
differing: 0` from literals the comparison had not produced since 2026-08-23.

This is the condition that makes keeping anything safe. A recomputed reading
that is wrong is wrong until the next pass; a kept one is wrong until someone
notices. Where the read has been narrowed enough that a whole window costs one
request per kind of flow, there is no reason to hold a total the desk has not
checked, and the check SHALL therefore not be deferred to a cadence chosen for
cost when cost is no longer the constraint.

A kept reading SHALL never be preferred to the exchange, and SHALL never be the
answer to a question the exchange was not asked.

#### Scenario: The kept reading is verified
- **WHEN** the verification interval passes with a reading loaded from disk
- **THEN** the window is read again from nothing and compared, and the exchange's answer stands wherever they differ

#### Scenario: The kept reading holds a row the exchange no longer states
- **WHEN** a whole-window re-read does not return a row the file holds, inside the span the re-read covered
- **THEN** the row is dropped and the disagreement is recorded, rather than kept because it was once read

#### Scenario: The record states what the comparison found
- **WHEN** a whole-window re-read compares the held rows lane by lane
- **THEN** the pass's record event carries the number of lanes compared and the rows found missing or restated, measured on that pass

#### Scenario: A pass that did not compare
- **WHEN** a pass extends the newest end of the window without re-reading it whole
- **THEN** its record event states that no lane was compared, and its zero counts are not read as agreement
