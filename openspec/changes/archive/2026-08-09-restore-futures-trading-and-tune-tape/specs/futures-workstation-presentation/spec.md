## Purpose

Defines deterministic Spot/Futures startup and lazy-loading behavior together with a less obstructive futures chart and a configurable bounded tape that reduces renderer workload during high trade throughput.

## ADDED Requirements

### Requirement: The last selected market workspace is restored before mount
After credential preflight succeeds, the application SHALL read the last explicitly activated market workspace from durable local storage before mounting Spot or Futures. A valid stored Spot or Futures value SHALL become the initial workspace without first mounting, subscribing, or briefly displaying the other market.

#### Scenario: Futures was last active
- **WHEN** the persisted market workspace is Futures at the next successful startup
- **THEN** Futures is the first market workspace mounted and Spot is not initialized

#### Scenario: Spot was last active
- **WHEN** the persisted market workspace is Spot at the next successful startup
- **THEN** Spot is the first market workspace mounted and Futures is not initialized

#### Scenario: Operator changes workspace
- **WHEN** the operator successfully switches between Spot and Futures
- **THEN** the newly active workspace is durably stored as the next startup workspace

### Requirement: Missing or invalid workspace state has no implicit fallback
The application SHALL NOT default to Spot when the persisted market workspace is absent, unreadable, or invalid. It SHALL render a neutral Spot/Futures selector, mount neither market workspace, and start no market-specific requests or subscriptions until the operator explicitly selects one.

#### Scenario: First run has no stored workspace
- **WHEN** credential preflight succeeds but no market workspace has ever been persisted
- **THEN** the neutral selector is shown and neither Spot nor Futures initializes until an explicit selection

#### Scenario: Stored workspace is invalid
- **WHEN** durable storage contains a value other than a supported Spot or Futures workspace
- **THEN** the invalid value is ignored, the neutral selector is shown, and no implicit Spot fallback occurs

#### Scenario: Storage cannot be read
- **WHEN** durable storage is unavailable or throws during startup
- **THEN** the application remains on the neutral selector and allows an explicit session selection without initializing a market automatically

### Requirement: The inactive market is lazy and quiescent
At startup the application SHALL load and initialize only the persisted active market's React workspace and market-specific data path. The other workspace SHALL be lazy-loaded only after explicit selection and SHALL issue no market-specific public requests, signed account requests, analytics polling, or stream subscriptions while inactive. A shared local diagnostic/control transport MAY remain available if it performs no inactive-market work.

#### Scenario: Startup restores Futures
- **WHEN** Futures is the persisted active workspace
- **THEN** Futures code/data initialization begins and Spot components, subscriptions, account refreshes, and analytics polling remain inactive

#### Scenario: Inactive workspace is selected for the first time
- **WHEN** the operator explicitly selects a workspace that has not been loaded in the current application session
- **THEN** that workspace is loaded on demand and its market-specific initialization begins only then

#### Scenario: Operator switches markets
- **WHEN** the operator switches from the active market to the other market
- **THEN** the previous market's subscriptions and pending market-specific work are cleaned up before or generation-isolated from the newly selected market

#### Scenario: Previously loaded workspace becomes inactive
- **WHEN** a workspace module was loaded earlier but is no longer selected
- **THEN** its cached code MAY remain in memory but its market-specific network activity and timers remain stopped

### Requirement: The chart does not draw a MARK overlay
The futures workstation chart SHALL NOT draw a historical MARK series, a horizontal MARK price line, or a MARK price-line label. The system SHALL continue ingesting mark-price data when it is required for risk calculations, account fields, or non-chart status, and SHALL leave unrelated chart data such as the primary candle series and index reference unchanged.

#### Scenario: Mark-price data is available
- **WHEN** the workstation receives valid mark-price history and a current mark price
- **THEN** no MARK series or MARK horizontal line is drawn on the chart

#### Scenario: Risk state uses mark price
- **WHEN** a position or liquidation-distance calculation requires mark price
- **THEN** removing the chart overlay does not remove or substitute the underlying mark-price input

### Requirement: Tape filtering uses displayed trade notional in USDT
The bounded tape SHALL provide a user-configurable minimum displayed trade notional expressed in USDT. A trade's displayed notional SHALL be calculated as absolute price multiplied by absolute quantity, and trades below the configured threshold SHALL be excluded before delivery to the renderer.

#### Scenario: Trade is below the configured threshold
- **WHEN** a trade's calculated notional is less than the minimum displayed USDT value
- **THEN** the trade is not included in the renderer tape payload

#### Scenario: Trade meets the configured threshold
- **WHEN** a trade's calculated notional is equal to or greater than the minimum displayed USDT value
- **THEN** the trade remains eligible for the bounded renderer payload

#### Scenario: Threshold is zero
- **WHEN** the minimum displayed notional is configured as zero
- **THEN** no otherwise valid trade is excluded by notional

### Requirement: Tape delivery can be throttled by a configurable timeout
The bounded tape SHALL provide an on/off throttle and a user-configurable timeout in milliseconds. While enabled, the service SHALL emit no more than one tape payload per configured timeout window and SHALL deliver the newest eligible bounded state at the trailing edge when trades arrived during the window.

#### Scenario: Many trades arrive inside one timeout window
- **WHEN** throttling is enabled and multiple eligible trades arrive before the timeout elapses
- **THEN** the renderer receives at most one coalesced tape update for that window containing the newest bounded state

#### Scenario: Throttling is disabled
- **WHEN** the operator disables tape throttling
- **THEN** eligible trades may be delivered without the configured delay while the notional filter and bounded row limit still apply

#### Scenario: No eligible trade arrives
- **WHEN** all trades in a timeout window are below the configured notional threshold
- **THEN** no redundant tape update is emitted solely because the timeout elapsed

### Requirement: Tape settings are validated and explained
The UI SHALL label timeout units and the USDT notional meaning, SHALL reject or normalize non-finite, negative, or out-of-range input without crashing the stream, and SHALL display the effective settings. The row bound SHALL remain enforced independently of filtering and throttling.

#### Scenario: Invalid timeout is entered
- **WHEN** the operator enters an invalid or unsupported timeout value
- **THEN** the system keeps the previous valid effective timeout and presents validation feedback

#### Scenario: Invalid notional is entered
- **WHEN** the operator enters a negative or non-finite minimum notional
- **THEN** the system keeps the previous valid effective threshold and presents validation feedback

#### Scenario: High-volume stream exceeds the row bound
- **WHEN** more eligible trades are accumulated than the configured bounded-tape capacity
- **THEN** only the newest rows within the bound are retained and delivered

### Requirement: Throttle lifecycle cannot leak stale updates
Pending tape emissions SHALL be canceled or generation-guarded when the symbol generation changes, the workstation stops, or the service is disposed. A delayed payload from an obsolete generation SHALL NOT appear in the current symbol's tape.

#### Scenario: Symbol changes while an emission is pending
- **WHEN** the operator selects a new symbol before the previous symbol's throttle timeout elapses
- **THEN** no delayed payload from the previous symbol is rendered in the new symbol's tape

#### Scenario: Workstation stops while an emission is pending
- **WHEN** the workstation stops or is disposed before the timeout elapses
- **THEN** the pending timer is cleared and emits no later renderer update
