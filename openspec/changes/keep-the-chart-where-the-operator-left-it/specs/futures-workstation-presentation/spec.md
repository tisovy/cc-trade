## ADDED Requirements

### Requirement: The chart keeps the operator's zoom and pan
The chart's zoom — the pixels it spends on a bar — and pan — the newest bar's
distance from the right edge, in bars — SHALL be the operator's. The chart
SHALL read both whenever its visible range moves and before a selection
change clears its series, SHALL show the first series of a new contract or
interval at them, and SHALL NOT fit a series into the screen except on a
chart that has nothing to carry: a first chart with nothing remembered.

A pan SHALL be carried in bars: the newest bar stands the same number of bars
from the right edge on the new series. A pan deeper into history than the new
series reaches SHALL leave that series' oldest bars at the right edge, as the
library's own scrolling limit does, until history lands behind them.

The zoom and the margin last kept at the live edge — a pan with the newest
bar on screen — SHALL outlive the chart: a chart created later, after a
workspace change or a restart, SHALL open on the live edge at that zoom and
margin. A pan into history SHALL NOT be carried into a chart created later.
A remembered record the chart cannot read SHALL count as nothing remembered.

#### Scenario: The interval changes under a zoomed chart
- **WHEN** the operator has the chart at fifty-five bars across with the newest bar five bars in from the right edge and selects another interval
- **THEN** the series held through the switch stays at fifty-five bars across with its newest bar five in from the edge, the new interval's window lands at the same, and nothing is fitted

#### Scenario: The contract changes
- **WHEN** the operator selects another contract under that zoom and margin
- **THEN** the new contract's window opens at fifty-five bars across with its newest bar five in from the edge, whatever its length

#### Scenario: A pan into history through a switch
- **WHEN** the newest bar stands forty-five bars past the right edge and the operator selects another interval
- **THEN** the new series is asked to stand the same forty-five bars past the edge, and a series shorter than that shows its oldest bars at the edge until history lands behind them

#### Scenario: A chart is created later
- **WHEN** a chart is created with a zoom and a live-edge margin remembered
- **THEN** its first series opens on the live edge at that zoom and margin, and is not fitted

#### Scenario: Nothing is remembered
- **WHEN** a chart is created with nothing remembered, or with a record it cannot read
- **THEN** its first series is fitted into the screen, as a first chart always was

#### Scenario: The operator scrolls into history
- **WHEN** the operator scrolls the newest bar off the right edge
- **THEN** the zoom is remembered as it is, and the remembered margin stays the one last kept at the live edge

## MODIFIED Requirements

### Requirement: The chart opens on enough history to read the market
Opening a contract or interval SHALL present substantially more than the live
streaming window of candles. The workstation SHALL request candle history once
that selection's live window is on screen — wherever the viewport stands on
it, since at the operator's zoom the window may reach further than the screen
does — including when the chart mounted before the window arrived, and SHALL
present the history and the live window as one continuous series ordered by
open time, with no duplicated or missing bar at the seam. A new contract or
interval SHALL start a distinct chart session for its measurement and
interaction state, shown at the zoom and pan the operator left rather than
fitted to the selection. Candle rows SHALL be shown only for the selected
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
- **THEN** the chart shows that window at the zoom and pan it holds and requests its history without requiring an extra viewport event

#### Scenario: The interval changes
- **WHEN** a live chart replaces its selected interval with another interval whose candle window arrives after the selection
- **THEN** the replacement interval's series stands at the zoom and pan the operator left, and its own initial history request is made behind the landed window rather than behind the series held through the switch

#### Scenario: The window is wider than the screen
- **WHEN** a selection's window lands under a zoom that shows fewer bars than the window holds
- **THEN** history is requested behind the window at once, and the next page only when the operator scrolls within reach of the oldest loaded bar

#### Scenario: A previous selection is still committed during an interval change
- **WHEN** the operator selects a new interval before that interval's window has committed
- **THEN** the chart draws the series of the interval being left under the switching state, shows no history rows of that interval under the new selection, and requests no history until the new window lands

#### Scenario: History overlaps the live window
- **WHEN** a delivered history page contains a candle whose open time is already in the live window
- **THEN** the live window's row is kept and the duplicate is discarded
