## ADDED Requirements

### Requirement: A request line names its route
Every physical Binance Futures attempt the record keeps SHALL name the route it
was sent on, from a closed vocabulary of the desk's own — the account, the
balances, the positions, the working orders, the algorithmic orders, an order
placement, a cancellation, an amendment, a cancel-all, a margin adjustment, the
income record, order history, trade history, a contract's configuration, its
leverage brackets, the position mode, the listen key, the clock, klines, or
`other`. The route SHALL carry no path, query, host or identifier. On
2026-09-02 two thousand weight-5 lines could be attributed only by their
cadence, and the reader that cost a third of the evening's weight had no line
of its own.

#### Scenario: A history page is sent
- **WHEN** the history reader sends a page of a contract's trades
- **THEN** the request line names the trade-history route and its charged weight, and nothing of the path

#### Scenario: An endpoint the vocabulary does not name
- **WHEN** an attempt is sent on a route the vocabulary does not name
- **THEN** the line reads `other` rather than being dropped or carrying the path

#### Scenario: The evening's weight by route
- **WHEN** the summary is run against a day
- **THEN** it reports charged weight per route, so the reader that spent the window can be named without pattern-matching

## MODIFIED Requirements

### Requirement: The record states when the desk made itself wait
Where the desk holds one of its own requests back against a self-imposed budget
rather than against a refusal from the exchange, it SHALL record that it did so.
The line SHALL state how long the request waited, the weight it asked for, how
much of the window was already spent when it was first turned away, the ceiling
it was measured against, and whether the request was the operator's command,
a read the operator's command was waiting on, or the desk's own housekeeping.

A trading command SHALL produce a wait line only when the exchange's own limit
held it — its observed used weight within the stated margin, or its stated
backpressure — never for a ceiling of the desk's own, because no such ceiling
binds a command.

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

#### Scenario: A trading command waits for the exchange
- **WHEN** a cancellation is held because the exchange's observed used weight is within the stated margin of its limit
- **THEN** the record carries one line with the command's standing, the wait, and the spend it was held at

#### Scenario: A trading command at the desk's own ceiling
- **WHEN** the desk's urgent ceiling is spent and a placement is sent
- **THEN** the placement is admitted and no wait line is written for it

### Requirement: Refusals can be counted by their cause

The summary over a day of the record SHALL report how many commands each
refusal cause accounts for — the code the exchange gave, or, for a refusal the
desk issued itself, the condition the desk named — so that a run of refusals
can be read as one cause or as several without opening the record itself.
Desk-named conditions SHALL NOT be folded into one "no exchange code" bucket.

A command the renderer withheld before it reached the main process SHALL be
recorded as an outcome of its own, with the command it would have been and the
condition that withheld it, and the summary SHALL count withholdings apart from
refusals. A refusal for a quantity exceeding the open leg SHALL carry the ratio
of the requested size to the leg as a bounded count in basis points, and neither
amount.

#### Scenario: An evening of refused orders

- **WHEN** the summary is run against a day in which several commands were refused
- **THEN** it reports the refusals grouped by the exchange's code or the desk's named condition, and how many commands each accounts for

#### Scenario: Desk refusals with different named conditions

- **WHEN** the summary is run against a day in which the desk refused commands for more than one named condition
- **THEN** each condition is its own count, named with its market, and none of them is reported as a refusal the exchange left uncoded

#### Scenario: An exit the renderer withheld

- **WHEN** the ticket withholds an exit for a readiness condition
- **THEN** the record carries an outcome line for the placement with result `withheld` and the readiness code, and the summary counts it apart from the exchange's and the desk's refusals

#### Scenario: A quantity refusal is read from its line

- **WHEN** a reduce-only order is refused for exceeding the leg
- **THEN** the outcome line carries the requested-to-leg ratio in basis points, and no size or amount
