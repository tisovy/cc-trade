## ADDED Requirements

### Requirement: The order book marks its heaviest levels
The order book SHALL mark the five levels resting the most USDT on each visible
side, ranked over exactly the levels on screen so that changing the grouping
step or the side mode re-ranks with them. The mark SHALL apply to the size cell
alone: the level's price and its cumulative total SHALL read the same on a
marked level as on any other.

Levels resting an equal size SHALL be marked alike, and a side holding no more
levels than there are marks SHALL carry none, because marking every row states
nothing.

#### Scenario: A side holds a few heavy levels
- **WHEN** a visible side holds ten levels, five of which rest far more USDT than the others
- **THEN** those five have their size cell thickened, and their price and cumulative cells are unchanged

#### Scenario: Two levels rest the same size
- **WHEN** the fifth and sixth heaviest levels rest the same USDT
- **THEN** both are marked, rather than one being chosen over its equal

#### Scenario: The visible side is short
- **WHEN** a side shows no more levels than there are marks
- **THEN** no level is marked

#### Scenario: The operator regroups the book
- **WHEN** the grouping step changes which levels are on screen
- **THEN** the marks are recomputed over the levels now displayed
