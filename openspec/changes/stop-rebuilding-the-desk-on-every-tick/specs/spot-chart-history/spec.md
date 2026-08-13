## ADDED Requirements

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
