## ADDED Requirements

### Requirement: An execution report withdraws only the action it proves

Renderer warning state SHALL require matching order identity and the held command's action-specific postcondition before treating execution traffic as an answer. Expected amendment terms SHALL accompany the unresolved command. Named outcome envelopes SHALL NOT settle another action on the same order. Terminal non-cancellation outcomes SHALL remain explicitly explained.

#### Scenario: A matching working report arrives during cancellation uncertainty

- **WHEN** the renderer receives NEW for the same order whose cancellation is unconfirmed
- **THEN** its order state updates but its cancellation warning is retained

#### Scenario: A delayed private event proves cancellation

- **WHEN** matching CANCELED arrives after bounded reads remained inconclusive
- **THEN** only that cancellation's warning is cleared and no command is replayed

#### Scenario: Another action on the same order answers

- **WHEN** a named placement resolution arrives while cancellation of the same order is unresolved
- **THEN** the cancellation warning is not cleared by that envelope

#### Scenario: Same-batch Spot uncertainty and answer

- **WHEN** an unresolved Spot command and its confirming private event arrive before a React render
- **THEN** the combined outcome state applies both in order without retaining a stale warning or losing a terminal explanation
