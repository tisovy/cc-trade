## ADDED Requirements

### Requirement: Candles are read from the nearest source
The workstation SHALL take candles from the nearest source that holds them
whole, and from the exchange only when no nearer source does. The sources, in
order, are the renderer's own cache of closed candles, the local candle store
(the machine's database of closed minutes, read over loopback, with every
chart interval built from them), and the exchange. A source SHALL answer with
rows in the exact shape and order the exchange's rows are normalized to, or
with nothing; a partial answer SHALL NOT be presented as the exchange's.

A history page SHALL be taken from the store only when the store holds every
candle of the page, so that a page shorter than requested reaches the renderer
only from the exchange and keeps its meaning of the contract's first candle.
A page the store served SHALL be written to the renderer's cache as an
exchange page is.

The live window of a contract or interval SHALL be delivered from the store as
soon as the selection is made, under the `loading` state, when the store's
newest minutes reach the window; the exchange's window SHALL then replace it
bar for bar and SHALL remain the authority for the forming candle and the live
tail. The store's window SHALL start where the exchange's will, so the
replacement is an append and never moves the bars on screen.

The store SHALL be read over loopback only, SHALL never make the machine read
the exchange on the desk's behalf, and SHALL be skipped silently — the next
source asked — when it is off, unreachable, slow, or does not cover the span.
Contracts the desk holds without showing SHALL read nothing from the store.

#### Scenario: A page the store covers
- **WHEN** the operator scrolls to the left edge and the store holds every candle of the next page while the renderer's cache does not
- **THEN** the page is delivered from the store with no exchange request, and the renderer caches it

#### Scenario: A page the store covers only in part
- **WHEN** the next page reaches behind the store's oldest minute for the contract
- **THEN** the store's answer is not presented, the page is read from the exchange, and a short exchange answer alone means the contract's history starts there

#### Scenario: The store's window on a switch
- **WHEN** the operator selects another interval and the store holds the newest minutes of the contract
- **THEN** the new interval's window is on the chart under the loading state before the exchange answers, and the exchange's window replaces it without moving the bars

#### Scenario: The store is down
- **WHEN** the store does not answer, answers late, or refuses
- **THEN** the window and the pages come from the renderer's cache and the exchange as before, and the operator notices only in the record

#### Scenario: The store's minutes start or end inside the window
- **WHEN** the store's first minute for the contract lies inside the requested window, or its newest minute falls short of the window's end
- **THEN** the window is served as the whole candles between them, and a candle the store could build only from part of its minutes is left to the exchange

#### Scenario: A weekly window
- **WHEN** the selected interval is a week
- **THEN** the span asked of the store opens on a Monday, as the exchange's weekly candles do

#### Scenario: A held contract in the background
- **WHEN** a contract the desk holds is not the one on screen
- **THEN** the store is not read for it

## MODIFIED Requirements

### Requirement: An interval change touches only the candles
Changing the chart interval SHALL change the state of the candles resource
and nothing else. The session SHALL stay live; the order book, the tape and
the header SHALL neither be re-delivered nor re-stated for the change. The
chart SHALL keep drawing the series it last had, under a stated non-live
state, until the new interval's series is delivered — or, when the local
candle store holds the contract's newest minutes, SHALL draw the new
interval's window from the store under the same state as soon as it is read —
and SHALL then replace what it draws with the exchange's series. While that
replacement is in flight, the held chart SHALL appear darkened beneath a
translucent dark-grey veil with a compact progress indicator above it. The
switching state SHALL end on the first series of the new interval that is not
the store's loading window: the exchange's series, or the stated failure of
the switch.
The veil and indicator SHALL keep the retained candles readable, SHALL NOT
intercept chart gestures, and SHALL leave when the switching state ends. A
switch that fails SHALL leave the candles stale with the reason and retry on
the interval's own schedule, without the session leaving live. A switch the
local connection's failure ends SHALL leave the held series drawn under the
connection's state, without the veil, until the workstation subscribes again.

#### Scenario: The operator switches from 1m to 5m
- **WHEN** the operator selects another interval while the book and tape are live
- **THEN** only the candles resource reads loading, the chart shows the 5m window from the local store beneath the progress veil as soon as it is read, the book and tape stay live and undisturbed, and the exchange's series replaces the window and lifts the veil when it arrives

#### Scenario: The store has nothing for the contract
- **WHEN** the operator switches intervals on a contract the local store does not hold
- **THEN** the held series stays on the chart beneath the veil until the exchange's series arrives, as before

#### Scenario: The new interval cannot be read
- **WHEN** the candle socket for the new interval does not come ready or its klines cannot be read
- **THEN** the candles read stale with the reason, the progress veil leaves, the retry is scheduled, and the session stays live throughout

#### Scenario: A switch during a spike
- **WHEN** the operator switches intervals while the market is moving fast
- **THEN** the last series stays readable beneath the dark veil with its state and a progress indicator shown until the new one lands, the chart remains interactive, and no panel goes blank

#### Scenario: The local connection fails during a switch
- **WHEN** the local workstation connection closes or errors before the replacement candle series arrives
- **THEN** the chart keeps drawing the held series and states the connection failure over it, the progress veil and indicator stop, and reconnection remains owned by the workstation's existing retry schedule

#### Scenario: A series of another interval outside a switch
- **WHEN** a candle series at another interval is held while no switch is waiting and the local connection is live
- **THEN** it is not this selection's and is not drawn

#### Scenario: History is loaded after an interval switch
- **WHEN** the operator switches intervals and then scrolls left after the new interval's series has landed
- **THEN** history is requested behind that new series, the candles remain continuous, and replacing the held series does not move the viewport as though a history page had been prepended


### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it — from the nearest source that
holds the whole page, the exchange last — and prepend the result, keeping the
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
- **WHEN** a history response from the exchange returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

#### Scenario: A page the local store holds whole
- **WHEN** the next page lies entirely within the local store's minutes for the contract
- **THEN** it is prepended from the store with no exchange request, and the next left edge is loadable as before

#### Scenario: The read failed rather than came back short
- **WHEN** a read of older candles is not served at all
- **THEN** the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The desk states an outage over the last answer it holds
- **WHEN** a state of the desk's own restates the last history answer while a read is outstanding for it
- **THEN** the restatement is not taken for a page, the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The session is rebuilt under an outstanding read
- **WHEN** the connection recovers and the session is rebuilt while a read of older candles is outstanding
- **THEN** the next scroll issues a new read rather than waiting on an answer that can no longer arrive

