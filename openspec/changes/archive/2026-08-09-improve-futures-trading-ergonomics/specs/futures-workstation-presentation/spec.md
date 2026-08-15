## ADDED Requirements

### Requirement: The instrument rail reflects what is actually traded
The workstation SHALL persist recently selected contracts, favourites, and the last selected contract. It SHALL restore the last selected contract on startup and SHALL order the contract catalogue by recency, then favourites, then alphabetically.

#### Scenario: Operator reopens the workstation
- **WHEN** the operator restarts the application after trading a contract
- **THEN** that contract is selected again instead of a hard-coded default

#### Scenario: Catalogue is displayed
- **WHEN** the contract list is rendered
- **THEN** recently traded contracts appear first in the single contract list, without a second strip repeating the same entries

### Requirement: Interface scale is adjustable and persisted
The workstation SHALL express its type sizes against a persisted interface scale with a legible floor, expose a control to change it, and SHALL additionally provide persisted window-level zoom shortcuts for surfaces outside that scale.

#### Scenario: Operator enlarges the interface
- **WHEN** the operator increases the interface scale
- **THEN** every futures surface grows proportionally and the choice survives a restart

#### Scenario: Operator zooms the window
- **WHEN** the operator presses the platform zoom-in, zoom-out, or reset shortcut
- **THEN** the whole application scales, including the chart canvas, and the level survives a restart

### Requirement: Order sizing is quantized to whole USDT
Order notional SHALL be quantized to whole USDT wherever it is computed, displayed, or edited, so sizing never presents fractional-cent values.

#### Scenario: Operator drags the size slider
- **WHEN** a percentage of the available balance is selected
- **THEN** the resulting notional is a whole number of USDT in both the readout and the notional field

### Requirement: The chart shows only decision-relevant overlays
The chart SHALL render the contract candles, the operator's drawings and alerts, the operator's orders, and the open position's entry and liquidation prices. The chart SHALL NOT render an index-price overlay, an index price line, or a price-axis marker for the working price draft, and the market header SHALL NOT present an index price field.

#### Scenario: Chart is rendered for a live contract
- **WHEN** the workstation is live on a contract
- **THEN** no index series, no index price line, and no index header field are present

#### Scenario: Operator picks a price on the chart
- **WHEN** the operator clicks a price to seed the order draft
- **THEN** the draft is reflected in the ticket without adding a coloured label to the price axis

### Requirement: The instrument rail carries no exchange-filter reference panel
The instrument rail SHALL NOT present a contract-filter reference panel. Exchange filters SHALL remain enforced on every order draft and SHALL be reported only when they block a specific action.

#### Scenario: A contract is selected
- **WHEN** the operator selects a contract
- **THEN** no tick-size, step-size, percent-price, max-orders, or minimum-notional reference panel is rendered

#### Scenario: A draft violates a filter
- **WHEN** a draft order violates a symbol filter
- **THEN** the ticket states the violated constraint for that draft

### Requirement: The default chart interval is 15m
A contract SHALL open on the `15m` interval unless the operator selects another interval.

#### Scenario: Operator opens a contract
- **WHEN** the workstation mounts or a different contract is selected
- **THEN** the chart interval is `15m`

## MODIFIED Requirements

### Requirement: The chart does not draw a MARK overlay
The futures workstation chart SHALL NOT draw a historical MARK series, a horizontal MARK price line, or a MARK price-line label. The system SHALL continue ingesting mark-price data when it is required for risk calculations, account fields, or non-chart status, and SHALL leave the primary candle series unchanged. The index reference is no longer part of this guarantee: it is removed by "The chart shows only decision-relevant overlays".

#### Scenario: Mark-price data is available
- **WHEN** the workstation receives valid mark-price history and a current mark price
- **THEN** no MARK series or MARK horizontal line is drawn on the chart

#### Scenario: Risk state uses mark price
- **WHEN** a position or liquidation-distance calculation requires mark price
- **THEN** removing the chart overlay does not remove or substitute the underlying mark-price input
