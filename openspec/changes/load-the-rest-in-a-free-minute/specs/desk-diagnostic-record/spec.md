## ADDED Requirements

### Requirement: A parked contract and a lazy wake are lines
When a held session that is not shown is parked, the record SHALL carry a
fault line under phase `park` with the reason and the contract. When the
warmer rebuilds a parked session, the record SHALL carry a timing line
under phase `lazy-bootstrap` with the outcome and the contract. Counts,
codes and names only.

#### Scenario: A background contract is parked
- **WHEN** a held session that is not shown loses its stream
- **THEN** the record carries `fault { phase: 'park', code, symbol }` and no `bootstrap` timing for it

#### Scenario: A free minute wakes a contract
- **WHEN** the warmer rebuilds a parked session
- **THEN** the record carries `timing { phase: 'lazy-bootstrap', outcome, symbol }`

### Requirement: A crossing is one evidence line
A crossed book SHALL leave exactly one evidence line, raised where the
crossing was found, carrying the book's last update identity as it stood
before the diff that crossed it. A recovery round begun for that crossing
SHALL NOT restate the evidence on its own fault line; a crossing found
inside a recovery round SHALL raise its own. On 2026-09-03 the summary
read two crossings for one, because the round restated the evidence it was
handed.

#### Scenario: A diff crosses a live book
- **WHEN** a chained diff crosses the book and a recovery round starts
- **THEN** one evidence line is written, under the stream phase, with the identity the book held before the diff, and the round's fault line carries none

#### Scenario: The snapshot's own bridge crosses
- **WHEN** a crossing is found while a recovery round bridges its snapshot
- **THEN** that crossing's evidence is written under the round's phase

### Requirement: The summary counts what it lists once and names the exchange's refusals
The summary tool SHALL count crossings from their evidence lines, one per
crossing, and SHALL list the exchange's own refusals — requests answered
`429` or `418` — by route, with their count. A day with none SHALL say so.

#### Scenario: One crossing, one round
- **WHEN** the journal carries one crossing's evidence line and the fault lines of the round that followed
- **THEN** the summary counts one crossing for that contract

#### Scenario: The exchange refused a request
- **WHEN** a request line carries status `429` or `418`
- **THEN** the summary lists it under the exchange's refusals with its route
