# futures-position-margin Specification

## Purpose
The margin behind an open position is what its liquidation price is computed
from, and it is the one property of a live position the operator can change
without trading. This capability makes it visible on the position row and
adjustable from it.
## Requirements
### Requirement: Every open position states the margin committed to it
The positions dock SHALL display, for each open position, the margin the
exchange reports as committed to it, next to the ROE that is measured against
that margin. The figure SHALL come from the account read and SHALL NOT be
computed from leverage when the exchange reports the amount directly.

#### Scenario: An isolated position is listed
- **WHEN** the account read reports a position holding isolated wallet funds
- **THEN** the row shows that isolated amount as the position's margin, marked as isolated

#### Scenario: A cross position is listed
- **WHEN** the account read reports a position with no isolated wallet
- **THEN** the row shows the initial margin the exchange reports for it, marked as cross

#### Scenario: The exchange reports no margin figure
- **WHEN** the read carries no committed margin for a position and no leverage to derive one from
- **THEN** the row shows no margin rather than a zero

#### Scenario: The row shows both ROE and the margin it is measured against
- **WHEN** a position row displays a ROE percentage
- **THEN** the margin shown on that row is the amount that percentage was divided by, so the two cannot disagree

### Requirement: An isolated position's margin can be changed from its row
Clicking the margin figure of an open position SHALL open a panel, at the
cursor, that submits an increase or a decrease of that one position's margin.
The panel SHALL state the position's current margin and the balance available
to add before the operator commits.

#### Scenario: Margin is added
- **WHEN** the operator submits an increase for an isolated position
- **THEN** a single `trade.adjustPositionMargin` command for that symbol and position side is sent, and the account is re-read so the row shows the exchange's new figure

#### Scenario: Margin is removed
- **WHEN** the operator submits a decrease for an isolated position
- **THEN** a single decrease command is sent for that position and no order is placed

#### Scenario: The panel is dismissed
- **WHEN** the operator clicks outside the panel or closes it
- **THEN** nothing is submitted and the position is untouched

### Requirement: A margin adjustment that cannot succeed is refused with its reason
The desk SHALL refuse a margin adjustment it can already tell will fail, and
SHALL state why. It SHALL NOT refuse on grounds the exchange owns.

#### Scenario: The position is cross-margined
- **WHEN** the operator opens the margin panel for a cross position
- **THEN** the panel states that margin is shared by the whole account and offers no adjustment, rather than sending a command the exchange will reject

#### Scenario: More is added than the account has
- **WHEN** the amount to add exceeds the available USDT balance
- **THEN** the panel refuses it locally and names the available amount

#### Scenario: More is removed than the position holds
- **WHEN** the amount to remove exceeds the margin committed to that position
- **THEN** the panel refuses it locally and names the committed amount

#### Scenario: The exchange refuses the transfer
- **WHEN** Binance rejects the adjustment, including when the removable amount is smaller than the position's margin
- **THEN** the refusal is reported with Binance's own code and text and no retry is attempted

#### Scenario: More is removed than stands above the liquidation floor
- **WHEN** the amount to remove exceeds the margin standing above the position's maintenance requirement
- **THEN** the panel refuses it as crossing the liquidation floor and names the largest amount that does not

### Requirement: The margin panel shows what stands between the position and liquidation
The margin panel SHALL show the maintenance requirement the exchange reports
for the position, the margin standing above it, and where a requested
adjustment would leave that margin — as a proportion, so the size of the
remaining buffer is legible without reading the figures. Every part of the
reading SHALL come from the account read. Unrealized profit SHALL NOT be
counted into the buffer, because it is not in the wallet and cannot be
withdrawn; an unrealized loss SHALL be, because it has already been taken out
of it.

#### Scenario: The buffer above liquidation is shown
- **WHEN** the panel opens for an isolated position whose read carries a maintenance requirement
- **THEN** it shows the maintenance requirement, the margin above it, and their proportions of the position's margin balance

#### Scenario: A losing position shows a smaller buffer
- **WHEN** the position carries an unrealized loss
- **THEN** the buffer shown is the committed margin less that loss and less the maintenance requirement

#### Scenario: The requested adjustment is shown against the floor
- **WHEN** the operator enters an amount
- **THEN** the reading shows where that amount would leave the buffer, moved by exactly the amount transferred, because the notional and therefore the maintenance requirement do not change

#### Scenario: The exchange keeps the last word on the amount
- **WHEN** the panel shows the margin standing above the maintenance requirement
- **THEN** it presents it as the point at which liquidation is certain and not as the amount Binance will release, and a smaller exchange limit is reported as the exchange's refusal

#### Scenario: The read carries no maintenance requirement
- **WHEN** the account read reports no maintenance margin for the position
- **THEN** no floor is drawn and no buffer is claimed, and the panel refuses only above the committed margin

#### Scenario: The effect of a small adjustment is still readable
- **WHEN** the amount is small beside the margin already behind the position, so that it moves the drawing by a sliver
- **THEN** the panel also states the liquidation risk — the maintenance requirement as a share of the margin balance, liquidation at 100% — before and after the adjustment

### Requirement: The margin amount can be dragged
The margin amount SHALL be adjustable by a slider as well as by typing, using
the same control as the order ticket's size, and the drawing of the liquidation
floor SHALL follow it as it moves. The slider's range SHALL be measured against
the position rather than against the account balance, so that a realistic
adjustment occupies a usable part of its travel.

#### Scenario: The slider is dragged
- **WHEN** the operator drags the margin slider
- **THEN** the amount, the drawing and the resulting figures all follow it

#### Scenario: The slider's range
- **WHEN** an increase is being made
- **THEN** the slider runs to the smaller of the available balance and the margin the position already holds, and an amount typed past that stretches the range rather than contradicting it

#### Scenario: The slider's range for a decrease
- **WHEN** a decrease is being made
- **THEN** the slider runs to the margin standing above the liquidation floor, so its far end is the last amount that does not cross it

### Requirement: The margin mode is stated in words wherever margin is shown
Every surface that shows a position's margin SHALL name the margin mode in
words. Colour, line style or the presence of a control SHALL NOT be the only
thing distinguishing an isolated position from a cross one, because only one of
the two can be adjusted at all.

#### Scenario: The position row names the mode
- **WHEN** a position is listed in the dock
- **THEN** its margin figure carries the mode as a legible label, not only as a style

#### Scenario: The panel names the mode
- **WHEN** the margin panel opens for a position
- **THEN** it names the mode and says what that mode means for the funds behind the position

#### Scenario: The mode is unknown
- **WHEN** the read carries nothing to establish the mode from
- **THEN** no mode is claimed on any surface

### Requirement: A margin adjustment travels the validated command path
A margin adjustment SHALL be built by the typed command builders, validated in
the main process, and accepted only while the futures market is the active one.
The main process SHALL NOT act on a margin command whose symbol, position side,
direction or amount it has not validated.

#### Scenario: A malformed adjustment arrives
- **WHEN** a margin command carries no symbol, an unknown position side, an unknown direction, or an amount that is not a positive number
- **THEN** it is rejected with the offending field named and nothing is sent to the exchange

#### Scenario: A margin command arrives for an inactive market
- **WHEN** a margin command arrives while futures is not the active market
- **THEN** it is refused as an inactive-market command, exactly as an order would be

#### Scenario: A spot margin command arrives
- **WHEN** a margin command declares the spot market
- **THEN** it is rejected as not enabled for that market

### Requirement: Pausing trading stops margin leaving a position
While futures trading is paused the desk SHALL refuse a decrease of position
margin and SHALL allow an increase, because pausing exists to stop risk being
taken and removing margin takes risk.

#### Scenario: Removal while paused
- **WHEN** the operator submits a decrease while futures trading is paused
- **THEN** it is refused with the pause named as the reason

#### Scenario: Addition while paused
- **WHEN** the operator submits an increase while futures trading is paused
- **THEN** it is sent, as a cancellation would be

### Requirement: A margin adjustment with an unknown outcome is not presented as a failure
When the transport or the exchange leaves a margin adjustment unanswered, the
desk SHALL state the outcome as unknown and re-read the account rather than
report a failure or resend the transfer, because a repeated transfer moves the
amount twice.

#### Scenario: The adjustment is unanswered
- **WHEN** a margin adjustment fails in a way that does not establish whether the exchange applied it
- **THEN** the outcome is reported as unknown, the account is re-read, and the command is not sent again

