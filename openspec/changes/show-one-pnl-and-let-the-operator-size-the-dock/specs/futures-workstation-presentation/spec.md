# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: The portfolio dock height is the operator's

The portfolio dock SHALL expose a drag handle on its top edge that sets one
height for both dock panels, adjustable by pointer and by keyboard, reset by
double-click, and persisted across restarts. The stylesheet's default height
applies only while the operator has not chosen one.

#### Scenario: Stretching the dock to review more orders

- **WHEN** the operator drags the dock's top-edge handle upward
- **THEN** both dock panels grow to the dragged height, their tables show more rows, and the height survives a desk restart

#### Scenario: Handing the height back

- **WHEN** the operator double-clicks the handle
- **THEN** the dock returns to the stylesheet's default height and the persisted choice is cleared

### Requirement: A closed round states one money quantity in its row

A closed-position row SHALL carry exactly one money column, named PnL, showing
the exchange's own realized PnL rounded to cents and set in bold; rounding
SHALL be performed
on the exchange's decimal string so no figure is altered by float precision,
and a sub-cent amount that would render as zero SHALL keep its exact text. The
exact figure, and what reached the wallet — the exact Wallet Net, or the
qualified visible net with every reason — SHALL be named on the row's element.
No second money column, measure label, or qualification badge appears in the
row, and no scope banner stands above the table; an unresolved scope still
forbids the claim that no closed positions exist.

#### Scenario: A rounded row keeps its exact figure

- **WHEN** a round realized `86.70158975` USDT
- **THEN** the row shows `+86.70 USDT` and the element names `Exact +86.70158975 USDT` beside the wallet result

#### Scenario: The wallet result rides the element

- **WHEN** the ledger proves an exact Wallet Net for a round
- **THEN** the row's PnL element names that Wallet Net to its last digit, and the row itself shows only the exchange PnL

#### Scenario: An unresolved scope without a banner

- **WHEN** a contract's opening boundary has not been reached and the table holds resolved rows
- **THEN** no banner narrates the unresolved scope, and an empty review still states that it cannot prove no closed positions exist

### Requirement: An open position's PnL cell shows amounts only

The open-position PnL (settled money) cell SHALL render its amounts and
nothing else. Coverage qualifications stay on the element; resource failures
surface through the dock's own alert line, never as a badge in the row.

#### Scenario: A partial settled reading

- **WHEN** an open position's settled money does not cover the whole life of the position
- **THEN** the cell shows the amounts with the partial marking on the figure itself, the element names the coverage, and no badge word appears in the row

### Requirement: Wallet-adjustment trouble is announced in the popup channel

A failed or stale wallet-adjustment (settled-income) reading SHALL NOT place a
status banner inside the Closed Positions panel. The failure SHALL be
announced once per failure episode through the desk's popup notification
channel, naming the confirmed reading the rows keep and the re-read control as
the way back; the rows themselves keep showing the confirmed reading with
their qualifications on the row elements. Loading, ready, and never-read
states are announced nowhere. While the settled reading reports failure or has
never been read, the history re-read control SHALL also retry it.

#### Scenario: A refresh fails behind held rows

- **WHEN** a wallet-adjustment refresh fails while the operator reads Closed Positions
- **THEN** one popup announces the failure and the confirmed reading's time, no inline banner appears, the rows keep their qualified confirmed values, and the same failure on later renders is not announced again

#### Scenario: The re-read control is the way back

- **WHEN** the operator presses the history re-read control while the settled reading reports failure
- **THEN** the press issues the history read and retries the wallet-adjustment reading in the same gesture

### Requirement: The history header holds one read control

The history header SHALL offer a single compact re-read control. While the
held reading says contract discovery did not finish, that control SHALL run
the full discovery read; once discovery is complete it SHALL read only what
may have changed. No separate full-read control is shown.

#### Scenario: Healing a narrowed review

- **WHEN** the held reading's discovery is incomplete and the operator presses re-read
- **THEN** the desk runs the full discovery read across the account rather than an incremental read of the contracts already covered

