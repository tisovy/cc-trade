## MODIFIED Requirements

### Requirement: Order reconciliation remains current after startup
After the first snapshot, the system SHALL combine authenticated user-data
updates with periodic and operator-requested REST reconciliation so that missed
stream events or reconnects do not leave the visible order state permanently
incorrect. The working-order set SHALL be maintained from the authenticated
stream: an execution report that opens or changes an order SHALL update it in
place, and one that reports it settled SHALL remove it, without issuing an
account-wide order read. An account-wide order read SHALL be issued only for a
stated reason — the first snapshot, a stream connect or reconnect, an
operator-requested refresh, the periodic beat, or a command whose effect no
stream can report. The periodic read SHALL run while orders are working and
SHALL stop while none are, so that a desk holding nothing spends no weight on it.

The periodic beat SHALL defer to the stream that is already reporting. A
periodic pass SHALL be held while the authenticated stream has delivered
within the beat interval and the last completed pass is younger than a stated
quiet ceiling, because the stream is restating the same orders and balances
the pass would read back at ninety weight. A pass SHALL still run when the
stream has been silent for the beat interval, and SHALL run at the quiet
ceiling however lively the stream is, so a missed frame cannot go
uncorrected longer than that ceiling. Held beats SHALL be counted and the
count SHALL reach the record on the next pass that runs. The operator's own
refresh, the first snapshot, a reconnect and a command with no stream to
report it SHALL NOT be held — the cause is named by the caller, and only the
beat defers.

A command the desk sends SHALL NOT be a reason on its own. The exchange reports
what the command did on the stream the desk is already listening to, and reading
the account back to learn the same thing spends ninety weight, holds the desk's
resources in a loading state for the length of the read, and — repeated once per
command — exhausts the minute's budget in eight commands. When no authenticated
stream is up there is nothing else to learn it from, and then the read stands.

#### Scenario: User-data stream reconnects
- **WHEN** the authenticated stream disconnects and reconnects
- **THEN** the system marks stream-derived order state stale until a REST reconciliation succeeds

#### Scenario: Manual refresh completes
- **WHEN** the operator requests an account refresh and both order sources succeed
- **THEN** the visible selected-symbol orders match the new account-wide snapshots and their freshness becomes ready

#### Scenario: An order settles on the stream
- **WHEN** an execution report reports an order filled, cancelled, expired or rejected
- **THEN** it leaves the working-order set at once and no account-wide order read is issued for it

#### Scenario: An order is opened or changed on the stream
- **WHEN** an execution report reports an order new, partially filled or amended
- **THEN** the working-order set carries it with the values the report gave, and no account-wide order read is issued for it

#### Scenario: A command completes while the stream is up
- **WHEN** the exchange answers a placement, cancellation or amendment and the authenticated stream is connected
- **THEN** no account read is issued for it, and the order reaches the desk on the stream

#### Scenario: A command completes with no stream to report it
- **WHEN** the exchange answers a command and no authenticated stream is connected
- **THEN** the account is read, because nothing else can say what the command did

#### Scenario: The beat fires while the stream is carrying the same facts
- **WHEN** orders are working, the authenticated stream has delivered within the beat interval, and the last completed pass is younger than the quiet ceiling
- **THEN** the periodic pass is held, the held beat is counted, and the count reaches the record on the next pass that runs

#### Scenario: No message reports a settlement
- **WHEN** orders are working and no execution report or snapshot arrives
- **THEN** the account is re-read without the operator asking, on a beat measured in tens of seconds

#### Scenario: The stream is lively for longer than the quiet ceiling
- **WHEN** the beat has been held repeatedly and the last completed pass reaches the quiet ceiling's age
- **THEN** the next beat runs however recently the stream delivered, so a missed frame cannot go uncorrected longer than the ceiling

#### Scenario: Nothing is working
- **WHEN** the working-orders list is empty
- **THEN** no periodic read is sent at all

### Requirement: An execution is applied without waiting for market data
An execution report SHALL reach the surfaces that show working orders and
positions without waiting for market data the desk delivered before it. The cost
of reading quotes SHALL NOT be charged to the path that applies a fill: the
handler that applies account events SHALL NOT be given market-data frames, and
SHALL NOT do work to discard them.

A burst of account-lane frames SHALL be applied in one commit per cluster
rather than one commit per frame. The first frame after a quiet moment SHALL
be applied immediately; frames arriving within a stated commit window of the
last commit SHALL fold into one trailing commit, in arrival order, with every
execution report folded and none dropped or superseded — the account lane's
lossless delivery SHALL hold from the exchange to the applied state. The
window SHALL be set from a measurement of how the exchange actually clusters
execution traffic, and the measured basis SHALL be stated where the window is
set.

The delay from an execution report arriving at the desk to the working-orders
list and the chart reflecting it SHALL be measurable, and SHALL be measured with
a market-data backlog present as well as without one — a fill matters most during
the burst that produces the backlog.

#### Scenario: A fill arrives during a burst
- **WHEN** an order fills while depth frames are arriving at the exchange's full cadence
- **THEN** the filled order leaves the working-orders list and the chart at the same point it would in a quiet market

#### Scenario: A cluster of partial fills arrives inside the commit window
- **WHEN** several execution reports and account envelopes arrive within one commit window
- **THEN** they are applied in one commit that folds every report in arrival order, and the held history carries every fill

#### Scenario: A lone report arrives after quiet
- **WHEN** an execution report arrives and nothing has arrived for at least the commit window
- **THEN** it is applied immediately rather than waiting the window out

#### Scenario: The account handler receives a depth frame
- **WHEN** the desk delivers a book to the renderer
- **THEN** the handler that applies execution reports is not given it and does no work on it

#### Scenario: The delay is measured
- **WHEN** the desk is exercised with and without a market-data backlog
- **THEN** the delay from execution report to applied state is recorded for both, rather than being inferred from the absence of complaints

### Requirement: A review never delays the desk learning what its order did
An operator-triggered history read SHALL NOT hold up the account read that
follows a mutating command. Where both contend for the same rate-limited
admission queue, the read that follows a mutation SHALL be admitted first, and a
history fan-out already in flight SHALL NOT have to finish before it.

Overtaking SHALL be bounded. A request already queued SHALL be passed over only
a bounded number of times, so that a history fan-out under way still finishes
however much the operator trades over it.

The desk's own review arithmetic SHALL NOT run on the commit that applies an
execution. The fold that turns held fills into rounds, reconciles the wallet
ledger and derives settled money SHALL trail the execution state on a stated
bound: during a burst it SHALL recompute at most once per that bound, and when
the burst ends it SHALL catch up to the newest fills without an operator
action. Working orders, positions and the surfaces that answer "what did my
order just do" SHALL stay on the immediate path. The bound SHALL be stated
where it is set.

A history read SHALL fetch the endpoint the view it is answering needs, rather
than every endpoint the panel could show. The other view SHALL read what it needs
when it is opened.

A history read SHALL replace only the endpoints it covered. What is already held
for an endpoint it did not read SHALL survive it — on screen, and in what the
desk keeps across runs — and a view no read has covered SHALL say so rather than
present itself as empty.

#### Scenario: An order is worked while a review is loading
- **WHEN** the operator opens the account history and places or cancels an order before the fan-out has finished
- **THEN** the account read that follows the command is admitted ahead of the remaining history requests

#### Scenario: The desk keeps trading while a review is under way
- **WHEN** the operator works orders continuously while a history fan-out is in flight
- **THEN** each queued history request is passed over only within the bound, and the fan-out still completes

#### Scenario: Fills arrive faster than the review can fold
- **WHEN** execution reports arrive in a burst while the closed-rounds review is on screen
- **THEN** the working-order surfaces apply every report at the commit cadence while the review fold recomputes at most once per its stated bound, and it catches up when the burst ends

#### Scenario: The operator opens one view of the history
- **WHEN** the operator opens the closed-position history
- **THEN** the fills of the contracts in the fan-out are read and the order log is not, until the order-history view is opened

#### Scenario: The operator switches to the view that has not been read
- **WHEN** the operator opens the order-history view after the closed-position view has loaded
- **THEN** the fills already loaded stay on screen while the order log is read, and neither view is emptied by the other's read
