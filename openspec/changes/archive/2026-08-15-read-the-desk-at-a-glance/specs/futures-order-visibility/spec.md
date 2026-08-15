## ADDED Requirements

### Requirement: Account-wide order symbols switch the trading contract
Every valid contract symbol in the trading rail's account-wide open-order table SHALL be an explicit keyboard- and pointer-operable control. Activating that control SHALL select the row's contract through the normal workstation symbol-selection path without opening the order editor, cancelling the order, or activating any other row action. The compact visible label MAY omit the common `USDT` suffix, but its accessible name and pointer title SHALL identify the whole contract.

#### Scenario: Operator selects another order's symbol
- **WHEN** the trading rail lists an order for `TUTUSDT` while another contract is selected and the operator activates the row's symbol control
- **THEN** `TUTUSDT` becomes the selected contract and no order edit or cancellation action is emitted

#### Scenario: Operator activates the symbol with a keyboard
- **WHEN** focus is on a trading-rail symbol control and the operator activates it with the keyboard
- **THEN** the same contract-selection action occurs as for a pointer activation

### Requirement: Compact working-order rows preserve small prices
At the supported Futures workstation rail width and default interface scale, a working-order row SHALL show a quoted price as small as `0.000123` in full, alongside its compact symbol label, side, USDT value, and order action. The price SHALL not be replaced by an ellipsis or wrapped onto another line; values beyond the supported visible track SHALL retain their exact reading through the cell's secondary detail.

#### Scenario: A small decimal order price is listed
- **WHEN** a working order in the trading rail has the formatted price `0.000123`
- **THEN** the row visibly states `0.000123` without ellipsis or wrapping and keeps its symbol, side, USDT value, and action visible

### Requirement: Order-history filled value is stated in USDT
The order-history `Filled` column SHALL state the USDT notional that actually executed rather than displaying executed and original contract quantities as its primary value. The presentation SHALL use the exchange's positive cumulative quote amount when available, otherwise SHALL derive the value from executed quantity and positive average fill price, and SHALL report the value as absent when neither source can establish it. The header SHALL name USDT, while the exact executed and original contract quantities and exact USDT value SHALL remain available as secondary detail.

#### Scenario: Exchange reports cumulative quote value
- **WHEN** an order-history row reports `16441` executed contracts and a positive cumulative quote amount of `3259000.25`
- **THEN** the Filled column presents that executed USDT value under a USDT-labelled header and retains the contract quantities and exact USDT amount as secondary detail

#### Scenario: Cumulative quote value is absent
- **WHEN** an order-history row reports `5000` executed contracts, an average fill price of `0.01962`, and no positive cumulative quote amount
- **THEN** the Filled column presents `98.10` USDT as the derived executed notional and identifies the derivation in its secondary detail

#### Scenario: An order has no established execution value
- **WHEN** an order-history row has no positive cumulative quote amount and lacks either a positive executed quantity or a positive average fill price
- **THEN** the Filled column reads as absent rather than as a confident zero-USDT execution
