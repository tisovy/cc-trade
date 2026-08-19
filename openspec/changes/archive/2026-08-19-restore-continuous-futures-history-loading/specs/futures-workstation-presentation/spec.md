## MODIFIED Requirements

### Requirement: The chart opens on enough history to read the market
Opening a contract or interval SHALL present substantially more than the live
streaming window of candles. The workstation SHALL request candle history once
that selection's live window is on screen, including when the chart mounted
before the window arrived, and SHALL present the history and the live window as
one continuous series ordered by open time, with no duplicated or missing bar
at the seam. A new contract or interval SHALL start a distinct chart session
whose initial viewport is fitted to that selection rather than inherited from
the series it replaced. Candle rows SHALL be shown only when both their contract
and interval own the current selection, and the series being replaced SHALL be
cleared before the browser paints the new selection.

#### Scenario: A contract is opened
- **WHEN** the contract's bootstrap completes and history is delivered
- **THEN** the chart shows the live window plus the requested history as one series, ordered by open time

#### Scenario: The chart mounts before the live window
- **WHEN** the chart is mounted with no candles and the selected contract's live window arrives later
- **THEN** the chart fits that window and requests its history without requiring an extra viewport event

#### Scenario: The interval changes
- **WHEN** a live chart replaces its selected interval with another interval whose candle window arrives after the selection
- **THEN** the replacement interval receives a fresh fitted viewport and its own initial history request

#### Scenario: A previous selection is still committed during an interval change
- **WHEN** the operator selects a new interval before the workstation state and candle window for that interval have committed
- **THEN** the chart shows no candles until the new selection owns its rows, and no frame displays candles from the selection being replaced

#### Scenario: History overlaps the live window
- **WHEN** a delivered history page contains a candle whose open time is already in the live window
- **THEN** the live window's row is kept and the duplicate is discarded

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it and prepend the result, keeping the
bars the operator is looking at in place rather than jumping the viewport. The
left-edge condition SHALL be re-evaluated whenever the oldest loaded candle
first appears or changes, so an asynchronously delivered live window and every
successfully prepended page remain loadable. Only one history request SHALL be
in flight at a time, and a request that can no longer be answered SHALL NOT
count as one: a read outstanding when the session behind it was rebuilt is not
travelling, and the renderer SHALL let it go rather than wait on it. When a
response returns fewer candles than requested, the chart SHALL treat that as
the start of the contract's history and SHALL stop requesting more. A read that
was not served SHALL NOT be treated as such a response: the chart SHALL
conclude that a contract's history has a start only from a page the exchange
actually sent, and a page the exchange sent SHALL be the only thing the
renderer takes for one — a resource restated under a state of the desk's own is
not a page, whatever it carries.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator reaches the next left edge
- **WHEN** a full history page was prepended and the operator continues to the oldest candle in the enlarged series
- **THEN** another request is issued behind the new oldest candle rather than the first request disabling further paging

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

#### Scenario: The read failed rather than came back short
- **WHEN** a read of older candles is not served at all
- **THEN** the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The desk states an outage over the last answer it holds
- **WHEN** a state of the desk's own restates the last history answer while a read is outstanding for it
- **THEN** the restatement is not taken for a page, the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The session is rebuilt under an outstanding read
- **WHEN** the connection recovers and the session is rebuilt while a read of older candles is outstanding
- **THEN** the next scroll issues a new read rather than waiting on an answer that can no longer arrive
