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
operator-requested refresh, or the periodic beat. The periodic read SHALL run
while orders are working and SHALL stop while none are, so that a desk holding
nothing spends no weight on it.

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

#### Scenario: No message reports a settlement
- **WHEN** orders are working and no execution report or snapshot arrives
- **THEN** the account is re-read without the operator asking, on a beat measured in tens of seconds

#### Scenario: Nothing is working
- **WHEN** the working-orders list is empty
- **THEN** no periodic read is sent at all

## ADDED Requirements

### Requirement: Orders the stream does not report are read on their own beat
Order kinds the authenticated stream does not report — the algorithmic orders
the desk lists and cancels but cannot place — SHALL be read on the periodic
reconciliation and on an operator-requested refresh, and SHALL NOT be read in
response to an execution report or a position change.

#### Scenario: A fill arrives while an algorithmic order rests
- **WHEN** an execution report arrives for a regular order and an algorithmic order is listed
- **THEN** no algorithmic-order read is issued, and the listed algorithmic order stays as last read

#### Scenario: The operator asks for a refresh
- **WHEN** the operator requests an account refresh
- **THEN** the algorithmic orders are read again alongside the regular ones
