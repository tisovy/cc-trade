## ADDED Requirements

### Requirement: A resync redraws every candle it corrected
When a re-read of the candle series is applied, the chart SHALL determine
whether any candle changed, not only whether the series has the same length and
the same first and last open time. A change to an interior candle SHALL reach
the canvas.

#### Scenario: An interior candle was corrected
- **WHEN** a re-read returns a series of the same length and endpoints in which an interior candle's values differ
- **THEN** the chart is updated with the corrected candle

#### Scenario: Only the last candle moved
- **WHEN** a re-read differs only in the newest candle
- **THEN** the chart takes the cheap path and updates that candle alone

### Requirement: Futures chart history is bounded in the renderer
The renderer SHALL bound the candle series it holds for a contract and interval
to the same ceiling the disk cache applies, dropping the oldest rows when older
pages arrive beyond it.

#### Scenario: Many history pages are paged in
- **WHEN** the operator scrolls far enough left to exceed the ceiling
- **THEN** the held series stays at the ceiling, keeping the rows nearest the live end
