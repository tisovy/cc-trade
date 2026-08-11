## ADDED Requirements

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
what it was worth.

#### Scenario: A command is recorded
- **WHEN** a trading command is sent and answered
- **THEN** the record states the contract, side, type, identity and outcome, and states no price, quantity or profit-and-loss value

#### Scenario: An event carries a value it must not
- **WHEN** an event offered to the record contains a credential, signature or money value
- **THEN** it is refused or that value is dropped, and nothing of it reaches the file

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
