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
A closed candle already held as history SHALL NOT be read from the exchange
twice across runs. Every delivered history page SHALL be written to the local
store together with the run it joined, the stored run SHALL be bounded per pair
and interval, and a store that is unavailable SHALL degrade to reading from the
exchange rather than fail the chart. The live bootstrap window that opens a pair
SHALL be read on every start, because only the exchange can say what the current
candle is; it is the one read this requirement does not eliminate.

#### Scenario: The pair is reopened after a restart
- **WHEN** depth for a pair and interval was loaded in an earlier run
- **THEN** it is presented on open from the local store with no history request issued

#### Scenario: The stored run no longer reaches the live window
- **WHEN** the app was closed long enough that the stored run and the live window do not touch
- **THEN** the run that reaches the present is kept and no hole is presented as continuous data

#### Scenario: The local store cannot be read
- **WHEN** IndexedDB is unavailable
- **THEN** the chart opens on its live window and history is read from the exchange as usual

#### Scenario: A cold start opens a stored pair
- **WHEN** a pair with stored depth is opened in a new run
- **THEN** the live bootstrap window is read once and joined to the stored depth, and no history page already stored is requested again

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

### Requirement: A failed history read leaves history loadable
A history read that cannot be served SHALL produce a failure answer naming the
request it answers. The requester SHALL release its in-flight lock on that
answer, so the next scroll issues a new read, and SHALL tell the operator that
older candles could not be loaded — once per failure, not once per scroll.

#### Scenario: The exchange read fails
- **WHEN** a history read fails at the exchange or in transport
- **THEN** the operator is told, and scrolling left again issues a fresh read

#### Scenario: Repeated scrolling during a failure
- **WHEN** the operator keeps scrolling while reads are failing
- **THEN** the failure is stated once per failed read rather than once per scroll event, and reads remain bounded to one in flight

### Requirement: The series ceiling is enforced wherever the series grows
The per-pair, per-interval candle ceiling SHALL be enforced on every path that
adds rows — the merge of history, the prepend of an older page and the append of
a live candle. The newest rows SHALL be the ones kept.

#### Scenario: A long live session
- **WHEN** live candles are appended past the ceiling
- **THEN** the oldest rows are dropped and the series stays at the ceiling

#### Scenario: History paged in
- **WHEN** older pages are prepended past the ceiling
- **THEN** the series stays at the ceiling and the live end is never dropped

### Requirement: Calendar intervals are compared by calendar step
Where a candle ends, and where the next one opens, SHALL be decided using the
interval's own step. An interval whose length varies by calendar — a month above
all — SHALL NOT be compared against, or counted in, a fixed millisecond
constant.

#### Scenario: Consecutive monthly candles of unequal length
- **WHEN** a 31-day month follows a 28-day month
- **THEN** the two candles are continuous and neither run is discarded

#### Scenario: A genuine gap between monthly candles
- **WHEN** a month is missing between two monthly candles
- **THEN** the gap is detected and no hole is presented as continuous data

#### Scenario: A print opens the next monthly candle
- **WHEN** a trade prints in the month after the one the chart's last candle opened
- **THEN** the candle opened for it opens on the first of that month

### Requirement: A history request cannot be starved by the trade stream
The scheduling of a history read SHALL NOT depend on data the trade stream
changes. A viewport held at the oldest loaded bar SHALL issue the request for
older candles whatever rate the contract is printing at.

It was not a delay but a cancellation. Drawing the series and reading the visible
range were one effect, rebuilt whenever the series changed: a print tore down the
range subscription and cancelled the settle timer the operator's scroll had
started, and the next print cancelled the next one. On any contract printing
faster than that timer waits — which is any contract worth scrolling back on —
the request was never issued at all, and the chart stayed at the bars it opened
with.

#### Scenario: Prints arrive faster than the debounce
- **WHEN** trades arrive faster than the history debounce interval while the operator scrolls left
- **THEN** the history request is still issued

#### Scenario: The viewport is nowhere near the oldest bar
- **WHEN** trades arrive and the viewport is far from the oldest loaded bar
- **THEN** no history request is issued

### Requirement: A live trade updates one candle, not the whole chart
Applying a live trade to the chart SHALL update the candle it belongs to. It
SHALL NOT rebuild the full data set, the derived series or the chart's
subscriptions when no other candle changed.

A trade that moves nothing — a print at the price the candle in progress already
closes at — SHALL leave the series exactly as it is, so nothing reading it
redraws. A liquid contract prints at one tick again and again.

A candle settling behind the last one, older candles arriving in front, and a
change of selection SHALL each redraw the series whole: none of them is one bar's
news, and the close of the candle just past — its true high, low and volume —
reaches the chart through the same series a tick does.

This holds for every series the chart draws, including the RSI line, whose
smoothing is recursive from the first bar: it SHALL carry the state its last
point steps from rather than walk the bars again, and the point it produces SHALL
be the one a full calculation would have produced.

#### Scenario: A print moves the newest candle
- **WHEN** a trade updates the newest candle
- **THEN** that candle is updated on the chart and no full-series redraw is performed

#### Scenario: A print moves nothing
- **WHEN** a trade prints at the price the newest candle already closes at
- **THEN** the series is the one already on screen, and nothing redraws for it

#### Scenario: A candle opens
- **WHEN** a trade opens the next candle
- **THEN** that one candle is written to each series and no series is redrawn

#### Scenario: A candle behind the newest one settles
- **WHEN** a candle that is not the newest is replaced by its settled reading
- **THEN** every series is redrawn, because a newest-candle write cannot show it

### Requirement: Only the current chart selection may finish opening

Each opening of a Spot pair and interval SHALL supersede every previous opening,
including an earlier opening of the same pair and interval. An abandoned cache
read SHALL NOT change the chart, loading indicators, or detail subscription.
While the current opening awaits its cache, the chart SHALL contain no rows or
queued updates from the previous selection. Detail frames for the abandoned
selection SHALL NOT enter the current view or its cache.

#### Scenario: Cache reads finish in reverse order
- **WHEN** ETHUSDT is selected, then SOLUSDT, and ETHUSDT's cache finishes last
- **THEN** SOLUSDT remains selected, drawn, and subscribed, with its loading state unchanged by ETHUSDT

#### Scenario: An interval or repeated selection supersedes an opening
- **WHEN** the operator changes interval or selects A, then B, then A before the first A read finishes
- **THEN** only the latest opening may publish its cached rows and detail subscription

#### Scenario: Old live data arrives while the cache is pending
- **WHEN** a previous selection's detail frame or queued chart update arrives before the new cache finishes
- **THEN** no previous-selection candle, trade or depth enters the new view

#### Scenario: The current cache read fails
- **WHEN** the current selection's cache read rejects or returns no candles
- **THEN** the chart remains empty until the live data arrives and the current live subscription is still requested

#### Scenario: Spot is disabled or unmounted during a read
- **WHEN** a cache read completes after Spot is disabled or its provider is unmounted
- **THEN** it does not publish a chart or subscription, and re-enabling Spot opens the latest selection rather than an abandoned one

#### Scenario: A panel preference changes while the cache is pending
- **WHEN** a non-selection panel setting changes before the current cache read completes
- **THEN** the subscribed panel retains that newer setting
