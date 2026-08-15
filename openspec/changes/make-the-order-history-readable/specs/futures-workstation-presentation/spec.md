## ADDED Requirements

### Requirement: A review takes the width it needs
While a history view is selected, it SHALL occupy the full width of the dock
rather than sharing it, and the panel it displaces SHALL return when a live view
is selected again. No column of a table the desk renders SHALL require
horizontal scrolling to be read at a supported width.

#### Scenario: A history view is selected
- **WHEN** the operator selects the order history or the closed positions
- **THEN** the review occupies the whole dock width

#### Scenario: A live view is selected again
- **WHEN** the operator selects the working orders
- **THEN** the dock returns to showing the live panels side by side

#### Scenario: A table is rendered at a supported width
- **WHEN** any dock table is rendered at a width the workspace supports
- **THEN** every column it declares is within the visible area
