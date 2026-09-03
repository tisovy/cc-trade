## ADDED Requirements

### Requirement: An interval change touches only the candles
Changing the chart interval SHALL change the state of the candles resource
and nothing else. The session SHALL stay live; the order book, the tape and
the header SHALL neither be re-delivered nor re-stated for the change. The
chart SHALL keep drawing the series it last had, under a stated non-live
state, until the new interval's series is delivered, and SHALL then replace
it. While that replacement is in flight, the held chart SHALL show a compact,
non-blocking progress indicator that does not intercept chart gestures. The
indicator SHALL leave when the switching state ends. A switch that fails SHALL
leave the candles stale with the reason and retry on the interval's own
schedule, without the session leaving live.

#### Scenario: The operator switches from 1m to 5m
- **WHEN** the operator selects another interval while the book and tape are live
- **THEN** only the candles resource reads loading, the book and tape stay live and undisturbed, and the chart replaces its series when the new one arrives

#### Scenario: The new interval cannot be read
- **WHEN** the candle socket for the new interval does not come ready or its klines cannot be read
- **THEN** the candles read stale with the reason, the retry is scheduled, and the session stays live throughout

#### Scenario: A switch during a spike
- **WHEN** the operator switches intervals while the market is moving fast
- **THEN** the last series stays on screen with its state and a progress indicator shown until the new one lands, the chart remains interactive, and no panel goes blank

#### Scenario: The local connection fails during a switch
- **WHEN** the local workstation connection closes or errors before the replacement candle series arrives
- **THEN** the retained chart states the connection failure, the progress indicator stops, and reconnection remains owned by the workstation's existing retry schedule

#### Scenario: History is loaded after an interval switch
- **WHEN** the operator switches intervals and then scrolls left after the new interval's series has landed
- **THEN** history is requested behind that new series, the candles remain continuous, and replacing the held series does not move the viewport as though a history page had been prepended

## MODIFIED Requirements

### Requirement: The default chart interval is 15m
A contract SHALL open on the interval the operator last selected, restored on
mount and after a reload, and on `15m` only when no interval has been stored.
Selecting an interval SHALL store it.

#### Scenario: Operator opens a contract
- **WHEN** the workstation mounts or a different contract is selected
- **THEN** the chart interval is the one last selected, or `15m` when none was ever selected

#### Scenario: The window is reloaded mid-session
- **WHEN** the operator reloads the window while working on a one-minute chart
- **THEN** the chart comes back on the one-minute interval

#### Scenario: The operator selects an interval
- **WHEN** an interval is selected by button or picker
- **THEN** it is stored, and the next mount opens on it

### Requirement: Market data state does not disarm order entry
Chart price picking, chart trading gestures and order-book level selection SHALL
remain available while the market data is stale, quiet, disconnected or
resynchronizing, and while the chart interval is being switched. They SHALL be
unavailable only where the surface has never received data and therefore has
no price to act on. Lifting an order off the chart SHALL NOT depend on the
market data state at all, because the order being lifted is the desk's own.

#### Scenario: The workspace is resynchronizing
- **WHEN** the market data resynchronizes while the operator holds a position
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: The contract is quiet
- **WHEN** the selected contract records no trade for longer than the freshness window
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: Nothing has ever been received
- **WHEN** a contract's chart has received no candle at all
- **THEN** picking a price from it is unavailable, because there is no price on it

#### Scenario: The book was delivered empty
- **WHEN** the order book carries no level on either side
- **THEN** there is no level to pick, and picking one is unavailable

#### Scenario: The interval is being switched
- **WHEN** the operator picks a price or makes a gesture on the chart while the new interval's series is still being fetched
- **THEN** the pick and the gesture work off the series still drawn, and the price carries that reading's state and age
