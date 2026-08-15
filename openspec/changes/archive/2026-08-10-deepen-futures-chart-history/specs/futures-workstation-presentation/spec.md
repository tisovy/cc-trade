## ADDED Requirements

### Requirement: The chart opens on enough history to read the market
Opening a contract SHALL present substantially more than the live streaming
window of candles. The workstation SHALL request candle history once the
contract's live window is on screen, and SHALL present the history and the live
window as one continuous series ordered by open time, with no duplicated or
missing bar at the seam.

#### Scenario: A contract is opened
- **WHEN** the contract's bootstrap completes and history is delivered
- **THEN** the chart shows the live window plus the requested history as one series, ordered by open time

#### Scenario: History overlaps the live window
- **WHEN** a delivered history page contains a candle whose open time is already in the live window
- **THEN** the live window's row is kept and the duplicate is discarded

### Requirement: Candle history is delivered as bounded pages
Candle history SHALL be delivered as pages that respect the same per-event row
and byte bounds as every other resource, each page stating its offset, the
total number of rows in the response, and whether it completes the response.
The renderer SHALL buffer pages and apply them only once the response is
complete, and SHALL discard a buffer whose generation, total or offset does not
continue the one in progress. The live candle window, its per-tick update path
and its frame bound SHALL NOT be changed by history delivery.

#### Scenario: A history response exceeds one event
- **WHEN** the requested history is larger than one event may carry
- **THEN** it arrives as consecutive pages and is applied as a single series once the final page is delivered

#### Scenario: A page arrives out of order
- **WHEN** a page's offset does not continue the buffered rows
- **THEN** the buffer is discarded and no partial history is presented

#### Scenario: The market ticks while history loads
- **WHEN** a live candle update arrives during a history response
- **THEN** the live window updates as it always has, unaffected by the history in flight

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it and prepend the result, keeping the
bars the operator is looking at in place rather than jumping the viewport. Only
one history request SHALL be in flight at a time. When a response returns fewer
candles than requested, the chart SHALL treat that as the start of the
contract's history and SHALL stop requesting more.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

### Requirement: Loaded candle history survives a restart
A closed candle SHALL NOT be read from the exchange twice. Delivered history
SHALL be stored locally per contract and interval and reused after a restart:
a page the store can satisfy SHALL be applied without issuing any request. Only
closed candles SHALL be stored, the store SHALL be bounded per contract and
interval, and a store that is unavailable or unreadable SHALL degrade to
fetching rather than fail the chart.

#### Scenario: The contract is reopened after a restart
- **WHEN** history for a contract and interval was loaded in an earlier run and is requested again
- **THEN** it is served from the local store and no history request is sent

#### Scenario: The app was closed for days
- **WHEN** the stored history no longer reaches the live window
- **THEN** the missing range is fetched and no gap is presented as continuous data

#### Scenario: The local store cannot be opened
- **WHEN** IndexedDB is unavailable
- **THEN** history is fetched as usual and the chart behaves exactly as it does without a store

### Requirement: History belongs to one contract and interval
Loaded history SHALL be discarded when the contract or the interval changes,
and a history response SHALL be ignored unless it matches the contract,
interval and subscription that asked for it.

#### Scenario: The interval changes
- **WHEN** the operator switches from 15m to 1h
- **THEN** the 15m history is discarded and the 1h chart shows no candle from the previous interval

#### Scenario: A late response arrives after a symbol change
- **WHEN** a history response for the previous contract arrives after the operator switched contracts
- **THEN** it is ignored
