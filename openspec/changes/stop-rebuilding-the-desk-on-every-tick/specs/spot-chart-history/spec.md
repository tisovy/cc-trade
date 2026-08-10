## ADDED Requirements

### Requirement: A history request cannot be starved by the trade stream
The scheduling of a history read SHALL NOT depend on data the trade stream
changes. A continuously updating market SHALL NOT prevent a pending history
request from being issued.

#### Scenario: Prints arrive faster than the debounce
- **WHEN** trades arrive faster than the history debounce interval while the operator scrolls left
- **THEN** the history request is still issued

### Requirement: A live trade updates one candle, not the whole chart
Applying a live trade to the chart SHALL update the candle it belongs to. It
SHALL NOT rebuild the full data set, the derived series or the chart's
subscriptions when no other candle changed.

#### Scenario: A print moves the newest candle
- **WHEN** a trade updates the newest candle
- **THEN** that candle is updated on the chart and no full-series redraw is performed
