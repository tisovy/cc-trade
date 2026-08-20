## MODIFIED Requirements

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
