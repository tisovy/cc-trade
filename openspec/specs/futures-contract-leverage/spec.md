# futures-contract-leverage Specification

## Purpose

Defines how the Futures desk reads, retains, presents, and changes the
exchange-owned leverage and margin mode of each contract, including safe
defaults, bracket ceilings, explicit unknown state, and the risk shown wherever
an order or open position carries that configuration.

## Requirements
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

### Requirement: The leverage is stated where the position and the order are
The desk SHALL state the multiple beside the contract on the order ticket and
beside each open position's symbol, and each of those readings SHALL be the control
that changes it. The confirmation panel — the last surface an operator reads
before an order is sent — SHALL state the multiple the entry will be carried at,
prominently and in the colour the desk reserves for liquidation readings. There it
is a reading and not a control: nothing on the panel that sends an order may also
change the terms of it.

#### Scenario: An entry is being sized
- **WHEN** the operator is sizing an order on a contract whose leverage is known
- **THEN** the ticket states the multiple beside the contract and states the margin the draft would hold as its notional divided by that multiple

#### Scenario: A position is listed
- **WHEN** the dock lists an open position
- **THEN** its row states the multiple it is carried at, next to its contract

#### Scenario: An order is confirmed
- **WHEN** an order is staged for confirmation on a contract whose leverage is known
- **THEN** the confirmation panel states that multiple in the same yellow as the liquidation reading, at a size read at a glance

#### Scenario: The leverage is unknown at confirmation
- **WHEN** an order is staged on a contract whose leverage the exchange has not reported
- **THEN** the confirmation panel states that it is unknown rather than a multiple, and never a default one

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

### Requirement: A flat contract is held at the desk's default of 2× isolated
The desk SHALL hold every contract it works on at 2× isolated margin unless the
operator has said otherwise, because a contract the desk has never traded arrives
carrying whatever the exchange's account-wide setting left on it, and a multiple
nobody chose is the multiple an entry is carried at. When a contract's
configuration is read, the desk SHALL lower a multiple above 2 to 2 and SHALL
move a CROSSED margin mode to ISOLATED.

The default SHALL only ever lower risk and SHALL only ever apply to a contract
that is flat:

- A multiple at or below 2 SHALL be left as it is: the desk does not raise a
  multiple the operator did not ask it to raise.
- A contract carrying an open position SHALL NOT be touched, because changing
  its leverage moves the liquidation price of money already at risk.
- The margin mode of a contract with a working order SHALL be left alone, because
  the exchange refuses that change while an order rests and a refusal the operator
  did not ask for is noise on the surface that reports real ones. The multiple is
  still lowered: the exchange permits that one.
- The default SHALL be applied at most once per contract per session, so a
  multiple the operator sets by hand is never revised by the desk afterwards.
- The default SHALL NOT be applied while the account's position reading is
  absent or no longer current, so neither an unread account nor one unconfirmed
  since a dropped connection is mistaken for a flat one.
- The default SHALL NOT be applied while trading is paused, for the same reason
  a paused desk refuses these changes at all: a default applied then would reach
  the operator only as refusals they did not ask for.

#### Scenario: A contract the exchange holds at a high multiple is opened
- **WHEN** the desk reads the configuration of a flat contract and the exchange reports 20×
- **THEN** the desk sets that contract to 2×, and the multiple the desk then states is the one the exchange applied

#### Scenario: The contract is carried cross
- **WHEN** the configuration of a flat contract reports CROSSED margin
- **THEN** the desk sets that contract to ISOLATED

#### Scenario: The contract is already at or below the default
- **WHEN** the configuration reports 1× or 2×
- **THEN** nothing is sent for that contract

#### Scenario: A position is open on the contract
- **WHEN** the configuration is read for a contract the account holds a position on
- **THEN** neither the multiple nor the margin mode is changed

#### Scenario: The operator raises the multiple and returns to the contract
- **WHEN** the operator sets a contract to 10× and later selects another contract and comes back
- **THEN** the contract is still 10×: the default is not applied to it a second time

#### Scenario: The account has not been read yet
- **WHEN** a contract's configuration arrives before any successful position read
- **THEN** nothing is sent, and the default is applied once the positions are read

#### Scenario: An order rests on the contract
- **WHEN** the configuration is read for a flat contract that has a working order
- **THEN** the multiple is lowered and the margin mode is left alone, and the mode is set once the order is gone

#### Scenario: Trading is paused
- **WHEN** a contract's configuration arrives while trading is paused
- **THEN** nothing is sent, and the default is applied when trading resumes

### Requirement: The margin mode of a contract can be set from the desk
The desk SHALL send a margin-mode change as a typed command that names one
contract explicitly, validated before any signed request, refused while trading
is paused for the same reason a leverage change is. The desk SHALL report the
mode the exchange holds after the change rather than the one requested. A change
the exchange answers with "no need to change margin type" SHALL be treated as the
contract already being in that mode, not as a failure.

#### Scenario: The mode is changed on a flat contract
- **WHEN** a margin-mode change is applied to a contract with no position
- **THEN** it is sent for that contract, the contract's configuration is re-read, and the account is re-read

#### Scenario: The command carries no contract or an unknown mode
- **WHEN** a margin-mode command arrives without a symbol, or with a mode that is neither ISOLATED nor CROSSED
- **THEN** it is refused before any signed request, naming the field it refused

#### Scenario: The contract is already in the requested mode
- **WHEN** the exchange answers that there is no need to change the margin type
- **THEN** the desk treats the contract as being in that mode and reports no failure

#### Scenario: Trading is paused
- **WHEN** a margin-mode change is applied while trading is paused
- **THEN** it is refused with the paused reason and nothing is sent to the exchange
