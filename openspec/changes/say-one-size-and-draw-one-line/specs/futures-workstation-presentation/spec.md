## ADDED Requirements

### Requirement: A resting order is drawn as a price, not as a band
A working order's line on the chart SHALL be drawn at the same weight as every
other price overlay the chart carries. A standing fact SHALL NOT be drawn heavier
than the candles it sits among: at two pixels against bars a few pixels wide it
reads as a band rather than as a level, and it covers the very bars trading at
the price the operator is watching when the order is about to fill.

A line drawn while an order is being *dragged* is exempt. That marks an action in
progress rather than a standing fact, and it is on screen only while the operator
is holding it.

#### Scenario: An order rests on the chart
- **WHEN** a working order is drawn at its price
- **THEN** its line is the same weight as the drawings, alerts, entry band and liquidation line around it, and the candles at that price stay readable

#### Scenario: An order is being dragged
- **WHEN** the operator lifts an order and drags it to a new price
- **THEN** the line following the pointer stays emphasized, because it is an action rather than a level
