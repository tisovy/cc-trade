## ADDED Requirements

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
