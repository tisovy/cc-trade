## MODIFIED Requirements

### Requirement: Order and trade history is available in the app
The system SHALL provide, on operator request, the recent order history and the
recent closed-position history of the **account**, not of the selected contract
alone, including each position's realized PnL and fee, and SHALL report a failed
history request without disturbing live trading state.

Because every USDⓈ-M history endpoint requires a symbol, the system SHALL first
determine which contracts the account traded within a bounded recent window, SHALL
read the contract on screen and the contracts holding positions or working orders
before the rest, and SHALL bound the number of contracts it reads, logging whatever
that bound drops. Each row SHALL name its own contract and SHALL be priced at that
contract's tick.

The traded-contract read is answered oldest-first from the time it is given, so
the system SHALL walk it forward, within a bounded number of pages, until a page
comes back short, and SHALL order the contracts it discovered most recent first.
Otherwise a window busier than one page yields the contracts the account has since
moved off and never reaches the ones it traded today.

Fills SHALL be read deeply enough to be folded into the positions they formed
rather than merely deeply enough to fill a screen: they are not shown as a list,
and a fold that begins inside a position cannot state what happened before it.

The bound SHALL be visible, not merely logged. The payload SHALL state how many
contracts the account traded in the window against how many were read, and the
review SHALL state, beside the rows, how much of the session it covers — the
contracts read of those traded, and how far back the fills it read reach. A
bounded review that does not say so is read as a complete one, and an operator
looking for losses they know they took cannot tell an empty list from a short one.

#### Scenario: Operator opens history
- **WHEN** the operator opens the history view
- **THEN** the recent orders of every contract read are listed with their contract, status, side, price, size, filled size and time, and the closed positions are listed with their contract, entry, exit, size and signed realized PnL

#### Scenario: One contract's read is refused
- **WHEN** the exchange refuses the history read of one contract in the fan-out
- **THEN** the rows of the other contracts are still shown, the payload states which contracts it covers, and no error is reported

#### Scenario: History request fails
- **WHEN** no contract in the fan-out could be read
- **THEN** the failure is reported in the history view with its bounded code, and positions, working orders and balances remain unchanged

#### Scenario: Operator switches contract
- **WHEN** the selected contract changes
- **THEN** the loaded account history remains valid and shown, with the rows of the newly selected contract marked as its own

#### Scenario: The traded-contract read overruns one page
- **WHEN** the account traded more in the window than one page of the traded-contract read can carry
- **THEN** the read continues from where the page ended, and the contracts traded most recently are the ones the fan-out covers

#### Scenario: The account traded more contracts than the fan-out reads
- **WHEN** the account traded more contracts in the window than the fan-out is bounded to read
- **THEN** the review states how many of them were read, alongside how far back the fills it read reach

### Requirement: Executions are reported as the positions they formed
The trade history SHALL report closed round trips rather than fills: a position
opens when exposure is taken and closes when it returns to flat, and each is
reported with its contract, side, the size it closed, the average price it entered
and left at, and the realized PnL of the whole round. Realized PnL SHALL be
reported as the exchange reports it, with the fees and the net stated on the
element rather than as a column of their own. Exposure SHALL be folded per
contract.

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
