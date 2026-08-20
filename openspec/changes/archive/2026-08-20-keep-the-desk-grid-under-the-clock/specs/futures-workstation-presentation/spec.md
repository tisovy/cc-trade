## MODIFIED Requirements

### Requirement: The active workspace keeps local time in sight
While a Spot or Futures workspace is active, the application SHALL present a centered local clock as part of the active interface. In Spot the clock SHALL remain immediately beneath the market-mode switch. In Futures the clock SHALL occupy a dedicated centered row immediately beneath the blue identity strip and its overlaid market switch. The Futures row SHALL reserve its own layout space so the clock does not cover the market header, instrument rail, or another workspace control. Reserving that row SHALL NOT displace the desktop layout it sits in: at desktop widths the chart and tape rows keep their proportional window-shared sizing, the portfolio dock remains fully inside the desk, and the desk's height budget subtracts only the page chrome that actually surrounds it. The clock SHALL use the host system's local time, SHALL show an English abbreviated weekday and month with day, hour, minute, and second in the form `Sat 15 Aug 15:00:56`, and SHALL advance through seconds without requiring market data or operator interaction. Its fixed-width numeric presentation SHALL not displace the mode switch or adjacent workspace controls as the value changes.

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

#### Scenario: The clock row and the desktop grid share one window
- **WHEN** the Futures workspace renders at or above the desktop breakpoint with the clock row present
- **THEN** the chart and tape rows keep their proportional shares of the window, the tape does not collapse to its content's height, and the portfolio dock ends at or above the desk's bottom edge rather than being clipped below it

#### Scenario: The desk fills the window it was given
- **WHEN** the Futures workspace renders at or above the desktop breakpoint
- **THEN** the desk's height equals the window minus the page's own padding, with no dead band between the dock and the bottom of the window
