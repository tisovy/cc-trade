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
recorded. A command the desk itself refused MAY additionally be recorded by the
condition that failed, constrained to the same amount-proof shape; a condition
in a shape the record will not repeat SHALL cost the condition and not the
refusal.

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

#### Scenario: The desk refuses a command for a named condition

- **WHEN** the desk itself refuses a command and names which condition failed
- **THEN** the outcome line carries that condition in a shape that cannot express an amount, and a condition in any other shape is dropped without dropping the line

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

The command SHALL read the record file named on its command line. A named file
it cannot read SHALL be refused with an error naming that file and a nonzero
exit, and no summary SHALL be printed in its place — the reader SHALL never
substitute another day's record for the one that was asked for. An argument the
reader does not understand, a flag whose value is missing, and a call that
names a file while also selecting from a directory, SHALL be refused the same
way rather than partly obeyed.

Counts keyed by a code the exchange gave SHALL name the market beside the code
and SHALL NOT be merged across markets: the two markets do not share a code
namespace, and one merged count reads as one problem when there may be two.

#### Scenario: The operator asks what happened yesterday
- **WHEN** the summary is run against a day of the record
- **THEN** it reports the counts by code, the causes of every resynchronization, and the slowest phases, without the application running

#### Scenario: A named record file is read or refused, never substituted
- **WHEN** the summary is invoked with the path of a record file
- **THEN** it summarizes that file when the file can be read, and otherwise reports the path it could not read and exits nonzero, printing no other day's summary in its place

#### Scenario: The same exchange code from both markets stays two counts
- **WHEN** the summary is run against a day in which a spot command and a futures command were both refused with the same exchange code
- **THEN** the refusals are reported as two counts, each named with its market

### Requirement: Refusals can be counted by their cause

The summary over a day of the record SHALL report how many commands each
refusal cause accounts for — the code the exchange gave, or, for a refusal the
desk issued itself, the condition the desk named — so that a run of refusals
can be read as one cause or as several without opening the record itself.
Desk-named conditions SHALL NOT be folded into one "no exchange code" bucket.

#### Scenario: An evening of refused orders

- **WHEN** the summary is run against a day in which several commands were refused
- **THEN** it reports the refusals grouped by the exchange's code or the desk's named condition, and how many commands each accounts for

#### Scenario: Desk refusals with different named conditions

- **WHEN** the summary is run against a day in which the desk refused commands for more than one named condition
- **THEN** each condition is its own count, named with its market, and none of them is reported as a refusal the exchange left uncoded

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
that felt slow can be asked which command was slow and when. Each market's
answers SHALL be their own distribution, named with the market beside the
command, and SHALL never be merged across markets: a spot answer and a futures
answer to the same command do not measure the same span, and a merged
distribution attributes one market's slowest wait to the other. A day that held
only one market SHALL report only that market's groups.

#### Scenario: An order is placed
- **WHEN** a placement is sent and the exchange answers it
- **THEN** the record carries the command and, beside it, how long the desk took to answer it, naming the same order identity

#### Scenario: A read on the desk's own beat
- **WHEN** the desk refreshes the account on its own beat
- **THEN** neither the read nor an answer for it is written

#### Scenario: The evening's reading
- **WHEN** the summary is run against a day in which orders were placed and cancelled
- **THEN** it reports each command's count, median and slowest answer, and when the slowest happened

#### Scenario: Answer spans are summarized per market
- **WHEN** the summary is run against a day in which both spot and futures commands were answered, and the slowest answer of the day was a spot command's
- **THEN** each command's count, median and slowest are reported per market with the group named by its market, and the futures group's slowest is a futures answer — the spot sample appears only under spot

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

### Requirement: The desk's own arithmetic is recorded as its distance from the exchange's
When a read answers with a value the desk also computed, the record SHALL keep
one event per value per read pass stating how many rows were compared, the
largest disagreement in basis points of the exchange's own answer, and the
contract that disagreement was on. The values themselves SHALL NOT be recorded:
the record accepts no amount, and a deviation SHALL be a bounded whole number of
basis points so that no price, size or balance can be reconstructed from the
file.

A value the desk could not compute SHALL be recorded as such, distinctly from
one it computed and got right, so that a fortnight of silence cannot be mistaken
for a fortnight of agreement.

The day's summary SHALL report, per value, how many passes were compared, the
worst disagreement and the contract it was on, and how many passes the desk
could not compute at all.

#### Scenario: The desk agrees with the exchange
- **WHEN** a read answers a liquidation price the desk had also computed
- **THEN** the record carries one event naming that value, the rows compared and the deviation in basis points, and no price

#### Scenario: The desk could not compute
- **WHEN** a read answers a value the desk had no brackets, mark or leverage to compute
- **THEN** the record carries an event stating that it could not be computed, and it does not read as agreement

#### Scenario: A deviation offered as an amount
- **WHEN** a comparison offers a deviation that is not a bounded whole number
- **THEN** the event is refused and no line is written for it

#### Scenario: The summary is read
- **WHEN** the operator reads the day's summary
- **THEN** it states, for each computed value, how many passes agreed, the worst disagreement and where, and how many could not be computed

### Requirement: The record states where a late frame waited
The desk SHALL mark a market-data or account frame with the times it passed: the
exchange's own event time where the payload states one, the time the main process
received it, the time it was queued for the renderer, the time the renderer
received it, and the time the desk committed it to screen. For a frame the
operator reports as late, the record SHALL be able to state which of those steps
it waited in, rather than leaving the delay to be attributed by reasoning.

The account lane SHALL be marked on the same terms as the market lane. What the
exchange states about an order, and the account envelope folded from it, are the
frames an operator reports as late most often, and a record that times only
market data cannot answer them at all.

A frame about an order SHALL name the order, using the same identity the
command and answer lines carry, and SHALL name the state the exchange gave it,
so a day reads as one story rather than as two files to be joined by hand.

It SHALL further state what became of the frame on the screen, in three readings
that SHALL be kept apart: that the screen now shows what the frame said and
drawing it moved something; that the screen already showed it; and that the
screen does not show it at all. The last is the fault, and it is what an operator
reporting "the order did not update" is describing. The middle is not a fault and
SHALL NOT be recorded as one: one settlement produces more than one frame
carrying the same fact, so the second of them changes nothing by arriving after a
sibling that was already applied. A record that judged a frame by whether the
screen moved would call that second frame undelivered on every ordinary fill.

None of the three SHALL be inferred from the absence of a line. A frame that
arrived is recorded whatever it did.

The record SHALL also state the outbound queue's depth, in bytes and in frames
per resource, and what that queue superseded or dropped. A frame dropped without
a count is indistinguishable from a market that went quiet.

These are diagnostic events under the rules the record already enforces: they
SHALL state a recognized kind, phase and code; they SHALL carry no price,
quantity, notional, balance or profit-and-loss value — including the filled
fraction of an order, which the state the exchange gave it already answers well
enough; and writing them SHALL NOT raise into a caller or delay a delivery.
Market-data marks SHALL be sampled rather than written per frame, because they
arise at the exchange's cadence; account marks SHALL NOT be sampled, because they
arise at the account's, and the event a sample would drop is the one the record
is being asked about. Both rules SHALL be stated in the code that enforces them,
so the record stays inside the bounds it already keeps.

#### Scenario: A frame is delivered and drawn
- **WHEN** a market-data frame passes from the exchange to the screen
- **THEN** the record can state the delay at each step it passed, rather than only the total

#### Scenario: An order the exchange reports on is drawn
- **WHEN** the exchange reports on an order and the desk draws what it said
- **THEN** the record states the same delays for that frame, names the order by the identity its command carries and the state the exchange gave it, and says that the working orders changed

#### Scenario: The second frame of one settlement arrives
- **WHEN** a frame states what the screen already shows, because a sibling frame of the same settlement was applied first
- **THEN** the record states it as already drawn, and does not present it as a frame the screen never showed

#### Scenario: A report arrives and the screen does not show it
- **WHEN** the exchange reports on an order and the desk's surfaces do not end up showing what it said
- **THEN** the record states that frame as not drawn, rather than not stating it

#### Scenario: The transport falls behind
- **WHEN** frames arrive faster than the socket accepts them
- **THEN** the queue's depth and what it superseded are recorded per resource, and both return to zero when it drains

#### Scenario: A timing event carries a value it must not
- **WHEN** a timing event is offered to the record carrying a price, size or profit-and-loss value
- **THEN** it is refused or that value is dropped, exactly as any other event would be

#### Scenario: The market is busy
- **WHEN** frames arrive at the exchange's full cadence for an extended session
- **THEN** the market-data timing events are sampled, the account's are not, and the record stays within the bounds it already enforces

#### Scenario: The record cannot be written
- **WHEN** the record cannot be opened, written or rotated while timing marks are being produced
- **THEN** the line is lost and the desk is left exactly as it would be without a record at all

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
