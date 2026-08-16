## ADDED Requirements

### Requirement: A failed read states why it failed
A read the desk records as failed SHALL carry the reason it failed, not only the
phase and the outcome. A phase with several fast-rejection paths — a proxy that
is not configured, a request aborted before it was issued, a refusal from the
admission ladder — SHALL be distinguishable in the record without re-reading the
code that produced it.

A failure the desk expects and recovers from SHALL NOT be recorded as an error.
An error line that appears on every start is either a fault nobody has priced or
a lie the record tells routinely, and both teach the reader to stop reading error
lines.

#### Scenario: A read fails before it reaches the exchange
- **WHEN** a workstation read is rejected in a handful of milliseconds, before any request goes out
- **THEN** the record names which rejection it was, so the cause can be read rather than guessed between

#### Scenario: A first attempt is expected to lose a race
- **WHEN** an attempt is one the desk expects to fail and retries by design
- **THEN** it is not recorded as an error, and what it is instead is stated where the reader will find it
