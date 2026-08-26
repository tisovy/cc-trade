# futures-order-visibility (delta)

## REMOVED Requirements

### Requirement: An open position's unrealized PnL is mark-authoritative
**Reason**: The requirement forbids the last traded price from reaching any primary reading. The exchange publishes its mark once a second and the contract prints up to 25 times a second in between, so the rule pins every position row to a figure up to a second and a half old — which the operator, who scalps inside that second, reported as too slow twice in two days. What the rule was written to prevent was a *synthesized* price: uPnL computed at the last mark plus tape movement, a number the exchange never quoted. That danger is real and is kept out by the replacement, which uses the exchange's own printed price and never extrapolates one.
**Migration**: Replaced by "An open position is read at the newer of its two exchange prices", which keeps the mark as the sole input to notional, margin, liquidation and every risk decision, carries the mark's own unrealized PnL on every row under its own name, and hands the reading back to the mark whenever the contract has not printed recently enough to be the newer statement.

### Requirement: A position row that disagrees with the chart says why
**Reason**: It states the same overturned rule a third time, and states it as a prohibition — "the desk SHALL NOT resolve the disagreement by valuing the row on the tape" — which is now exactly what the desk does. Its scenario has the row reporting the loss on the mark while the contract prints the other side of the entry; the desk reports the printed side and names the mark's loss beside it.
**Migration**: Replaced by "A position row that disagrees with the account says why", which keeps everything of it that survives — one shared reading behind the dock and the ticket, the same words on both, and the explanation on the row rather than as a mark overlay on the chart — and only exchanges which of the two figures is the row's and which is the one stated beside it.

## ADDED Requirements

### Requirement: A position row that disagrees with the account says why

A position row is read at the price its contract last printed; the exchange
holds it at its mark. On a fast move the two sit on opposite sides of the
position's entry, so the row shows a profit while the account still records a
loss — or the reverse. Both figures are correct, and the desk SHALL NOT resolve
the disagreement by hiding either one.

Where the two place a position on opposite sides of its entry, the row SHALL
state that this is what has happened: what the exchange's own mark makes the
position worth, and that the mark is what settles and liquidates. Where they
agree, the row SHALL say nothing about it, because there is nothing to explain.

An explanation SHALL name both readings before it compares them. A row that has
not stated which prices it is speaking of SHALL say nothing rather than refer to
them.

Every surface that states a position's unrealized PnL SHALL say it the same way,
from one shared reading, so that the dock and the trading ticket cannot give the
operator two different accounts of the same disagreement.

This SHALL NOT be satisfied by drawing the mark on the chart. "The chart does not
draw a MARK overlay" holds, and the explanation belongs on the row whose number
is being questioned.

#### Scenario: The print has crossed the entry and the mark has not

- **WHEN** a short entered at `61000` is read at a print of `60800` while its mark is `61200`
- **THEN** the row states the profit implied by the print, states what the position is worth on the mark of `61200`, and states that the two are on opposite sides of the entry and that the mark is what settles

#### Scenario: The print and the mark agree

- **WHEN** the printed price and the mark are on the same side of the position's entry
- **THEN** the row says nothing about the disagreement

#### Scenario: The row has named no prices

- **WHEN** a position carries no live valuation, so the row has stated neither price
- **THEN** it says nothing about a disagreement rather than referring to two readings it has not named

#### Scenario: The dock and the ticket state the same position

- **WHEN** both the portfolio dock and the trading ticket show the same position while the print and the mark disagree
- **THEN** both state the disagreement in the same words, from the same reading

### Requirement: An open position is read at the newer of its two exchange prices

A contract has two prices the exchange publishes: the mark, once a second, and
the price the contract last traded at. Both SHALL be prices the exchange itself
stated. No primary reading SHALL be computed from a price extrapolated,
interpolated or otherwise synthesized from either.

Every primary surface that states Futures unrealized PnL, return on margin, or
an aggregate of those readings SHALL use whichever of the two the exchange
stated more recently, by exchange event time. The last traded price SHALL be
preferred only while its own event time is no further behind the mark's than a
bounded window; past that window the mark SHALL be used, because a price nobody
has traded at recently is not the fresher statement. That window SHALL be set
from a measurement of how long the contracts the desk trades actually go between
trades and how long a mark can be late, SHALL exceed the worst measured mark
interval so a late mark cannot alone take the reading, and SHALL NOT exceed what
the mark's own age would have been.

A reading SHALL state which of the two prices it is on and the exchange time of
that price, and SHALL NOT report the other price's time as its own.

Position notional, committed margin, margin balance, removable margin, the
liquidation buffer and every other figure describing what the exchange requires
of the position SHALL be computed from the mark alone, whatever price the
reading is on.

The mark's own unrealized PnL SHALL be carried alongside every live reading not
on the mark, under a name of its own, and SHALL be reachable on every surface
that states the reading — it is the figure the account agrees with, the one
funding is charged on and the one liquidation is decided by. When the two fall
on opposite sides of the position's entry, the surface SHALL say so.

A last traded price SHALL NOT be admitted for a contract the desk holds no
current mark for. When no current price is available at all, a confirmed
account-snapshot unrealized PnL MAY remain as a visibly qualified fallback;
otherwise the reading SHALL be unknown rather than zero.

#### Scenario: A trade prints between marks

- **WHEN** the contract trades after the latest mark and no new mark has arrived
- **THEN** unrealized PnL, return on margin and the aggregate are recomputed at the printed price, while position notional, margin and the liquidation buffer stay on the mark

#### Scenario: A mark arrives while the contract is still trading

- **WHEN** a new mark arrives and the contract's last print is still within the window
- **THEN** the reading stays on the printed price, and the mark's own carried figure, the notional and the margin are recomputed from the new mark

#### Scenario: A contract stops trading

- **WHEN** the exchange's mark event time is further past the last print than the window allows
- **THEN** the reading moves to the mark, states the mark's time as its own, and no longer carries a separate mark figure to disagree with

#### Scenario: A price the exchange did not time

- **WHEN** a last traded price arrives without an exchange trade time, or a mark arrives without an exchange event time
- **THEN** the untimed price cannot be shown to be the newer of the two and the mark is used

#### Scenario: The reading and the mark straddle entry

- **WHEN** a short entered at `3.3450` last printed at `3.30` while its mark is `3.36`
- **THEN** the row reports the profit implied by the print, states the mark's loss beside it under its own name, and says that the two are on opposite sides of the entry and that the mark is what settles

#### Scenario: A delayed or replayed price arrives after an accepted one

- **WHEN** an older, untimed, duplicate or same-time conflicting mark or trade frame arrives after a newer timed frame for the same contract
- **THEN** the accepted price of that kind, other newer symbol readings, liveness proof, and the funding-settlement observation baseline do not change

#### Scenario: Neither price nor snapshot can value the position

- **WHEN** an open position lacks both a usable current price and a confirmed snapshot uPnL
- **THEN** its primary valuation, any aggregate that requires it, and margin/removal calculations that depend on its uPnL are reported as incomplete rather than zero

### Requirement: The price feed carries both prices for every open position

The shared position price feed SHALL subscribe, on its one combined public
stream, to both the mark and the aggregate trades of every contract carrying an
open position — not only of the contract currently on screen. No additional
socket, credentialed subscription or request weight SHALL be spent on this.

A last traded price SHALL be published only alongside a live mark for the same
contract. When the feed withdraws a contract's mark — a close, a stall, a
rebuild, an untracked symbol — it SHALL withdraw that contract's last traded
price with it, so a price cannot outlive the liveness proof that vouches for it.

Trade frames SHALL NOT count as liveness for the mark lane. The stall watchdog
measures forward exchange-time progress of the once-a-second contract, and a
contract can go seconds between trades with nothing wrong.

#### Scenario: A contract trades between two of its marks

- **WHEN** an aggregate trade arrives for a tracked contract that the feed already holds a mark for
- **THEN** it is published in the next coalesced frame beside that mark, and contracts that did not trade carry their mark alone

#### Scenario: A contract trades before its first mark

- **WHEN** an aggregate trade arrives for a tracked contract the feed holds no mark for
- **THEN** nothing is published for that contract, and its first mark carries the held print rather than waiting for the next trade

#### Scenario: The mark lane goes silent while trades keep arriving

- **WHEN** a tracked contract's marks stop making forward exchange-time progress through the liveness window while its trades continue
- **THEN** the watchdog still reports the stall, the whole live price set is withdrawn, and the last print is not left standing as if it were current
