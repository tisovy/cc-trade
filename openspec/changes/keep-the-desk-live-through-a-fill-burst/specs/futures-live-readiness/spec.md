## MODIFIED Requirements

### Requirement: A request waiting for the desk's own budget does not stop the queue
Where the desk meters its own Futures reads against a weight window, a request
that window has no room for SHALL NOT hold the admission of other requests while
it waits. A request the window still has room for SHALL be admitted while the
larger one waits, and a request the operator's command is waiting on SHALL reach
the exchange rather than waiting out a window it fits inside.

Ordinary-standing work SHALL NOT spend the window to its ceiling. A stated
command reserve SHALL be held back from ordinary reservations, so that urgent
work — the operator's commands and the reads they wait on — finds room in a
minute the desk's own reads have otherwise filled. Urgent standing MAY book
into the reserve; ordinary standing SHALL be refused capacity beyond
`ceiling − reserve` exactly as it is refused beyond the ceiling today. The
reserve SHALL be set from a measurement of what a burst's urgent traffic
actually weighs, and the measured basis SHALL be stated where the reserve is
set. Backpressure the exchange itself imposes (`429`, `Retry-After`, a ban
window) SHALL remain authoritative for all standings and SHALL NOT be reduced
by the reserve.

Reading the window and booking weight against it SHALL remain indivisible, so
two callers cannot both find room for the last of the budget. A request that has
waited SHALL rejoin the queue rather than keeping its place at the head, and
existing admission spacing, urgency, the bound on urgency, and cancellation
SHALL be unchanged.

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
- **THEN** that backpressure binds urgent and ordinary work alike, and the reserve does not shorten it

#### Scenario: Two callers reach for the last of the budget
- **WHEN** two requests are admitted concurrently and only one of them fits under the ceiling
- **THEN** one books its weight and the other waits, and the window is never overspent

#### Scenario: Urgent work passes a request that has already been sent round
- **WHEN** a request the window turned away rejoins the queue and urgent work is waiting behind it
- **THEN** the count of times it has already been passed goes round with it, so waiting does not restart the bound on how often it may be overtaken

#### Scenario: A request larger than the whole window
- **WHEN** a request declares more weight than the window can ever hold and nothing else is booked against it
- **THEN** it is admitted rather than waiting for room that will not appear
