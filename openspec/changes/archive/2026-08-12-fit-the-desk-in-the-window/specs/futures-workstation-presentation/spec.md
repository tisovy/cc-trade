## ADDED Requirements

### Requirement: The workspace fits the window it is given
The Futures workspace SHALL lay out within the height and width of its window
without the page itself scrolling, at every window size the desk supports. A
panel that cannot show all of its content SHALL reduce what it shows rather than
clip it behind a scrollbar it does not own.

#### Scenario: A short window
- **WHEN** the workspace is rendered in a window shorter than its preferred layout
- **THEN** the page does not scroll, and every panel remains readable at the reduced size

### Requirement: No panel is drawn over another
Every panel of the workspace SHALL be contained within the area the layout gives
it. No panel SHALL declare a minimum size that the layout cannot satisfy, and no
panel's content SHALL be painted across the panel below or beside it, at any
window size the desk supports.

#### Scenario: The window leaves the order book less height than it prefers
- **WHEN** the window is short enough that the order book's preferred height does not fit its row
- **THEN** the book shows fewer levels within its own area, and nothing of it is drawn over the aggregate-trade tape

#### Scenario: A table is wider than the panel holding it
- **WHEN** a portfolio dock table's columns need more width than its panel has
- **THEN** the table's own tracks are what give way, and the panel itself neither scrolls nor overflows

### Requirement: The market header never hides the contract's numbers
The market header SHALL present the last price, the day's change, high, low and
volume, and the funding readings, without any of them being placed outside the
visible area of the header.

#### Scenario: The header is given less height than its content prefers
- **WHEN** the grid gives the header less height than its content
- **THEN** the header's values remain visible, and the header does not scroll

### Requirement: Scrolling belongs to the unbounded lists
Only the contract list, the aggregate-trade tape and the portfolio dock's tables
SHALL scroll. The instrument rail as a whole, the trading ticket, the market
header, the chart column and the order book SHALL NOT introduce a scrollbar of
their own.

#### Scenario: The rail holds more than fits
- **WHEN** the contract list is longer than the rail is tall
- **THEN** the list scrolls inside itself and the trading ticket below it stays in place
