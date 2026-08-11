## ADDED Requirements

### Requirement: The account review survives a restart
Orders and trades that have reached a terminal state SHALL be stored locally per
contract, together with the window the stored rows are known to cover. On launch
the review SHALL be presented from the store before any exchange read is issued.
The store SHALL be bounded per contract, SHALL hold only terminal rows, and a
store that is unavailable or unreadable SHALL degrade to reading from the
exchange rather than failing the review.

#### Scenario: The desk is reopened
- **WHEN** the operator opens the history panel in a new run and rows were stored in an earlier one
- **THEN** they are presented from the store, stamped with when they were read, before any request is sent

#### Scenario: The store cannot be opened
- **WHEN** the local store is unavailable
- **THEN** the review is read from the exchange exactly as it is without a store

### Requirement: A history read asks only for what is missing
A history read SHALL ask each contract for the rows after the ones already held
rather than for the whole window, using the identity the exchange pages from. A
contract whose held rows the authenticated stream has kept current SHALL NOT be
read at all, and a stream disconnection SHALL end that assumption for every
contract. A bounded rotation SHALL re-read contracts that have been skipped, so
a missed event cannot hide indefinitely.

#### Scenario: A contract traded since the last read
- **WHEN** the operator refreshes the review and a contract has had fills since the last read
- **THEN** that contract is read forward from the last row already held, not from the start of the window

#### Scenario: A contract that has not moved
- **WHEN** the operator refreshes the review, the stream has been connected throughout, and a contract has had no activity since the last read
- **THEN** no read is issued for that contract and its held rows are presented unchanged

#### Scenario: The stream was disconnected
- **WHEN** the authenticated stream dropped since the last read
- **THEN** the next refresh reads every contract the review covers, because nothing can vouch for what happened while it was down

### Requirement: Contract discovery is asked only when the store cannot answer
The income walk that names which contracts the account traded SHALL be issued
when the store names none, when what it names has aged past the review's window,
or when the operator asks for a full re-read. A refresh the store can answer
SHALL issue no income read.

#### Scenario: The store names the contracts
- **WHEN** the operator refreshes the review and the store holds contracts within the window
- **THEN** the fan-out covers them and no income read is issued

#### Scenario: The operator asks for a full re-read
- **WHEN** the operator asks for the review to be read in full
- **THEN** discovery runs and every contract it names is read across the whole window
