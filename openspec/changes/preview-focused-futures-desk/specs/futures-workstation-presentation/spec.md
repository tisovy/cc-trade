## ADDED Requirements

### Requirement: Structural color is distinct from trading risk
The futures workstation SHALL use neutral dark surfaces and borders for layout,
and a calm non-red accent for ordinary selection, focus, and active workspace
identity. Red SHALL be reserved for sell direction, negative performance,
liquidation risk, destructive controls, unavailable or disconnected state, and
errors. Positive outcomes SHALL remain green and cautionary state SHALL remain
amber so ordinary navigation cannot be mistaken for trading risk.

#### Scenario: Operator selects an ordinary control
- **WHEN** the operator selects a recent contract, chart interval, or display-only chart tool
- **THEN** the control uses the calm interaction accent rather than the red negative-state color

#### Scenario: Negative and positive readings are shown together
- **WHEN** the workstation renders a loss or sell state beside a profitable or buy state
- **THEN** the former remains red, the latter remains green, and neither color is reused by surrounding panel borders

#### Scenario: Workstation structure is rendered
- **WHEN** the futures desk draws its shell, panel separators, and inactive surfaces
- **THEN** those structural elements use neutral slate tones rather than a saturated red outline

### Requirement: The portfolio dock can yield space to the chart
The lower portfolio dock SHALL open in its current expanded state and expose an
accessible control that collapses both dock panels into one compact summary row
for the current session. The collapsed row SHALL retain the positions count,
working-orders count, total unrealized PnL, and an expand control while removing
the full tables from layout so the chart and market rails receive the released
height. Collapsing and expanding SHALL NOT mutate account data or reset the
selected order view.

#### Scenario: Operator collapses the expanded dock
- **WHEN** the operator activates the collapse control
- **THEN** both full dock panels yield their layout height and one compact row states positions, working orders, and total unrealized PnL

#### Scenario: Operator expands the compact dock
- **WHEN** the operator activates the expand control after changing the dock's order view before collapse
- **THEN** the full dock returns with the same order view, positions, orders, and account readings it held before collapse

#### Scenario: A new workstation session starts
- **WHEN** the futures workstation mounts in a new session
- **THEN** the portfolio dock starts expanded and no collapsed preference is restored from storage
