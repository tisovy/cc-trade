## MODIFIED Requirements

### Requirement: Orders the stream does not report are read on their own beat
Order kinds the authenticated stream does not report — the algorithmic orders
the desk lists and cancels but cannot place — SHALL be read on the periodic
reconciliation and on an operator-requested refresh, and SHALL NOT be read in
response to an execution report or a position change.

Where the authenticated stream does report an algorithmic order, the desk SHALL
apply what it reports to the listed algorithmic orders, on the frame that
carried it and without reading the account back to learn what it was just told.

The periodic beat SHALL remain regardless, as the backstop it already is, and
the read issued after an algorithmic command SHALL remain until delivery of such
an event has been observed on the operator's own account. A documented event
whose delivery has not been seen SHALL NOT be grounds for removing a read the
desk depends on.

#### Scenario: A fill arrives while an algorithmic order rests
- **WHEN** an execution report arrives for a regular order and an algorithmic order is listed
- **THEN** no algorithmic-order read is issued, and the listed algorithmic order stays as last read

#### Scenario: The operator asks for a refresh
- **WHEN** the operator requests an account refresh
- **THEN** the algorithmic orders are read again alongside the regular ones

#### Scenario: The stream reports an algorithmic order
- **WHEN** the authenticated stream delivers an algorithmic-order update for a listed algorithmic order
- **THEN** the listed order is updated from that frame, and no account read is issued because of it

#### Scenario: The stream has never been seen to report one
- **WHEN** the desk can fold such an event but has not observed one arriving on this account
- **THEN** the periodic beat and the post-command read both stay exactly as they are
