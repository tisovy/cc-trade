## ADDED Requirements

### Requirement: A command's answer is recorded beside it
The record SHALL state, for every command it keeps, when the desk finished with
it and how long that took, so that a command's line can be read as a measurement
rather than as a note that something was asked for. The answer SHALL name the
same command and the same order identity its own line carries, SHALL state
whether the desk finished or failed, and SHALL carry no price, size or amount.

A command the record does not keep SHALL have no answer kept either, so the
reads the desk asks for on its own beat do not fill the record with their own
housekeeping.

The summary over a day SHALL report how long each kind of command took to
answer — how many, the middle of them, and the slowest with its time — so a desk
that felt slow can be asked which command was slow and when.

#### Scenario: An order is placed
- **WHEN** a placement is sent and the exchange answers it
- **THEN** the record carries the command and, beside it, how long the desk took to answer it, naming the same order identity

#### Scenario: A read on the desk's own beat
- **WHEN** the desk refreshes the account on its own beat
- **THEN** neither the read nor an answer for it is written

#### Scenario: The evening's reading
- **WHEN** the summary is run against a day in which orders were placed and cancelled
- **THEN** it reports each command's count, median and slowest answer, and when the slowest happened
