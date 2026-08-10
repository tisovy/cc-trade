# futures-contract-leverage Specification

## Purpose
TBD - created by archiving change state-and-set-the-leverage. Update Purpose after archive.
## Requirements
### Requirement: The leverage a contract is set to is read from the exchange
The desk SHALL read the leverage and margin mode of a contract from the exchange's
own account configuration rather than inferring either, because the position read
no longer reports them. It SHALL read the contract the desk is working on whenever
that changes, and the contracts holding open positions after an account refresh,
bounded so a large account cannot spend the request budget on it. A leverage the
exchange has not reported SHALL be presented as absent, never as a default
multiple.

#### Scenario: The desk changes contract
- **WHEN** the operator selects a different contract
- **THEN** that contract's leverage, margin mode and ceiling are read and reported for it

#### Scenario: The account holds positions on several contracts
- **WHEN** an account refresh reports open positions
- **THEN** the leverage of each position's contract is read and each position row states the multiple it is carried at

#### Scenario: The exchange reports no leverage
- **WHEN** a configuration read carries no usable leverage
- **THEN** the desk states that it is unknown rather than showing a multiple, and any margin estimate derived from it states the whole notional instead

### Requirement: The leverage is stated where the position and the order are
The desk SHALL state the multiple beside the contract on the order ticket and
beside each open position's symbol, and each of those readings SHALL be the control
that changes it.

#### Scenario: An entry is being sized
- **WHEN** the operator is sizing an order on a contract whose leverage is known
- **THEN** the ticket states the multiple beside the contract and states the margin the draft would hold as its notional divided by that multiple

#### Scenario: A position is listed
- **WHEN** the dock lists an open position
- **THEN** its row states the multiple it is carried at, next to its contract

### Requirement: Leverage can be changed from the desk, bounded by the contract
The desk SHALL offer a control that sets the leverage of one named contract,
bounded by that contract's own bracket ceiling, and SHALL send the change as a
typed command that names the contract explicitly with no fallback to the contract
on screen. The desk SHALL report the leverage the exchange applied rather than the
one requested, and SHALL re-read the account afterwards, because the change moves
margin requirements and the liquidation price of any open position.

#### Scenario: The operator sets a multiple
- **WHEN** the operator chooses a multiple within the contract's ceiling and applies it
- **THEN** the change is sent for that contract, the exchange's answer is what the desk then states, and the account is re-read

#### Scenario: The exchange lowers the requested multiple
- **WHEN** the exchange applies a lower multiple than the one requested
- **THEN** the desk states the applied multiple, not the requested one

#### Scenario: A multiple above the contract's ceiling is offered
- **WHEN** the contract's bracket ceiling is below the highest multiple the exchange supports
- **THEN** no stop above that ceiling is offered and the ceiling itself is offered

#### Scenario: The command carries no contract or a fractional multiple
- **WHEN** a leverage command arrives without a symbol, or with a fractional or out-of-range multiple
- **THEN** it is refused before any signed request, naming the field it refused

### Requirement: Changing leverage on an open position is stated as risk
Where a position is already open on the contract, the control SHALL state before the
change that the position's liquidation price moves with it, and SHALL say so more
plainly when the multiple is being raised. A paused desk SHALL refuse a leverage
change, for the same reason it refuses taking margin out of a position.

#### Scenario: A position is open on the contract
- **WHEN** the operator opens the leverage control for a contract they hold a position on
- **THEN** it states that the change moves that position's liquidation price

#### Scenario: The multiple is being raised
- **WHEN** the chosen multiple is above the current one and a position is open
- **THEN** the control states that the same position will stand behind less margin, so its liquidation price moves closer to the mark

#### Scenario: Trading is paused
- **WHEN** the operator applies a leverage change while trading is paused
- **THEN** the change is refused with the paused reason and nothing is sent to the exchange

