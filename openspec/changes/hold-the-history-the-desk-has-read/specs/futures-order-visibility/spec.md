## ADDED Requirements

### Requirement: The account review is read once and then held
The account order and trade history SHALL be read from the exchange when the
Futures workspace opens, and afterwards only on an explicit operator request.
Selecting a history view, returning to a view already selected, changing the
selected contract, or re-entering the workspace SHALL render from the held
reading and SHALL issue no exchange read.

#### Scenario: The operator switches between history views
- **WHEN** the operator selects the order history and then the closed positions, having already loaded the history
- **THEN** both views render from the held reading and no account history request is sent

#### Scenario: The operator asks for a refresh
- **WHEN** the operator uses the refresh control on the history panel
- **THEN** one account history read is issued

#### Scenario: The contract on screen changes
- **WHEN** the operator selects a different contract while a history view is open
- **THEN** the held reading continues to be shown, because it spans the account rather than the contract

### Requirement: A refresh replaces the reading rather than removing it
While a history read is in flight the previously held rows SHALL remain on
screen, marked as being refreshed. They SHALL be replaced only when an answer
arrives. When the read fails the held rows SHALL remain, with the failure stated
beside them rather than in place of them.

#### Scenario: A refresh is in flight
- **WHEN** a history read has been issued and has not yet answered
- **THEN** the rows already read stay on screen and are marked as being refreshed

#### Scenario: A refresh fails
- **WHEN** a history read fails
- **THEN** the held rows remain readable and the failure is stated alongside them

#### Scenario: Nothing has ever been read
- **WHEN** no history reading is held and one is in flight
- **THEN** the panel states that it is loading, because there is nothing to hold

### Requirement: The held review is maintained by the stream
An order reaching a terminal state and a fill reported on the Futures user-data
stream SHALL be folded into the held history, so that the review reflects them
without an exchange read. A folded entry SHALL be identified by the same order
and trade identities the read uses, so the same event cannot appear twice.

#### Scenario: An order is filled while the review is held
- **WHEN** an order reaches a terminal state on the user-data stream and the history has been read
- **THEN** it appears in the order review without a further exchange read

#### Scenario: The same order is then read again
- **WHEN** a subsequent read returns an order already folded in from the stream
- **THEN** it appears once, not twice

#### Scenario: A position is closed while the review is held
- **WHEN** fills that close a position arrive on the user-data stream
- **THEN** the closed-position review reflects the closed position without a further exchange read

### Requirement: The review states how old it is
A held history reading SHALL state when it was taken, so that a reading held
from earlier in the session is not read as one taken just now.

#### Scenario: The review has been open for some time
- **WHEN** the operator opens a history view whose reading was taken earlier
- **THEN** the panel states when the reading was taken
