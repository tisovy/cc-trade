## MODIFIED Requirements

### Requirement: An interval change touches only the candles
Changing the chart interval SHALL change the state of the candles resource
and nothing else. The session SHALL stay live; the order book, the tape and
the header SHALL neither be re-delivered nor re-stated for the change. The
chart SHALL keep drawing the series it last had, under a stated non-live
state, until the new interval's series is delivered, and SHALL then replace
it. While that replacement is in flight, the held chart SHALL appear darkened
beneath a translucent dark-grey veil with a compact progress indicator above it.
The veil and indicator SHALL keep the retained candles readable, SHALL NOT
intercept chart gestures, and SHALL leave when the switching state ends. A
switch that fails SHALL leave the candles stale with the reason and retry on
the interval's own schedule, without the session leaving live. A switch the
local connection's failure ends SHALL leave the held series drawn under the
connection's state, without the veil, until the workstation subscribes again.

#### Scenario: The operator switches from 1m to 5m
- **WHEN** the operator selects another interval while the book and tape are live
- **THEN** only the candles resource reads loading, the held chart is visibly darkened beneath the progress veil, the book and tape stay live and undisturbed, and the chart replaces its series when the new one arrives

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

### Requirement: The chart opens on enough history to read the market
Opening a contract or interval SHALL present substantially more than the live
streaming window of candles. The workstation SHALL request candle history once
that selection's live window is on screen, including when the chart mounted
before the window arrived, and SHALL present the history and the live window as
one continuous series ordered by open time, with no duplicated or missing bar
at the seam. A new contract or interval SHALL start a distinct chart session
whose initial viewport is fitted to that selection rather than inherited from
the series it replaced. Candle rows SHALL be shown only for the selected
contract, and the series of a contract being replaced SHALL be cleared before
the browser paints the new contract. Through an interval switch the series of
the interval being left SHALL stay drawn under the switching state until the
selected interval's window lands; history rows SHALL be shown only for the
selected interval, and no history SHALL be requested behind a series of
another interval.

#### Scenario: A contract is opened
- **WHEN** the contract's bootstrap completes and history is delivered
- **THEN** the chart shows the live window plus the requested history as one series, ordered by open time

#### Scenario: The chart mounts before the live window
- **WHEN** the chart is mounted with no candles and the selected contract's live window arrives later
- **THEN** the chart fits that window and requests its history without requiring an extra viewport event

#### Scenario: The interval changes
- **WHEN** a live chart replaces its selected interval with another interval whose candle window arrives after the selection
- **THEN** the replacement interval's session is fitted, and its own initial history request is made behind the landed window rather than behind the series held through the switch

#### Scenario: A previous selection is still committed during an interval change
- **WHEN** the operator selects a new interval before that interval's window has committed
- **THEN** the chart draws the series of the interval being left under the switching state, shows no history rows of that interval under the new selection, and requests no history until the new window lands

#### Scenario: History overlaps the live window
- **WHEN** a delivered history page contains a candle whose open time is already in the live window
- **THEN** the live window's row is kept and the duplicate is discarded
