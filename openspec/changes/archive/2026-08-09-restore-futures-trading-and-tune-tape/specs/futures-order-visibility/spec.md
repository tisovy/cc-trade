## Purpose

Defines how Binance USDⓈ-M regular and algorithmic open orders are synchronized, reconciled, and presented consistently for the selected futures contract without losing account-wide state.

## ADDED Requirements

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
The sidebar and chart SHALL display every supported open regular and algorithmic order for the selected symbol from the latest usable account state. Both views SHALL use the same normalized source and SHALL expose partial, stale, or failed synchronization instead of silently rendering an apparently empty result.

#### Scenario: Exchange-created limit order exists
- **WHEN** an open regular limit order for the selected symbol exists on Binance
- **THEN** the order appears in both the selected-symbol sidebar and on the chart at its limit price

#### Scenario: Exchange-created stop or take-profit order exists
- **WHEN** an open algorithmic stop or take-profit order for the selected symbol exists on Binance
- **THEN** the order appears in both the selected-symbol sidebar and on the chart using the relevant trigger and order-price semantics

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

