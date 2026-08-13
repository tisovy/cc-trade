## ADDED Requirements

### Requirement: A margin call is stated on the position it names
When the exchange sends a margin call, the desk SHALL state it on the position
rows the frame names, beside the liquidation price already drawn there, and
SHALL NOT state it on positions the frame does not name. A liquidation price the
desk computed is the desk's own reckoning; a margin call is the exchange saying
it, and the operator SHALL be able to tell the two apart.

The statement SHALL stand for as long as it is true, and SHALL be withdrawn on
the account update that shows the position no longer warrants it — not on a
timer, and not on the next unrelated frame.

The frame's position sizes, wallet balances and margin figures SHALL NOT reach
the diagnostic record, which already forbids money values.

#### Scenario: The exchange raises a margin call
- **WHEN** a margin call arrives naming one of several open positions
- **THEN** that position's row states it, and the other rows are unchanged

#### Scenario: The position is brought back
- **WHEN** margin is added or the position reduced, and the account update shows it no longer warrants the call
- **THEN** the statement is withdrawn

#### Scenario: The record is written
- **WHEN** a margin call is recorded in the desk's diagnostic journal
- **THEN** the entry carries that it happened and for which contract, and carries no size, balance or margin figure
