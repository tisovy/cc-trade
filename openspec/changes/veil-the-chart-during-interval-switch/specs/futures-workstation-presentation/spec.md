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
the interval's own schedule, without the session leaving live.

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
- **THEN** the retained chart states the connection failure, the progress veil and indicator stop, and reconnection remains owned by the workstation's existing retry schedule

#### Scenario: History is loaded after an interval switch
- **WHEN** the operator switches intervals and then scrolls left after the new interval's series has landed
- **THEN** history is requested behind that new series, the candles remain continuous, and replacing the held series does not move the viewport as though a history page had been prepended
