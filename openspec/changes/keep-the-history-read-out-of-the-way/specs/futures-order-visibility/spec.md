## ADDED Requirements

### Requirement: A review never delays the desk learning what its order did
An operator-triggered history read SHALL NOT hold up the account read that
follows a mutating command. Where both contend for the same rate-limited
admission queue, the read that follows a mutation SHALL be admitted first, and a
history fan-out already in flight SHALL NOT have to finish before it.

Overtaking SHALL be bounded. A request already queued SHALL be passed over only
a bounded number of times, so that a history fan-out under way still finishes
however much the operator trades over it.

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

#### Scenario: The operator opens one view of the history
- **WHEN** the operator opens the closed-position history
- **THEN** the fills of the contracts in the fan-out are read and the order log is not, until the order-history view is opened

#### Scenario: The operator switches to the view that has not been read
- **WHEN** the operator opens the order-history view after the closed-position view has loaded
- **THEN** the fills already loaded stay on screen while the order log is read, and neither view is emptied by the other's read
