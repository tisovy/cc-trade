## ADDED Requirements

### Requirement: A position row that disagrees with the chart says why
The chart is drawn from the price the contract traded at; a position row is
valued on the exchange's mark. On a fast move the two sit on opposite sides of a
position's entry, so the operator sees price past their own entry line while the
row states a loss — or the reverse. Both figures are correct, and the desk SHALL
NOT resolve the disagreement by valuing the row on the tape, because the mark is
what the exchange settles and liquidates on.

Where the tape and the mark place a position on opposite sides of its entry, the
row SHALL state that this is what has happened: the price the contract last
traded at, what the position would be worth there, and that the mark has not
crossed the entry and is what settles. Where they agree, the row SHALL say
nothing about the tape, because there is nothing to explain.

Every surface that states a position's unrealized PnL SHALL say it the same way,
from one shared reading, so that the dock and the trading ticket cannot give the
operator two different accounts of the same disagreement.

This SHALL NOT be satisfied by drawing the mark on the chart. "The chart does not
draw a MARK overlay" holds, and the explanation belongs on the row whose number
is being questioned.

#### Scenario: The tape has crossed the entry and the mark has not
- **WHEN** a short entered at `61000` is valued at a mark of `61200` while the contract last traded at `60800`
- **THEN** the row states the loss on the mark, and states that the contract last traded at `60800` — the other side of the entry — what the position would be worth there, and that the mark is what settles

#### Scenario: The tape and the mark agree
- **WHEN** the last traded price and the mark are on the same side of the position's entry
- **THEN** the row says nothing about the tape

#### Scenario: The tape sits exactly on the entry
- **WHEN** the contract last traded at exactly the position's entry price
- **THEN** the row says nothing about the tape, because a reading of zero has no side to disagree from

#### Scenario: The dock and the ticket state the same position
- **WHEN** both the portfolio dock and the trading ticket show the same position while the tape and the mark disagree
- **THEN** both state the disagreement in the same words, from the same reading

## MODIFIED Requirements

### Requirement: An open position's value moves with the market between marks
Between two mark-price updates, an open position's unrealized PnL and its
percentage SHALL be re-priced at a bounded repaint rate against the last
confirmed mark carried forward by the tape: the valuation price SHALL be that
mark plus the change in the contract's traded price since the mark was taken.

The last traded price SHALL NOT be substituted for the mark. The two are
different series — the mark is an index average carried on a smoothing basis,
the traded price is what printed — and on a fast move they sit on opposite sides
of a position's entry. Substituting one for the other therefore reverses the sign
of the unrealized PnL according to which of two streams delivered last, without
the market having moved at all.

The estimate SHALL be continuous with the mark it extends: while no trade prints,
the estimated valuation SHALL equal the confirmed mark exactly, so that the
arrival of a mark alone SHALL NOT change the reading. Where no traded price is
known from the moment the mark was taken, there is nothing to carry the mark
forward by, and the position SHALL be valued at the mark itself.

#### Scenario: The market moves between two marks
- **WHEN** trades print for a contract holding an open position and no new mark has arrived
- **THEN** the position's value and PnL follow those prints rather than standing still

#### Scenario: A mark arrives
- **WHEN** a mark price arrives for that contract and no trade has printed since the previous mark was taken
- **THEN** the position's PnL is unchanged by the arrival, because the estimate it replaces was that same mark carried forward by nothing

#### Scenario: The tape and the mark straddle the entry
- **WHEN** a short of `-2873` contracts entered at `3.3450` is valued while the exchange's mark is `3.36` and the contract last traded at `3.30`
- **THEN** the position reads as a profit from the traded price being below its entry, and it reads as that same profit whether the newest reading in hand is the mark or the trade

#### Scenario: No trade has printed since the mark was taken
- **WHEN** a mark arrives for a contract on which no trade has printed since the previous mark
- **THEN** the position is valued at that mark, and no estimate is presented
