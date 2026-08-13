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

### Requirement: A held session is a whole session, shown or not
A held session SHALL carry every stream it would carry while shown, including
the depth diff, and SHALL keep its order book, tape and candles current whether
or not it is the one being shown. Being shown SHALL decide only whether the
session delivers to the renderer.

#### Scenario: A held contract is selected
- **WHEN** the operator selects a contract whose session is held but not shown
- **THEN** its book, tape and candles are delivered as the session already holds them, with no snapshot read and no stream opened

#### Scenario: A held contract is not shown
- **WHEN** a held session is not the one being shown
- **THEN** it keeps parsing its streams and updating its state, and delivers nothing to the renderer

### Requirement: The pool is bounded
The number of held sessions SHALL be bounded by a stated setting, and the least
recently shown session SHALL be released in full when the bound is reached.

#### Scenario: The bound is reached
- **WHEN** the operator has shown more contracts than the pool holds
- **THEN** the least recently shown session is released in full, and the rest keep running

### Requirement: A failure belongs to its own session
A resynchronization, a refused frame or a lost socket SHALL affect only the
session it occurred on. Other held sessions, and the delivery of the shown
session when it is not the failing one, SHALL continue.

#### Scenario: A background session loses its connection
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the shown contract's data continues uninterrupted

#### Scenario: A session that failed unwatched is selected
- **WHEN** a held session lost its stream or fell out of sync while it was not being shown, and the operator selects it
- **THEN** it is delivered in the state it is actually in, rather than as current
