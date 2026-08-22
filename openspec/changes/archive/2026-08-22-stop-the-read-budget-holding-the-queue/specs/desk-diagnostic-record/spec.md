## ADDED Requirements

### Requirement: The record states when the desk made itself wait
Where the desk holds one of its own requests back against a self-imposed budget
rather than against a refusal from the exchange, it SHALL record that it did so.
The line SHALL state how long the request waited, the weight it asked for, how
much of the window was already spent when it was first turned away, the ceiling
it was measured against, and whether the request was the operator's business or
the desk's own housekeeping.

The line SHALL carry counts only and no amount, in keeping with the rest of this
record. A request that is admitted without waiting SHALL produce no line. A
record that refuses or fails SHALL cost its own line and SHALL NOT delay or stop
the queue that wrote it.

#### Scenario: A command waits for the desk's budget
- **WHEN** the operator's contract-configuration command is held back because the desk's read budget for the minute is spent
- **THEN** the record carries one line naming the wait, the weight, the spend, the ceiling, and that it was urgent

#### Scenario: A read is admitted straight away
- **WHEN** a read finds room in the window and is admitted without waiting for it
- **THEN** no line is written

#### Scenario: The line is written while the queue moves
- **WHEN** the line for a request that waited is written
- **THEN** that request has already booked its weight and given the admission slot back, so nothing behind it is waiting on the record

#### Scenario: The record cannot take the line
- **WHEN** writing the line fails
- **THEN** the request still proceeds and the queue behind it still moves
