# desk-diagnostic-record Specification

## Purpose
TBD - created by archiving change keep-a-record-of-what-the-desk-did. Update Purpose after archive.
## Requirements
### Requirement: The desk keeps a local record of what it did
The application SHALL append its own diagnostic events to a local file under its
application data directory. Each event SHALL occupy one line, SHALL be
machine-readable, and SHALL carry the time it happened, the kind of event, and
the phase and code or outcome the event already states. The record SHALL survive
a restart of the application, and the path to it SHALL be stated by the
application so the operator can find it without being told where to look.

#### Scenario: A fault the desk absorbed
- **WHEN** the desk absorbs a fault it does not show the operator — a book that could not bridge, a recovery, a refused frame
- **THEN** the event is appended to the record with its time, phase and code, and is still there after the application is restarted

#### Scenario: The operator looks for the record
- **WHEN** the application starts
- **THEN** it states where the record is being written

### Requirement: The record takes structured events only
Only the application's own structured diagnostic events SHALL be written to the
record. Free-form console output SHALL NOT be captured. An event that does not
state a recognized kind, phase and code SHALL be refused by the record rather
than written in whatever shape it arrived in.

#### Scenario: An unstructured line is offered to the record
- **WHEN** something that is not a recognized diagnostic event is offered to the record
- **THEN** it is not written, and the record stays readable line by line

### Requirement: The record carries no credential and no money value
No credential, signature, or authenticated request or response body SHALL appear
in the record. No price, quantity, notional, balance, or profit-and-loss value
SHALL appear in it either. A trading command MAY be recorded by its contract,
side, type, identity and outcome, which describe what the desk did rather than
what it was worth. A command the exchange refused MAY additionally be recorded
by the code the exchange gave for the refusal, which SHALL be constrained to a
shape that cannot express an amount, and the exchange's own message SHALL NOT be
recorded.

#### Scenario: A command is recorded
- **WHEN** a trading command is sent and answered
- **THEN** the record states the contract, side, type, identity and outcome, and states no price, quantity or profit-and-loss value

#### Scenario: An event carries a value it must not
- **WHEN** an event offered to the record contains a credential, signature or money value
- **THEN** it is refused or that value is dropped, and nothing of it reaches the file

#### Scenario: The exchange refuses a command
- **WHEN** the exchange refuses a command and states a code for it
- **THEN** the record carries that code beside the refusal, and carries neither the exchange's message nor the value that was refused

#### Scenario: A refusal code arrives shaped like an amount
- **WHEN** the code offered for a refusal is not a bounded signed integer or a bounded uppercase identifier
- **THEN** the code is refused, and the refusal is still recorded without it

### Requirement: The record is bounded
The record SHALL be bounded both by how long it is kept and by how much disk it
occupies, and the oldest material SHALL be dropped first when either bound is
reached. The bounds SHALL be stated in the code that enforces them.

#### Scenario: The desk has been running for months
- **WHEN** the record has reached either bound
- **THEN** the oldest days are dropped and the record stays within both bounds

### Requirement: The record never costs the desk
Writing the record SHALL NOT raise into any caller, and no market or trading path
SHALL wait on it. A record that cannot be opened, written, or rotated SHALL lose
the line it could not write and leave the desk exactly as it would be without a
record at all.

#### Scenario: The disk refuses the write
- **WHEN** the record cannot be written
- **THEN** the desk continues unchanged, no error reaches the operator's screen, and the failure is not retried in a way that costs the desk anything

### Requirement: The record can be read back
A day of the record SHALL be summarizable by a command that reports, at least,
how many events of each code occurred, what each resynchronization stated as its
cause, and the slowest phases the record observed. The summary SHALL be derived
from the record alone, without the application running.

#### Scenario: The operator asks what happened yesterday
- **WHEN** the summary is run against a day of the record
- **THEN** it reports the counts by code, the causes of every resynchronization, and the slowest phases, without the application running

### Requirement: Refusals can be counted by their cause
The summary over a day of the record SHALL report how many commands each
exchange refusal code accounts for, so that a run of refusals can be read as one
cause or as several without opening the record itself.

#### Scenario: An evening of refused orders
- **WHEN** the summary is run against a day in which several commands were refused
- **THEN** it reports the refusals grouped by the code the exchange gave, and how many commands each code accounts for

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

