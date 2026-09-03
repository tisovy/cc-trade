## ADDED Requirements

### Requirement: A wide Futures workspace uses the available viewport
The production Futures workstation SHALL expand through the usable width of its page instead of stopping at a fixed desktop maximum. The page SHALL retain a responsive edge inset, SHALL keep the workstation inside the viewport at every supported width, and SHALL NOT introduce page-level horizontal scrolling; panel-owned overflow behavior SHALL remain unchanged.

#### Scenario: The application window is wider than the former desktop cap
- **WHEN** the Futures workspace is rendered in a window with more usable width than its content previously accepted
- **THEN** the workstation grows to fill the usable width and the extra space is allocated by its responsive columns instead of remaining as large outer gutters

#### Scenario: The application window is width constrained
- **WHEN** the viewport narrows toward a supported responsive breakpoint
- **THEN** the workstation remains inside the page edge inset and the page has no horizontal scrollbar or content beyond the viewport

#### Scenario: A child panel owns local overflow
- **WHEN** a bounded list or table needs its existing local scrollbar
- **THEN** that scrollbar remains local to the panel and widening the page does not replace it with page-level horizontal scrolling

### Requirement: The selected contract stays inside its header column
The Futures market header SHALL reserve a scale-aware contract-identity column wide enough to present ordinary long contract symbols without crossing the divider or covering the adjacent market readings. The identity SHALL remain contained within its allocation when a symbol is longer than the reserved single-line width.

#### Scenario: An ordinary long contract is selected
- **WHEN** the operator selects `USELESSUSDT` at the configured interface scale
- **THEN** the complete symbol remains on one line inside the identity column with visible space before the divider and last-price reading

#### Scenario: A contract name exceeds the reserved single-line width
- **WHEN** a selected contract identity is wider than the scale-aware header allocation
- **THEN** the identity remains inside its column instead of painting across the divider or an adjacent market reading
