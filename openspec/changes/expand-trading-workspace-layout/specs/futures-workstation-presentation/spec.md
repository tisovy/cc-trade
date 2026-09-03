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
