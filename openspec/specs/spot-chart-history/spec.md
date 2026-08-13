# spot-chart-history Specification

## Purpose

Defines how the Spot chart merges, pages, and persists closed-candle history for
one pair and interval, so the operator can read beyond the live bootstrap window
without gaps, duplicates, viewport jumps, stale-selection pages, or repeated
exchange reads across a restart.

## Requirements
### Requirement: The chart opens on more than its live window
Opening a pair SHALL present the depth already held for that pair and interval
together with the live bootstrap window, as one series ordered by open time with
no duplicated or missing bar at the seam. The bootstrap window SHALL NOT replace
depth read for the same pair and interval, and its rows SHALL win any overlap
with older ones.

#### Scenario: A pair is opened with depth already stored
- **WHEN** the local store holds candles for the pair and interval and the bootstrap window arrives
- **THEN** the chart shows the stored run with the live window in front of it, ordered by open time

#### Scenario: The bootstrap window overlaps stored depth
- **WHEN** a bootstrap candle has the same open time as a stored one
- **THEN** the bootstrap row is kept and the stored duplicate is discarded

#### Scenario: The stored run belongs to another selection
- **WHEN** the rows held were read for a different pair or interval
- **THEN** they are discarded rather than joined, and the chart shows the live window alone

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the chart SHALL request
the page of closed candles behind it and prepend the result, moving the visible
range by as many bars as arrived so the bars the operator is reading stay in
place. Exactly one history request SHALL be in flight at a time. The requested
page size SHALL be bounded to what one klines read serves.

#### Scenario: The operator scrolls to the oldest loaded bar
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the oldest bar is reached again before the outstanding page arrives
- **THEN** no second request is issued

#### Scenario: The viewport is nowhere near the oldest bar
- **WHEN** the visible range sits well inside the loaded series
- **THEN** no history is requested

### Requirement: A read is never repeated
The chart SHALL stop requesting history for a pair and interval when the
exchange answers with fewer candles than were requested, and when a delivered
page does not extend the series — including because the series is at its bound.

#### Scenario: The pair's history has a start
- **WHEN** a page returns fewer candles than were requested
- **THEN** no further history is requested for that pair and interval

#### Scenario: The series is full to its ceiling
- **WHEN** a delivered page leaves the oldest loaded candle unchanged
- **THEN** no further history is requested for that pair and interval

### Requirement: History belongs to one pair, interval and read point
Loaded history SHALL be discarded when the pair or the interval changes, and a
delivered page SHALL be applied only when it matches the pair, interval and read
point of the request being held. The main process SHALL refuse to read history
for a selection the chart is no longer showing.

#### Scenario: The interval changes
- **WHEN** the operator switches from 15m to 1h
- **THEN** the 15m depth is discarded and the 1h chart shows no candle read under the previous interval

#### Scenario: A page arrives for an abandoned read point
- **WHEN** a page's pair, interval or read point is not the one the chart is holding
- **THEN** it is ignored and the drawn series does not change

#### Scenario: A request names a selection the channel does not hold
- **WHEN** a history request names a pair or interval other than the detail channel's
- **THEN** no exchange read is issued and no page is delivered

### Requirement: Loaded depth survives a restart
A closed candle SHALL NOT be read from the exchange twice across runs.
Every delivered page SHALL be written to the local store together with the run
it joined, the stored run SHALL be bounded per pair and interval, and a store
that is unavailable SHALL degrade to reading from the exchange rather than fail
the chart.

#### Scenario: The pair is reopened after a restart
- **WHEN** depth for a pair and interval was loaded in an earlier run
- **THEN** it is presented on open from the local store with no history request issued

#### Scenario: The stored run no longer reaches the live window
- **WHEN** the app was closed long enough that the stored run and the live window do not touch
- **THEN** the run that reaches the present is kept and no hole is presented as continuous data

#### Scenario: The local store cannot be read
- **WHEN** IndexedDB is unavailable
- **THEN** the chart opens on its live window and history is read from the exchange as usual

### Requirement: History is Spot-scoped and costs only what it reads
The history action SHALL be accepted only while Spot is the activated market, and
SHALL be validated for pattern and bound like every other channel action. It
SHALL use the existing public klines route, at the weight that read costs, with
no credential and no additional route.

#### Scenario: History is requested while Spot is not activated
- **WHEN** a history request arrives before Spot is activated, or after the operator switched away
- **THEN** it is refused as market-inactive and no exchange read is issued

#### Scenario: A request asks for more than one read serves
- **WHEN** a history request carries a page size above the bound, or a read point that is not a positive integer
- **THEN** it is refused as an invalid channel action and no exchange read is issued
