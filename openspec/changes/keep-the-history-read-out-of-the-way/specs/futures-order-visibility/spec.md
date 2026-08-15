## ADDED Requirements

### Requirement: A review never delays the desk learning what its order did
An operator-triggered history read SHALL NOT hold up the account read that
follows a mutating command. Where both contend for the same rate-limited
admission queue, the read that follows a mutation SHALL be admitted first, and a
history fan-out already in flight SHALL NOT have to finish before it.

A history read SHALL fetch the endpoint the view it is answering needs, rather
than every endpoint the panel could show. The other view SHALL read what it needs
when it is opened.

#### Scenario: An order is worked while a review is loading
- **WHEN** the operator opens the account history and places or cancels an order before the fan-out has finished
- **THEN** the account read that follows the command is admitted ahead of the remaining history requests

#### Scenario: The operator opens one view of the history
- **WHEN** the operator opens the closed-position history
- **THEN** the fills of the contracts in the fan-out are read and the order log is not, until the order-history view is opened
