## MODIFIED Requirements

### Requirement: The leverage a contract is set to is read from the exchange
The desk SHALL read the leverage and margin mode of a contract from the exchange's
own account configuration rather than inferring either, because the position read
no longer reports them. It SHALL read the contract the desk is working on whenever
that changes, and any contract holding an open position that it holds no
configuration for, bounded so a large account cannot spend the request budget on
it. A configuration already held SHALL be reused rather than re-read on an
automatic account refresh, until it is old enough that a change made outside
this desk is worth looking for. It SHALL be read afresh whenever the desk
selects the contract or changes the setting itself, and SHALL be dropped when it
can no longer be trusted. A leverage the exchange has not reported SHALL be
presented as absent, never as a default multiple.

#### Scenario: The desk changes contract
- **WHEN** the operator selects a different contract
- **THEN** that contract's leverage, margin mode and ceiling are read and reported for it

#### Scenario: The account holds positions on several contracts
- **WHEN** an account refresh reports open positions
- **THEN** the leverage of each position's contract is read and each position row states the multiple it is carried at

#### Scenario: A refresh reports the same positions again
- **WHEN** an automatic account refresh reports positions whose configurations are already held
- **THEN** no configuration read is issued and the rows state the multiples already known

#### Scenario: A configuration is old enough to have changed elsewhere
- **WHEN** an account refresh reports positions whose configurations were read longer ago than the desk holds them for
- **THEN** those configurations are read again, so a leverage changed in the exchange's own app is picked up without the operator asking

#### Scenario: The market is left
- **WHEN** the Futures market is deactivated or the credentials change
- **THEN** every held configuration is dropped, so none can outlive the account it belongs to

#### Scenario: The exchange reports no leverage
- **WHEN** a configuration read carries no usable leverage
- **THEN** the desk states that it is unknown rather than showing a multiple, and any margin estimate derived from it states the whole notional instead
