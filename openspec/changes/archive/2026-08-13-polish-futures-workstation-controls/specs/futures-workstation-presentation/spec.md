## ADDED Requirements

### Requirement: Chart tools fit without a toolbar scrollbar
The chart toolbar SHALL present its interval choices and all four display-only
drawing and alert actions within the visible chart width at supported desktop
workstation sizes without introducing a horizontal scrollbar. Each chart action
SHALL use a compact recognizable icon while retaining its complete accessible
name, explanatory pointer title, pressed state where applicable, and disabled
state.

#### Scenario: Desktop chart toolbar is width constrained
- **WHEN** the chart column is rendered at its narrowest supported desktop width
- **THEN** every interval and chart-tool action remains visible in one toolbar row and the toolbar has no horizontal scrollbar

#### Scenario: Operator reads an icon-only chart action
- **WHEN** the operator focuses or points at a drawing or alert action
- **THEN** the complete action name remains available to assistive technology and as a pointer title even though the visible control is an icon

#### Scenario: Chart action availability changes
- **WHEN** a drawing, draft price, or display alert makes a chart action available or unavailable
- **THEN** the matching icon control preserves the same pressed or disabled state and invokes the same display-only action

## MODIFIED Requirements

### Requirement: Scrolling belongs to the unbounded lists
Only the recent-contract group, searchable contract list, execution-ticket body,
aggregate-trade tape and portfolio dock's tables SHALL scroll. The ticket body
MAY scroll only when the ticket is taller than the rail allocation, while the
ticket tabs and the instrument rail stay in place. The instrument rail as a
whole, the execution ticket as a whole, the market header, the chart column and
the order book SHALL NOT introduce a scrollbar of their own.

#### Scenario: The rail holds more than fits
- **WHEN** a recent or searchable contract list is longer than the rail is tall
- **THEN** that list scrolls inside itself and the trading ticket below it stays in place

#### Scenario: The ticket body is taller than its allocation
- **WHEN** the ticket fields and actions need more height than the instrument rail can allocate to them
- **THEN** only the ticket body scrolls, its tabs remain visible, and every order action remains reachable

### Requirement: Market-data and portfolio scrollbars stay compact
Every scrollable recent-contract group, searchable contract list,
execution-ticket body, aggregate-trade list and portfolio-dock table SHALL use a
workstation-themed scrollbar whose vertical width and horizontal height are no
greater than 6 CSS pixels. The track SHALL not introduce light native chrome or
arrow buttons, while the thumb SHALL remain visibly distinct from the track and
gain emphasis on hover. Styling SHALL preserve wheel, touchpad, keyboard, thumb
dragging, and any required horizontal scrolling behavior.

#### Scenario: A contract list overflows vertically
- **WHEN** a recent or searchable contract list contains more rows than its rail allocation can show
- **THEN** it remains vertically scrollable through compact workstation-themed chrome no wider than 6 CSS pixels

#### Scenario: The execution ticket body overflows vertically
- **WHEN** the execution ticket body contains more controls than its rail allocation can show
- **THEN** every control remains reachable through a compact scrollbar without light native track or arrow-button chrome

#### Scenario: Aggregate trades overflow vertically
- **WHEN** the aggregate-trade list contains more rows than its 35-percent panel allocation can show
- **THEN** it remains vertically scrollable through a compact scrollbar no wider than 6 CSS pixels, without native arrow-button chrome

#### Scenario: A portfolio table overflows
- **WHEN** a positions, working-orders, or history table exceeds its available vertical or horizontal space
- **THEN** each required axis remains scrollable through compact workstation-themed chrome no thicker than 6 CSS pixels

#### Scenario: Operator points at the scrollbar thumb
- **WHEN** the pointer hovers a compact scrollbar thumb
- **THEN** the thumb becomes more prominent without changing the list's dimensions or scroll position
