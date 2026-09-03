## MODIFIED Requirements

### Requirement: A request waiting for the desk's own budget does not stop the queue
Where the desk meters its own Futures reads against a weight window, a request
that window has no room for SHALL NOT hold the admission of other requests while
it waits. A request the window still has room for SHALL be admitted while the
larger one waits, and a request the operator's command is waiting on SHALL reach
the exchange rather than waiting out a window it fits inside.

A request SHALL carry one of three standings. `ordinary` is the desk's own
housekeeping — the beat, the income and history reads, the reads the stream
asks for. `urgent` is a read the operator's command is waiting on. `command` is
the operator's trading command itself — a placement, an amendment, a
cancellation, a cancel-all, a market close, a position-margin adjustment.

Ordinary-standing work SHALL NOT spend the window to its ceiling. A stated
command reserve SHALL be held back from ordinary reservations, so that urgent
work finds room in a minute the desk's own reads have otherwise filled. Urgent
standing MAY book into the reserve; ordinary standing SHALL be refused capacity
beyond `ceiling − reserve` exactly as it is refused beyond the ceiling. The
reserve SHALL be no smaller than the whole of the read a command waits on — the
account pass, the proof read and the configuration read that follow a command
together — and the measured basis SHALL be stated where the reserve is set.

The ceilings SHALL be stated against the exchange's allowance rather than
against a fraction of it chosen once: ordinary standing SHALL be admitted to at
least 1 200 of the exchange's 2 400 a minute, and the urgent ceiling together
with the public reader's ceiling SHALL stay below that allowance.

A `command` SHALL NOT be refused capacity by any ceiling of the desk's own. Its
weight SHALL still be booked, so the desk's accounting matches the exchange's;
what may hold a command back is only the exchange itself — an observed used
weight within a stated margin of the exchange's own limit, or backpressure the
exchange imposed. A `command` SHALL be admitted ahead of waiting reads, and the
bound on how often urgent work may overtake ordinary work SHALL NOT apply to it:
a cancel in a drain of thirty housekeeping reads does not take its turn behind
them.

Backpressure the exchange itself imposes (`429`, `Retry-After`, a ban window)
SHALL remain authoritative for all standings and SHALL NOT be reduced by the
reserve or by command standing.

Reading the window and booking weight against it SHALL remain indivisible, so
two callers cannot both find room for the last of the budget. A request that has
waited SHALL rejoin the queue rather than keeping its place at the head, and
existing admission spacing, urgency, the bound on urgency for reads, and
cancellation SHALL be unchanged.

#### Scenario: The operator's command needs weight the window still has
- **WHEN** the budget is spent to within one weight of its ceiling, an account pass that does not fit is waiting the window out, and the operator changes a contract's leverage
- **THEN** the leverage command is admitted immediately and the account pass goes when the window rolls

#### Scenario: The operator's command arrives at a minute the desk's own reads have filled
- **WHEN** ordinary reads have spent the window to the edge of the command reserve and the operator places, replaces or cancels an order
- **THEN** the command books into the reserve and reaches the exchange without waiting for the window to roll

#### Scenario: An ordinary read reaches for the reserve
- **WHEN** ordinary-standing work would take the window past its ceiling less the command reserve
- **THEN** it waits for the window to roll, exactly as it waits at the ceiling today, and the reserve stays standing for urgent work

#### Scenario: The exchange imposes backpressure
- **WHEN** the exchange answers `429` or states a retry window
- **THEN** that backpressure binds command, urgent and ordinary work alike, and neither the reserve nor command standing shortens it

#### Scenario: Two callers reach for the last of the budget
- **WHEN** two requests are admitted concurrently and only one of them fits under the ceiling
- **THEN** one books its weight and the other waits, and the window is never overspent

#### Scenario: Urgent work passes a request that has already been sent round
- **WHEN** a request the window turned away rejoins the queue and urgent work is waiting behind it
- **THEN** the count of times it has already been passed goes round with it, so waiting does not restart the bound on how often it may be overtaken

#### Scenario: A request larger than the whole window
- **WHEN** a request declares more weight than the window can ever hold and nothing else is booked against it
- **THEN** it is admitted rather than waiting for room that will not appear

#### Scenario: A command arrives while the urgent ceiling is spent
- **WHEN** the window stands at the urgent ceiling with a command's own account pass still waiting for room, and the operator cancels an order
- **THEN** the cancellation is admitted at once, its weight is booked, and the pass keeps waiting for the window to roll

#### Scenario: A command arrives at the exchange's own limit
- **WHEN** the exchange has reported a used weight within the stated margin of its own limit
- **THEN** the command waits for the exchange's counter, and the wait is recorded as a command's wait rather than a read's

#### Scenario: A command behind a drain of housekeeping
- **WHEN** the window rolls with thirty ordinary reads queued ahead of a command, each already overtaken as often as the bound allows
- **THEN** the command goes first, and the reads follow in their order

#### Scenario: The reserve is measured against the read a command waits on
- **WHEN** a command's consequence pass declares more weight than the reserve holds
- **THEN** the reserve is the one at fault, and the constant states the pass it was sized against

#### Scenario: The ceilings against the exchange's allowance
- **WHEN** the urgent ceiling and the public reader's ceiling are both spent in one window
- **THEN** their sum is still below the exchange's allowance for one address, and the ordinary ceiling is at least half of that allowance
