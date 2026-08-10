## ADDED Requirements

### Requirement: The desk holds several contracts and shows one
The workstation service SHALL be able to hold more than one contract's session
at a time, each with its own streams, order book, timers and state. Selecting a
contract SHALL select which held session is delivered to the renderer, and SHALL
start a session only for a contract that is not already held.

#### Scenario: The operator returns to a contract they just left
- **WHEN** the operator selects a contract whose session is still held
- **THEN** its current state is delivered without a new bootstrap, and the workspace does not pass through `loading`

#### Scenario: The operator selects a contract for the first time
- **WHEN** the operator selects a contract that is not held
- **THEN** a session for it is started, and the sessions already held are unaffected

### Requirement: The pool is bounded and the background is cheap
The number of held sessions SHALL be bounded, and the least recently shown
session SHALL be released when the bound is reached. A held session that is not
being shown SHALL NOT carry the depth diff stream; it SHALL gain its book when
it is selected, from a snapshot rather than from a new generation.

#### Scenario: The bound is reached
- **WHEN** the operator has shown more contracts than the pool holds
- **THEN** the least recently shown session is released in full, and the rest keep running

#### Scenario: A background contract is shown again
- **WHEN** a held-but-not-shown contract is selected
- **THEN** its depth stream is opened and its book bootstrapped, without re-reading what the session already holds

### Requirement: A failure belongs to its own session
A resynchronization, a refused frame or a lost socket SHALL affect only the
session it occurred on. Other held sessions, and the delivery of the shown
session when it is not the failing one, SHALL continue.

#### Scenario: A background session loses its connection
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the shown contract's data continues uninterrupted
