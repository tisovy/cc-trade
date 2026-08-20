## MODIFIED Requirements

### Requirement: Executions are reported as the positions they formed
The trade history SHALL report closed round trips rather than fills: a position
opens when exposure is taken and closes when it returns to flat, and each is
reported with its contract, side, the size it closed, the average price it entered
and left at, and the result of the whole round. Exposure SHALL be folded per
contract.

A round's reported result SHALL be what the round actually put into or took out
of the wallet: the exchange's realized PnL, less the commission charged on its
fills, plus the funding paid or received while it was held, plus any insurance
clearance it incurred. The exchange's realized PnL alone SHALL NOT be the
reported result. Binance reports per-fill realized PnL before its own commission
and does not report funding on a fill at all, so a round held across a funding
boundary settles for a different amount than its realized PnL states, and a
review that reports the latter disagrees with the exchange's own record of the
same position.

The exchange's pre-fee realized PnL SHALL be stated as a reading of its own,
beside the result and not inside it, with the components that were applied to it
available on the element. It is the one figure on the row that can be checked
against Binance without knowing anything about how this desk folds fills, and the
operator checks the desk against Binance with it.

The two SHALL NOT share a column heading. They are two different quantities —
one is what the exchange realized, the other is what the round left in the wallet
— and a column named for the first while holding the second reports a
disagreement with the Binance app that is not a disagreement about any number:
the operator compares the column against the app's column of the same name and
finds two figures that were never the same measurement. Each heading SHALL name
the quantity under it.

Commission SHALL be summed per asset. Where a fill's commission was charged in an
asset other than the contract's settlement asset, it SHALL be stated in the asset
it was charged in and SHALL NOT be added into the settlement-asset total: the
desk holds no rate at which to convert it, and a converted guess would be printed
beside money.

Funding SHALL be attributed to a round from the exchange's income record, on the
round's own contract, over the span between its open and its close, both bounds
inclusive — a charge has to land somewhere, and the exchange's own bounds are
inclusive. It SHALL NOT be attributed to a position leg: an income row states no
leg and names no trade for funding to reach one through, so there is nothing in
the record to divide a charge by, and a division the exchange never made is a
number the desk invented.

Exposure is folded per contract, so a contract's rounds are consecutive and a
charge falls inside exactly one of them — except at the edge two rounds share,
where one closes in the same instant the next opens. A charge stamped there is
inside both and belongs to neither more than the other: it SHALL be stated on
each as the contract's rather than divided between them or assigned to one.

The components SHALL be combined in the sign each record states them in. The
exchange's realized PnL and a fill's commission come from the trade record, where
commission is an unsigned magnitude and is therefore subtracted; funding and
insurance clearance come from the income record, where an outflow is already
negative and is therefore added. A fold that subtracted an already-negative
income row would add the charge back to the operator's result.

Where the income the desk has read does not reach back to a round's open, the
round SHALL state that its result is missing funding the read did not cover,
rather than presenting an incomplete total as a complete one.

A round that began by reducing a position opened before this window of fills
SHALL never be stated as covered, however far back the income read reaches. Its
open is the edge the window happened to start at rather than the moment the
position was entered, so measuring the read's reach against it answers a question
about the window and reports the answer as though it were about the position. The
charges such a round took before that edge are real and are not reachable from
the data in hand.

The size SHALL be stated in USDT, valued at the price the round was entered at,
because that is what every other size on this desk is stated in and a contract
count cannot be compared across contracts. The count of contracts SHALL remain
available on the element.

A position that has not returned to flat SHALL NOT appear in this history: it has
no exit and no result, and the live positions table is where it is reported. A
position whose opening fills are older than the window SHALL still state an entry
price, recovered from the realized PnL the exchange reports, and SHALL state on the
element that the entry was recovered rather than read.

#### Scenario: One close arrives as several fills
- **WHEN** a position is closed by an order that fills in several parts
- **THEN** the tab shows one row for the position, carrying the summed PnL and fees of every fill in it

#### Scenario: The position is still open
- **WHEN** the fills in the window have not returned the position to flat
- **THEN** no row is shown for it in the closed-position history

#### Scenario: The position was opened before the window
- **WHEN** the oldest fills in the window reduce a position whose opening fills are not in it
- **THEN** the round is reported on the leg that was closed, with the entry price recovered from its realized PnL and stated as recovered

#### Scenario: A fill flips the position
- **WHEN** a fill reduces more than the position holds and opens the opposite one
- **THEN** the closed leg is reported with the realized PnL made on the way out, and the leftover size opens a position that is not reported here until it closes

#### Scenario: Two contracts were traded in the same window
- **WHEN** the window holds fills on more than one contract
- **THEN** each contract's exposure is folded on its own, and a fill on one never closes or reduces a round on another

#### Scenario: A closed round is sized
- **WHEN** the closed-position history lists a round
- **THEN** its size is what the position was worth in USDT at its entry, and the contract count is on the element

#### Scenario: A round is held across a funding boundary
- **WHEN** a round realized `120` USDT before fees, was charged `4` USDT in commission and paid `7` USDT in funding while it was held
- **THEN** the row reports `109` USDT as the round's result, and states `120` realized, `4` in commission and `7` in funding on the element

#### Scenario: Commission was charged in BNB
- **WHEN** a round's fills were charged commission in BNB while the contract settles in USDT
- **THEN** the BNB commission is stated in BNB, is not subtracted from the USDT result, and the row does not present a single total mixing the two

#### Scenario: The income read does not reach the round's open
- **WHEN** a round opened before the earliest income row the desk has read
- **THEN** the row states that its result is missing funding the read did not cover, rather than reporting the total as complete

#### Scenario: A charge lands on the edge two rounds share
- **WHEN** a funding charge is stamped at the instant one round closed and the next opened on the same contract
- **THEN** both rounds state the charge as the contract's, and neither presents a divided share of it

#### Scenario: A charge lands inside one round
- **WHEN** a funding charge is stamped between a round's open and its close, with no other round of that contract touching that instant
- **THEN** that round states the charge as its own

#### Scenario: A charge lands at a round's own open or close
- **WHEN** a funding charge is stamped at exactly the moment a round opened, or at exactly the moment it closed
- **THEN** the charge is counted in that round rather than falling between two rounds uncounted

#### Scenario: An income row is already signed
- **WHEN** a round's funding arrives from the income record as `-7` and its commission from the trade record as `4`
- **THEN** the result is realized PnL `- 4 + (-7)`, and the funding is not subtracted a second time

#### Scenario: The round began before the window of fills
- **WHEN** a round's first fill reduces a position opened before the window, and the income read reaches back further than that fill
- **THEN** the round still states that its result is missing funding, because the read reaching past the window's edge says nothing about reaching past the position's open

#### Scenario: A round was never charged funding
- **WHEN** a round opened and closed between two funding boundaries and the income record has no funding row for it
- **THEN** its result is realized PnL less commission, and no funding component is stated

#### Scenario: A round's result differs from what the exchange realized
- **WHEN** a round realized `120` USDT, paid `4` in commission and `7` in funding
- **THEN** the row states `120` under a heading naming the exchange's realized PnL and `109` under a heading naming the result, rather than `109` alone under the exchange's name

#### Scenario: The result is qualified and the exchange's figure is not
- **WHEN** a round's result is missing funding the income read did not reach
- **THEN** the result is marked as qualified and the exchange's own realized PnL is not, because no funding was ever part of it
