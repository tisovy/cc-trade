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
this desk is worth looking for. It SHALL be read afresh whenever the desk selects the
contract or changes the setting itself, and SHALL be dropped when it can no longer be
trusted — and dropped everywhere it is held, so no surface keeps stating a configuration
that belongs to an account the desk has left.

The desk SHALL read both fields for the contract it starts on, and SHALL NOT leave that
read unmade. A read that could not be sent because the local backend was not yet
listening SHALL be sent once it is, and a read that failed or was superseded SHALL be
issued again on a following account pass rather than abandoned. This is the reading every
later surface is built on: nothing announces the margin mode of a flat contract, so a
configuration missed at startup is missed until the operator changes contract.

Neither field SHALL be presented as anything but absent until it has been read. A
leverage the exchange has not reported SHALL NOT be shown as a multiple, and a margin
mode it has not reported SHALL NOT be shown as isolated.

#### Scenario: The desk changes contract
- **WHEN** the operator selects a different contract
- **THEN** that contract's leverage, margin mode and ceiling are read and reported for it

#### Scenario: The desk starts on the contract it was left on
- **WHEN** the desk starts and restores the contract the operator last worked on
- **THEN** that contract's leverage, margin mode and ceiling are read before it is traded

#### Scenario: The backend is not listening when the desk starts
- **WHEN** the startup configuration read cannot be sent because the local backend connection is not yet open
- **THEN** it is sent once that connection opens, and the contract's leverage and margin mode are stated as unknown until it answers

#### Scenario: The startup read fails
- **WHEN** the configuration read issued at startup fails or is superseded
- **THEN** the contract is treated as one whose configuration is not held, and the read is issued again on a following account pass

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
- **THEN** every held configuration is dropped, in the renderer as well as in the backend, so none can outlive the account it belongs to

#### Scenario: The exchange reports no leverage
- **WHEN** a configuration read carries no usable leverage
- **THEN** the desk states that it is unknown rather than showing a multiple, and any margin estimate derived from it states the whole notional instead

### Requirement: Leverage can be changed from the desk, bounded by the contract
The desk SHALL offer a control that sets the leverage of one named contract,
bounded by that contract's own bracket ceiling, and SHALL send the change as a
typed command that names the contract explicitly with no fallback to the contract
on screen. The desk SHALL report the leverage the exchange applied rather than the
one requested, and SHALL re-read the account afterwards, because the change moves what
every position and every resting order on that contract is required to hold in margin,
and therefore what is free to trade with.

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

### Requirement: The margin mode of a contract can be set from the desk
The desk SHALL offer a control that sets the margin mode of one named contract, stating
the mode that contract is in and changing it on a single action. It SHALL send the change
as a typed command that names the contract explicitly with no fallback to the contract on
screen, validated before any signed request, and refused while trading is paused for the
same reason a leverage change is. The desk SHALL report the mode the exchange holds after
the change rather than the one requested. A change the exchange answers with "no need to
change margin type" SHALL be treated as the contract already being in that mode, not as a
failure.

Where the desk already holds the reading that tells it the exchange will refuse — an open
position on that contract, which Binance answers with `-4048`, or a working order, which
it answers with `-4047` — the control SHALL state that reason rather than spend a signed
request on a refusal. A refusal the desk could have predicted is noise on the surface
that reports the ones it could not.

#### Scenario: The mode is changed on a flat contract
- **WHEN** the operator acts on the margin-mode control for a contract with no position and no working order
- **THEN** the other mode is sent for that contract, the contract's configuration is re-read, and the account is re-read

#### Scenario: A position is open on the contract
- **WHEN** the operator acts on the margin-mode control for a contract the account holds a position on
- **THEN** the control states that the exchange will not change the mode while a position is open, and nothing is sent

#### Scenario: An order rests on the contract
- **WHEN** the operator acts on the margin-mode control for a contract that has a working order
- **THEN** the control states that the exchange will not change the mode while an order rests, and nothing is sent

#### Scenario: The command carries no contract or an unknown mode
- **WHEN** a margin-mode command arrives without a symbol, or with a mode that is neither ISOLATED nor CROSSED
- **THEN** it is refused before any signed request, naming the field it refused

#### Scenario: The contract is already in the requested mode
- **WHEN** the exchange answers that there is no need to change the margin type
- **THEN** the desk treats the contract as being in that mode and reports no failure

#### Scenario: The change never reaches the backend
- **WHEN** the margin-mode command cannot be delivered to the local backend
- **THEN** the control says the mode was not changed rather than presenting the requested mode as the one held

#### Scenario: Trading is paused
- **WHEN** a margin-mode change is applied while trading is paused
- **THEN** it is refused with the paused reason and nothing is sent to the exchange

### Requirement: A leverage change made elsewhere reaches the desk on the stream
When the exchange reports on the authenticated stream that a contract's leverage
has changed, the desk SHALL apply what the frame states to the held
configuration for that contract, without reading the account back to learn what
it has just been told. The change SHALL reach every surface that states
leverage, and SHALL NOT pass through an unknown or default value on its way
there.

A frame naming a contract the desk holds no configuration for SHALL NOT cause a
configuration to be invented for it; the desk's own read remains the source when
that contract is next held.

Margin mode SHALL NOT be taken from this frame. The exchange's account
configuration event carries a pair's leverage and the account's Multi-Assets
mode, and no per-contract margin mode at all — a mode changed on a contract the
operator holds arrives as part of the position update, and one changed on a
contract the operator is flat in is not announced. Where the desk states a
margin mode it has not been told about since it last read, it SHALL be stating
what it read, not what it inferred from a leverage frame.

For the same reason, such a frame SHALL NOT extend how long the desk considers the held
configuration current. The hold measures time since the desk last asked the exchange, and
a frame carrying one field cannot vouch for the other: restarting the hold on a leverage
frame dates the margin mode to a moment nothing read it.

#### Scenario: Leverage is changed away from this desk
- **WHEN** the operator changes a contract's leverage in the Binance app and the stream reports it
- **THEN** the desk states the new leverage, without an account read and without showing a default in between

#### Scenario: The frame names a contract the desk does not hold
- **WHEN** a leverage change arrives for a contract the desk holds no configuration for
- **THEN** nothing is invented for it, and the desk's own reads remain the source when that contract is next held

#### Scenario: The margin mode of a flat contract is changed elsewhere
- **WHEN** the operator changes the margin mode of a contract they hold no position in
- **THEN** the desk does not claim to have learned it from the stream, and the mode it states remains the one it last read

#### Scenario: A leverage frame arrives for a held contract
- **WHEN** a leverage frame arrives for a contract whose configuration is approaching the end of its hold
- **THEN** the leverage is applied and the hold is not restarted, so the configuration still dates from the last time the desk read it

### Requirement: The leverage and the margin mode are stated where the position and the order are
The desk SHALL state both the multiple and the margin mode beside the contract on the
order ticket, and SHALL state the multiple beside each open position's symbol. The
ticket's readings of each SHALL be the control that changes it. The confirmation panel —
the last surface an operator reads before an order is sent — SHALL state both the
multiple the entry will be carried at and the mode it will be carried in, prominently and
in the colour the desk reserves for liquidation readings, because the mode is what
decides whether a loss is bounded by that position's margin or by the wallet. There they
are readings and not controls: nothing on the panel that sends an order may also change
the terms of it.

Neither reading SHALL be invented. A margin mode the exchange has not reported SHALL be
presented as absent, never as isolated, for the same reason a leverage nobody stated is
never shown as a multiple.

#### Scenario: An entry is being sized
- **WHEN** the operator is sizing an order on a contract whose leverage and margin mode are known
- **THEN** the ticket states the multiple and the mode beside the contract, and states the margin the draft would hold as its notional divided by that multiple

#### Scenario: A position is listed
- **WHEN** the dock lists an open position
- **THEN** its row states the multiple it is carried at, next to its contract

#### Scenario: An order is confirmed
- **WHEN** an order is staged for confirmation on a contract whose leverage and margin mode are known
- **THEN** the confirmation panel states both in the same yellow as the liquidation reading, at a size read at a glance

#### Scenario: The leverage is unknown at confirmation
- **WHEN** an order is staged on a contract whose leverage the exchange has not reported
- **THEN** the confirmation panel states that it is unknown rather than a multiple, and never a default one

#### Scenario: The margin mode is unknown at confirmation
- **WHEN** an order is staged on a contract whose margin mode the desk holds no reading of
- **THEN** the confirmation panel states that the mode is unknown rather than naming one, and does not present it as isolated

### Requirement: A flat contract is held at the desk's default of 1×
The desk SHALL hold every contract it works on at 1× unless the operator has said
otherwise, because a contract the desk has never traded arrives carrying whatever the
exchange's account-wide setting left on it, and a multiple nobody chose is the multiple
an entry is carried at. When a contract's configuration is read, the desk SHALL lower a
multiple above 1 to 1.

The desk SHALL NOT change the margin mode of any contract by itself. The mode is a choice
about how risk is carried rather than an amount of it, and a desk that reverted it would
be overruling a decision the operator made — including one made in the exchange's own
app, which the desk cannot distinguish from an inherited setting.

The default SHALL only ever lower risk and SHALL only ever apply to a contract that is
flat:

- A multiple at 1 SHALL be left as it is: the desk does not raise a multiple the operator
  did not ask it to raise.
- A contract carrying an open position SHALL NOT be touched. The multiple decides what
  margin the exchange requires against that position, so lowering it calls margin in
  against money already at risk — and on a contract carried in isolated margin the
  exchange refuses the change outright.
- The default SHALL be applied at most once per contract per session, so a multiple the
  operator sets by hand is never revised by the desk afterwards.
- The default SHALL NOT be applied while the account's position reading is absent or no
  longer current, so neither an unread account nor one unconfirmed since a dropped
  connection is mistaken for a flat one.
- The default SHALL NOT be applied while trading is paused, for the same reason a paused
  desk refuses these changes at all: a default applied then would reach the operator only
  as refusals they did not ask for.

#### Scenario: A contract the exchange holds at a high multiple is opened
- **WHEN** the desk reads the configuration of a flat contract and the exchange reports 20×
- **THEN** the desk sets that contract to 1×, and the multiple the desk then states is the one the exchange applied

#### Scenario: The contract is carried cross
- **WHEN** the configuration of a flat contract reports CROSSED margin
- **THEN** the margin mode is left as it is, and only the multiple is lowered

#### Scenario: The contract is already at the default
- **WHEN** the configuration reports 1×
- **THEN** nothing is sent for that contract

#### Scenario: A position is open on the contract
- **WHEN** the configuration is read for a contract the account holds a position on
- **THEN** the multiple is not changed

#### Scenario: The operator raises the multiple and returns to the contract
- **WHEN** the operator sets a contract to 10× and later selects another contract and comes back
- **THEN** the contract is still 10×: the default is not applied to it a second time

#### Scenario: The account has not been read yet
- **WHEN** a contract's configuration arrives before any successful position read
- **THEN** nothing is sent, and the default is applied once the positions are read

#### Scenario: Trading is paused
- **WHEN** a contract's configuration arrives while trading is paused
- **THEN** nothing is sent, and the default is applied when trading resumes

#### Scenario: The desk is restarted after the operator chose cross
- **WHEN** the operator sets a contract to CROSSED and the desk is later restarted and reads that contract again
- **THEN** the contract is still CROSSED, and no margin-mode command is sent

### Requirement: A leverage change on an open position is stated for what it does, and what the exchange refuses is refused here
Where a position is already open on the contract, the control SHALL state what the change
does to it, which is not what the desk used to claim. The multiple sets the margin the
exchange *requires* against a position, not the margin already standing behind one, and
the liquidation price the desk draws is computed from the margin behind the position, the
contract's maintenance rate and, in cross margin, the whole wallet — the multiple appears
in none of those terms. The control SHALL NOT state that a change moves the liquidation
price of a position already open.

Where the desk already holds the reading that tells it the exchange will refuse — a lower
multiple on a contract carried in isolated margin while a position is open, which Binance
answers with `-4161` — the control SHALL state that reason, SHALL NOT offer the change,
and SHALL send nothing. Every other change on an open contract SHALL still be offered:
raising the multiple in isolated margin, and either direction in cross.

A refusal that does reach the exchange SHALL be reported against the contract it names.
These two commands carry no order identity, so the contract is the whole of it: a leverage
or margin-mode refusal recorded without one leaves the desk's record saying only that
something was refused somewhere.

A paused desk SHALL refuse a leverage change, for the same reason it refuses taking
margin out of a position.

#### Scenario: A position is open on the contract
- **WHEN** the operator opens the leverage control for a contract they hold a position on
- **THEN** it states that the multiple sets what an entry is required to hold, and that the liquidation price of the position already open does not move with it

#### Scenario: The multiple is being raised on an open position
- **WHEN** the chosen multiple is above the current one and a position is open
- **THEN** the control still states that the position's liquidation price does not move, and never that the position will stand behind less margin

#### Scenario: A lower multiple is chosen on an open isolated contract
- **WHEN** the operator chooses a multiple below the current one on a contract carried in isolated margin that holds a position
- **THEN** the control states that the exchange will not lower it while the position is open, the change cannot be applied, and nothing is sent

#### Scenario: A lower multiple is chosen on an open cross contract
- **WHEN** the operator chooses a multiple below the current one on a contract carried in cross margin that holds a position
- **THEN** the change is offered and sent, because the exchange takes it

#### Scenario: A lower multiple is chosen on a flat isolated contract
- **WHEN** the operator chooses a multiple below the current one on an isolated contract holding no position
- **THEN** the change is offered and sent

#### Scenario: The exchange refuses a leverage or margin-mode change
- **WHEN** the exchange refuses either change
- **THEN** the refusal names the contract it was refused on, and states what the code means in the desk's own words where the desk knows

#### Scenario: Trading is paused
- **WHEN** the operator applies a leverage change while trading is paused
- **THEN** the change is refused with the paused reason and nothing is sent to the exchange
