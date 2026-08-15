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

### Requirement: A failed futures history read leaves history loadable
A read of older candles that cannot be served SHALL be answered rather than
passed over in silence, and the answer SHALL name the read it belongs to. The
renderer SHALL release its in-flight read on that answer so the next scroll
issues a new one, SHALL leave the run on screen exactly as it was, and SHALL NOT
take the failure for the exchange saying there is nothing older. The operator
SHALL be told at the chart, and told until a read succeeds — a notice that
withdraws itself leaves the chart looking like a contract whose history ends
there.

#### Scenario: The exchange read fails
- **WHEN** the backend cannot serve a read of older candles
- **THEN** the failure is answered, the renderer's in-flight read is released, and the next scroll issues a new read

#### Scenario: The failure answers a read the chart moved on from
- **WHEN** a failure arrives naming a read other than the one being waited on
- **THEN** it is ignored and the read in flight is still in flight

#### Scenario: A page arrives after a failure
- **WHEN** a later read is served
- **THEN** the operator is no longer told that older candles could not be loaded

### Requirement: The bars the live window drops are kept behind it
The window of candles the stream re-sends is bounded and slides. The renderer
SHALL keep the closed candles that leave it, joined to the end of the history
already held, so the series drawn has no bar missing between the two. Rows that
do not continue what is held SHALL NOT be joined across the gap between them.

#### Scenario: A bar leaves the live window
- **WHEN** a bar opens and the oldest bar in the re-sent window is no longer in it
- **THEN** that bar is kept at the end of the held run and the drawn series stays continuous

#### Scenario: The window jumped rather than slid
- **WHEN** the window returns at a position that does not continue what is held
- **THEN** the rows that left are dropped rather than joined across the gap

### Requirement: Futures chart history is bounded in the renderer
The renderer SHALL bound the candle series it holds for a contract and interval
to the same ceiling the disk cache applies, dropping the oldest rows when older
pages arrive beyond it.

#### Scenario: Many history pages are paged in
- **WHEN** the operator scrolls far enough left to exceed the ceiling
- **THEN** the held series stays at the ceiling, keeping the rows nearest the live end
