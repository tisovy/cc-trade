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

### Requirement: A read replaces only the contracts it covered
The account history read is a fan-out over a bounded set of contracts, and a
contract may drop out of it — its request failed, the discovery that names it ran
short, or it no longer holds a position or working order to seed it. Rows held
for a contract the read did not cover SHALL be kept, and rows for a contract it
did cover SHALL be replaced by what it returned. The panel's statement of how
many contracts the review covers SHALL count only contracts that were read.

#### Scenario: A later read does not reach a contract the review holds rows for
- **WHEN** an account history read returns without covering a contract whose rows are already held
- **THEN** those rows remain in the review, and the closed position they describe is still listed

#### Scenario: A read covers a contract and returns fewer rows for it
- **WHEN** an account history read covers a contract and does not return a row previously held for it
- **THEN** that row is dropped, because the read is the authority on the contract it covered

### Requirement: Contract discovery reaches the session being reviewed
The read that names which contracts the account traded SHALL cover the most
recent part of its window before the rest of it, so that a bounded walk reaches
the contracts traded today rather than those traded at the far end of the window.
Where the walk stops short, the review SHALL state that more may have been
traded.

#### Scenario: The account realized more rows than the walk is bounded to
- **WHEN** the account has more realized-PnL rows in the window than the discovery walk can page through
- **THEN** the contracts traded most recently are the ones discovered, and the review states that the discovery was not complete

### Requirement: A closed position is what was actually closed
Fills SHALL be folded into positions without inventing one. Where a fill reduces
more than the fills in hand show is held, and what the exchange reports it
realized does not account for a reversal, the fill SHALL be read as closing a
position opened before this window of fills rather than as opening one in the
opposite direction. The entry price of such a position SHALL be the one the
exchange's realized PnL states.

#### Scenario: The window of fills opens while a position is already held
- **WHEN** the operator adds to a position opened before the read's window and then closes all of it
- **THEN** the review shows one closed position of the whole size, and no position in the opposite direction

#### Scenario: The position really did reverse
- **WHEN** a fill reduces past flat and its realized PnL accounts for closing exactly what was held
- **THEN** the review shows the position closed and the opposite one opened
