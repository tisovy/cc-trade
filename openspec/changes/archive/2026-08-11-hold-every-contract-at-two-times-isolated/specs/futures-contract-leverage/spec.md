## ADDED Requirements

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

## MODIFIED Requirements

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
