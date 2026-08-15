## ADDED Requirements

### Requirement: A margin panel states the liquidation price it would move to
A panel that moves margin on a position SHALL state that position's liquidation
price, and, while an amount is entered, the price the transfer would move it to:
away from the entry when margin is added and toward it when margin is removed, by
the amount transferred spread over the position's size. The projected price SHALL
be presented as a projection, at the precision the contract quotes, and SHALL be
omitted when the exchange reports no liquidation price for the position. The panel
SHALL NOT present a margin amount as though it were a price.

#### Scenario: Margin is added to a long position
- **WHEN** an amount to add is entered on a long position
- **THEN** the panel shows the current liquidation price and the lower price the transfer would move it to

#### Scenario: Margin is removed
- **WHEN** an amount to remove is entered
- **THEN** the projected liquidation price is closer to the position's entry than the current one

#### Scenario: The position is short
- **WHEN** margin is added to a short position
- **THEN** the projected liquidation price is above the current one, because a short is liquidated above itself

#### Scenario: The exchange reports no liquidation price
- **WHEN** the account read carries no liquidation price for the position
- **THEN** no price is projected and the margin standing above the liquidation floor is stated instead

#### Scenario: The maintenance requirement is displayed
- **WHEN** the maintenance requirement is shown
- **THEN** it is shown as an amount of margin, never as a price and never labelled as a price level

### Requirement: An amount control names the bound it spans
A control that spans a bound SHALL name the bound it is showing, and SHALL span
the bound that actually applies to the action it is used for. Adding margin to a
position SHALL be bounded by the balance available in the wallet, and removing
margin by the margin standing above the liquidation floor; the two SHALL NOT share
one ceiling. An amount typed past the bound SHALL stretch the control rather than
contradict the value shown, and SHALL NOT be treated as permission — the refusal
that applies still applies.

#### Scenario: Margin is added from a large wallet
- **WHEN** the operator selects the add direction on a position whose committed margin is a small part of the wallet
- **THEN** the control spans the available balance and its readout names that figure as what is available

#### Scenario: Margin is removed
- **WHEN** the operator selects the remove direction
- **THEN** the control spans the margin above the liquidation floor and its readout names that figure as what is removable

#### Scenario: An amount is typed past the bound
- **WHEN** the operator types an amount larger than the bound
- **THEN** the control stretches to the typed amount, the amount is refused with the bound stated, and nothing is submitted
