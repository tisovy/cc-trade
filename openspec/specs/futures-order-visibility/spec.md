# futures-order-visibility

## Purpose

Defines account-wide synchronization of regular and algorithmic Futures orders and their consistent presentation across the chart and sidebar.
## Requirements
### Requirement: The account order model includes regular and algorithmic orders
The system SHALL synchronize both regular open orders and currently open algorithmic orders from the authenticated USDⓈ-M account. Each normalized order SHALL retain its source kind, exchange identity, symbol, side, type, status, quantity, prices relevant to that type, reduce-only or close-position intent when supplied, and exchange update time.

#### Scenario: Account has regular and algorithmic orders for TUTUSDT
- **WHEN** Binance returns one regular order and one algorithmic order for `TUTUSDT`
- **THEN** both orders are present in the normalized account order state with distinct source kinds and identities

#### Scenario: The same numeric identifier occurs in two namespaces
- **WHEN** a regular order and an algorithmic order share the same numeric identifier
- **THEN** they remain distinct because order identity includes the source kind

#### Scenario: One order endpoint fails
- **WHEN** either the regular-order or algorithmic-order request fails while the other succeeds
- **THEN** the successful source is updated, the failed source retains its last confirmed snapshot if any, and the UI reports partial synchronization rather than claiming the combined order list is complete

### Requirement: Account-wide snapshots are not replaced by symbol-scoped data
The system SHALL keep the authoritative open-order snapshot account-wide. Selecting a chart symbol, refreshing one symbol, placing an order, receiving an order update, or canceling an order SHALL reconcile the affected records without deleting confirmed open orders for unrelated symbols.

#### Scenario: Selected symbol changes
- **WHEN** the operator moves from one futures symbol to another
- **THEN** the account-wide order snapshot remains intact and the chart/sidebar derive the appropriate selected-symbol view from it

#### Scenario: Post-placement refresh targets one symbol
- **WHEN** a successful placement triggers reconciliation for the placed symbol
- **THEN** open orders previously confirmed for other symbols remain in account state

#### Scenario: Terminal execution update arrives
- **WHEN** an order update reports a terminal status for one order
- **THEN** only the matching source-qualified order is removed from the open-order view

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

### Requirement: Chart interactions respect order source semantics
The chart SHALL distinguish regular and algorithmic orders visually and accessibly. An order SHALL be draggable or cancellable only when the corresponding authenticated exchange operation and identity mapping are supported; otherwise it SHALL remain visible with an explicit display-only indication.

#### Scenario: Supported regular limit order is amended
- **WHEN** the operator drags an amendable regular limit order to a valid exchange-filtered price and confirms the action
- **THEN** the system sends the source-appropriate operation and reconciles the exchange response

#### Scenario: Algorithmic order amendment is not supported
- **WHEN** an algorithmic order is displayed but source-aware amendment is unavailable
- **THEN** the chart does not offer drag amendment and identifies the order as display-only

### Requirement: Order reconciliation remains current after startup
After the first snapshot, the system SHALL combine authenticated user-data updates with periodic or operator-requested REST reconciliation so that missed stream events or reconnects do not leave the visible order state permanently incorrect.

#### Scenario: User-data stream reconnects
- **WHEN** the authenticated stream disconnects and reconnects
- **THEN** the system marks stream-derived order state stale until a REST reconciliation succeeds

#### Scenario: Manual refresh completes
- **WHEN** the operator requests an account refresh and both order sources succeed
- **THEN** the visible selected-symbol orders match the new account-wide snapshots and their freshness becomes ready

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

### Requirement: Confirmed order updates survive an older account snapshot
The system SHALL treat a confirmed execution report as authoritative until the
account snapshot it is reconciled against is at least as recent. An account
snapshot SHALL NOT replace an open order with an older version of that same
order.

#### Scenario: Snapshot arrives with pre-amendment values
- **WHEN** an amendment is confirmed and the account synchronization that follows returns the order with an earlier update time
- **THEN** the order keeps the confirmed price and size, and no operator refresh is required to see them

#### Scenario: Snapshot is newer than the local report
- **WHEN** the account snapshot reports the order with a later update time than the last locally applied report
- **THEN** the snapshot values replace the local ones

### Requirement: A position can be closed at market or with a reduce-only limit
The system SHALL let the operator close an open position either immediately at
market or through a reduce-only limit order at an operator-chosen price, for
the whole position or a smaller size, from the same control.

#### Scenario: Operator closes at market
- **WHEN** the operator confirms a market close
- **THEN** one reduce-only MARKET order is submitted on the side that reduces the position, for the requested size

#### Scenario: Operator closes with a limit
- **WHEN** the operator enters a close price and confirms a limit close
- **THEN** one reduce-only LIMIT order is submitted on the side that reduces the position, at the entered price, snapped to the contract's tick and step filters

#### Scenario: Requested close size exceeds the position
- **WHEN** the entered size is larger than the open position
- **THEN** the submission is refused with a stated reason and no order is sent

### Requirement: Every order surface opens the same editor
The system SHALL open the order editor from a chart order handle, from an order
row in the trading rail, and from a working-order row in the dock, and SHALL
apply price and size changes from it as one amendment.

#### Scenario: Operator activates a dock working-order row
- **WHEN** the operator activates a working-order row in the dock away from its explicit controls
- **THEN** the order editor opens for that order with its current price and USDT amount

#### Scenario: Row carries an exchange-managed order
- **WHEN** the row carries a conditional or strategy order the app does not amend
- **THEN** no editor opens and the row stays display-only

### Requirement: Order and trade history is available in the app
The system SHALL provide, on operator request, the recent order history and the
recent trade history of the selected contract, including each trade's realized
PnL and fee, and SHALL report a failed history request without disturbing live
trading state.

#### Scenario: Operator opens history
- **WHEN** the operator opens the history view for the selected contract
- **THEN** the recent orders with their status, side, price, size, filled size and time are listed, and the recent trades with price, size, fee and signed realized PnL are listed

#### Scenario: History request fails
- **WHEN** the exchange rejects or the transport drops a history request
- **THEN** the failure is reported in the history view with its bounded code, and positions, working orders and balances remain unchanged

#### Scenario: Operator switches contract
- **WHEN** the selected contract changes
- **THEN** history for the previous contract is discarded rather than shown under the new one

