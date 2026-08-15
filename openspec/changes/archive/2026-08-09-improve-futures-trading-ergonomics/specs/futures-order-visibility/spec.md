## ADDED Requirements

### Requirement: Moving an order is a single atomic amendment
The system SHALL reprice or resize a live regular LIMIT futures order with one Binance USDⓈ-M order amendment. The system SHALL NOT implement a move as a cancel followed by a separate placement.

#### Scenario: Operator drags an order line to a new price
- **WHEN** the operator drags a regular LIMIT order line to a new price and releases it
- **THEN** exactly one amendment command is emitted for that order, carrying its symbol, side, exchange identity, unchanged quantity, and the new price, and no cancel command is emitted

#### Scenario: The exchange rejects the amendment
- **WHEN** Binance rejects the amendment
- **THEN** the original order remains open at its previous price, the rejection is reported with the exchange code, and account state is resynchronized so the displayed order line returns to the confirmed price

#### Scenario: Trading is paused
- **WHEN** the operator has paused trading
- **THEN** the move is refused before any exchange call and the refusal reason is shown

### Requirement: Order direction is derived from side, not position side
The system SHALL derive the displayed direction, entry/exit effect, and colour of an order from its side together with its reduce-only flag, using the declared position leg only when the account reports one. BUY SHALL render in the positive colour and SELL in the negative colour on every surface.

#### Scenario: One-way account reports positionSide BOTH
- **WHEN** an open BUY order for a one-way account is displayed on the chart and in the order list
- **THEN** it renders in the positive colour and is labelled as a long entry, never as a short and never with a bare `BOTH`

#### Scenario: Reduce-only order closes the opposite leg
- **WHEN** a reduce-only BUY order is displayed
- **THEN** it is labelled as a short exit while still rendering in the positive colour of its side

### Requirement: Open orders can be repriced and resized without leaving the list
The order list SHALL let the operator change the price and the size of an open regular order in place, submitting the change through the same atomic amendment, and SHALL expose an unambiguous cancel control on every cancellable row.

#### Scenario: Operator edits price and size in the list
- **WHEN** the operator enters a new price or a new notional for an open order and confirms
- **THEN** one amendment carrying both values is emitted for that order

#### Scenario: Operator cancels from the list
- **WHEN** the operator activates the cancel control on a row
- **THEN** a cancel command is emitted for that order and the control is labelled so its purpose is unambiguous

### Requirement: Positions and working orders are continuously visible
The workstation SHALL present open positions and working orders without requiring the operator to open a tab, including per-position signed unrealized PnL, return on margin, and an aggregate unrealized PnL, and SHALL mark position entry and liquidation prices on the chart.

#### Scenario: A position is open
- **WHEN** the account holds an open position
- **THEN** its direction, size, entry, mark, liquidation, margin mode, leverage, signed PnL, and return on margin are visible alongside the chart, and its entry and liquidation prices are drawn on the chart

#### Scenario: Losses and gains are distinguishable
- **WHEN** unrealized PnL is negative
- **THEN** it is rendered with an explicit sign and the negative colour, distinctly from a positive value

### Requirement: Actionable exchange rejections state the operator remedy
When Binance rejects a futures command with a code whose resolution is known, the rejection surfaced to the operator SHALL include the concrete remedy in addition to the exchange message and code.

#### Scenario: The key is refused for trading
- **WHEN** Binance rejects a place, cancel, or amend command with code `-2015`
- **THEN** the reported rejection states that the futures key must have Futures trading enabled and that an IP-restricted key must allow the current address, while account reads may continue to succeed

## MODIFIED Requirements

### Requirement: Selected-symbol orders are visible in both trading views
The sidebar and chart SHALL display every supported open regular and algorithmic order for the selected symbol from the latest usable account state. Both views SHALL use the same normalized source and SHALL expose partial, stale, or failed synchronization instead of silently rendering an apparently empty result. Chart order handles SHALL identify an order by its notional in USDT and offer a cancel control, leaving the exact price to the price axis.

#### Scenario: Exchange-created limit order exists
- **WHEN** the account holds a regular LIMIT order created outside this application for the selected symbol
- **THEN** it appears in both the sidebar and on the chart with its side-derived colour and remains cancellable and draggable

#### Scenario: Chart handle identifies an order
- **WHEN** an open order is drawn on the chart
- **THEN** its handle shows the order notional in USDT and a cancel control, its exact price is readable from the price axis, and no duplicate price label is drawn over the axis

#### Scenario: Exchange-created stop or take-profit order exists
- **WHEN** an open algorithmic stop or take-profit order for the selected symbol exists on Binance
- **THEN** the order appears in both the selected-symbol sidebar and on the chart using the relevant trigger and order-price semantics, shown as display-only without a cancel control and identified as managed on Binance

#### Scenario: Order synchronization has never succeeded
- **WHEN** the selected-symbol order view has no confirmed snapshot because synchronization failed
- **THEN** the UI shows an unavailable/error state and does not present an empty list as proof that no orders exist
