## ADDED Requirements

### Requirement: A margin call is stated on the position it names
When the exchange sends a margin call, the desk SHALL state it on the position
rows the frame names, beside the liquidation price already drawn there, and
SHALL NOT state it on positions the frame does not name. A liquidation price the
desk computed is the desk's own reckoning; a margin call is the exchange saying
it, and the operator SHALL be able to tell the two apart.

The exchange sends no event for the risk passing. The statement SHALL therefore
be withdrawn only on the exchange's own account of the position it names —
closed, smaller than it was when the warning came, or with more margin walled off
behind it than there was. It SHALL NOT be withdrawn on a timer: a warning that
expires while the danger is still there is worse than one that was never made.
Because it can stand longer than the danger does, the statement SHALL carry when
the exchange sent it.

A margin call naming a set of positions SHALL NOT be read as an all-clear for a
position it does not name, since nothing in the frame says the exchange reports
every position at risk on every one.

The frame's position sizes, wallet balances and margin figures SHALL NOT reach
the diagnostic record, which already forbids money values.

#### Scenario: The exchange raises a margin call
- **WHEN** a margin call arrives naming one of several open positions
- **THEN** that position's row states it, and the other rows are unchanged

#### Scenario: The position is brought back
- **WHEN** margin is added to the named position, or it is reduced, or it is closed
- **THEN** the statement is withdrawn

#### Scenario: The position is unchanged and time passes
- **WHEN** the position the call names is still open at the same size and margin
- **THEN** the statement stands, showing when the exchange sent it

#### Scenario: The record is written
- **WHEN** a margin call is recorded in the desk's diagnostic journal
- **THEN** the entry carries that it happened and for which contract, and carries no size, balance or margin figure
