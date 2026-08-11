## ADDED Requirements

### Requirement: The shared market rail prioritizes the order book
At supported desktop window sizes where the order book and aggregate-trade tape
share one vertical market rail, the workstation SHALL allocate 65 percent of
their combined panel height to the order book and 35 percent to the tape. The
split SHALL remain stable as live rows arrive, disappear, or update, and neither
panel SHALL paint or scroll into the other's allocation.

#### Scenario: Desktop market rail is laid out
- **WHEN** the workstation renders the order book above the aggregate-trade tape in their shared desktop rail
- **THEN** the order-book panel receives 65 percent and the tape receives 35 percent of the height allocated to the pair, excluding only the separator between them

#### Scenario: Live market data changes row counts
- **WHEN** book levels or aggregate trades arrive, update, or disappear
- **THEN** the 65/35 panel split remains unchanged and each panel contains its own rows

### Requirement: Market-data and portfolio scrollbars stay compact
The aggregate-trade list and every scrollable portfolio-dock table SHALL use a
workstation-themed scrollbar whose vertical width and horizontal height are no
greater than 6 CSS pixels. The track SHALL not introduce light native chrome or
arrow buttons, while the thumb SHALL remain visibly distinct from the track and
gain emphasis on hover. Styling SHALL preserve wheel, touchpad, keyboard, thumb
dragging, and any required horizontal scrolling behavior.

#### Scenario: Aggregate trades overflow vertically
- **WHEN** the aggregate-trade list contains more rows than its 35-percent panel allocation can show
- **THEN** it remains vertically scrollable through a compact scrollbar no wider than 6 CSS pixels, without native arrow-button chrome

#### Scenario: A portfolio table overflows
- **WHEN** a positions, working-orders, or history table exceeds its available vertical or horizontal space
- **THEN** each required axis remains scrollable through compact workstation-themed chrome no thicker than 6 CSS pixels

#### Scenario: Operator points at the scrollbar thumb
- **WHEN** the pointer hovers a compact scrollbar thumb
- **THEN** the thumb becomes more prominent without changing the list's dimensions or scroll position
