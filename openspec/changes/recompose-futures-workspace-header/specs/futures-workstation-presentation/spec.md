## ADDED Requirements

### Requirement: The Futures identity strip owns the top of the workspace
While the Futures workspace is active, its blue `USDⓈ-M FUTURES` identity strip SHALL be the first visible workspace surface at the top edge of the window, with no production-red backdrop or empty chrome above it. The Spot/Futures market switch SHALL be centered as an absolute overlay on that strip so its controls hang down across the strip without changing the strip's height. The identity, live/synchronization state, market-switch controls, and interface-scale controls SHALL remain legible, operable, and non-overlapping at supported desktop widths; at narrower responsive widths the strip MAY grow or wrap to preserve those properties.

#### Scenario: Futures workspace reaches its first frame
- **WHEN** an active Futures workspace is rendered at a supported desktop width
- **THEN** the blue identity strip begins at the top edge, no red background appears above it, and the centered market switch overlays the strip

#### Scenario: Header controls share the identity strip
- **WHEN** the identity, workspace state, market switch, and interface-scale controls are all visible
- **THEN** each remains readable and operable without one control covering another

#### Scenario: The active workspace is narrow
- **WHEN** the Futures workspace renders below the desktop breakpoint
- **THEN** its top strip may wrap or increase in height while the identity, state, market switch, and scale controls remain usable

## MODIFIED Requirements

### Requirement: The active workspace keeps local time in sight
While a Spot or Futures workspace is active, the application SHALL present a centered local clock as part of the active interface. In Spot the clock SHALL remain immediately beneath the market-mode switch. In Futures the clock SHALL occupy a dedicated centered row immediately beneath the blue identity strip and its overlaid market switch. The Futures row SHALL reserve its own layout space so the clock does not cover the market header, instrument rail, or another workspace control. The clock SHALL use the host system's local time, SHALL show an English abbreviated weekday and month with day, hour, minute, and second in the form `Sat 15 Aug 15:00:56`, and SHALL advance through seconds without requiring market data or operator interaction. Its fixed-width numeric presentation SHALL not displace the mode switch or adjacent workspace controls as the value changes.

#### Scenario: An active workspace is mounted
- **WHEN** credential preflight has completed and either Spot or Futures is the active workspace
- **THEN** a centered in-interface clock is visible and states the current local weekday, day, month, hour, minute, and second

#### Scenario: An active Futures workspace is mounted
- **WHEN** credential preflight has completed and Futures is the active workspace
- **THEN** a centered clock is visible in a reserved interface row beneath the blue identity strip and states the current local weekday, day, month, hour, minute, and second

#### Scenario: An active Spot workspace is mounted
- **WHEN** credential preflight has completed and Spot is the active workspace
- **THEN** a centered clock remains visible immediately beneath the market-mode switch and states the current local weekday, day, month, hour, minute, and second

#### Scenario: Local time advances
- **WHEN** the host system clock advances to the next second while the workspace remains mounted
- **THEN** the visible clock advances to that local second without a market frame or operator action

#### Scenario: The clock crosses a calendar boundary
- **WHEN** local time advances into a new day or month
- **THEN** the weekday, day, month, and time are all recomputed from the host system clock rather than incrementing only the displayed seconds
