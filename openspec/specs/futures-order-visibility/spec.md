# futures-order-visibility

## Purpose

Defines account-wide synchronization of regular and algorithmic Futures orders and their consistent presentation across the chart and sidebar.
## Requirements
### Requirement: The account order model includes regular and algorithmic orders
The system SHALL synchronize both regular open orders and currently open algorithmic orders from the authenticated USDⓈ-M account. Each normalized order SHALL retain its source kind, exchange identity, symbol, side, type, status, quantity, prices relevant to that type, reduce-only or close-position intent when supplied, and exchange update time.

#### Scenario: Account has regular and algorithmic orders for TUTUSDT
- **WHEN** Binance returns one regular order and one algorithmic order for `TUTUSDT`
- **THEN** both orders are present in the normalized account order state with distinct source kinds and identities

#### Scenario: The same numeric identifier occurs in two namespaces
- **WHEN** a regular order and an algorithmic order share the same numeric identifier
- **THEN** they remain distinct because order identity includes the source kind

#### Scenario: One order endpoint fails
- **WHEN** either the regular-order or algorithmic-order request fails while the other succeeds
- **THEN** the successful source is updated, the failed source retains its last confirmed snapshot if any, and the UI reports partial synchronization rather than claiming the combined order list is complete

### Requirement: Account-wide snapshots are not replaced by symbol-scoped data
The system SHALL keep the authoritative open-order snapshot account-wide. Selecting a chart symbol, refreshing one symbol, placing an order, receiving an order update, or canceling an order SHALL reconcile the affected records without deleting confirmed open orders for unrelated symbols.

#### Scenario: Selected symbol changes
- **WHEN** the operator moves from one futures symbol to another
- **THEN** the account-wide order snapshot remains intact and the chart/sidebar derive the appropriate selected-symbol view from it

#### Scenario: Post-placement refresh targets one symbol
- **WHEN** a successful placement triggers reconciliation for the placed symbol
- **THEN** open orders previously confirmed for other symbols remain in account state

#### Scenario: Terminal execution update arrives
- **WHEN** an order update reports a terminal status for one order
- **THEN** only the matching source-qualified order is removed from the open-order view

### Requirement: Selected-symbol orders are visible in both trading views
The sidebar and chart SHALL display every supported open regular and algorithmic order for the selected symbol from the latest usable account state. Both views SHALL use the same normalized source and SHALL expose partial, stale, or failed synchronization instead of silently rendering an apparently empty result. Chart order handles SHALL identify an order by its notional in USDT and offer a cancel control, leaving the exact price to the price axis.

#### Scenario: Exchange-created limit order exists
- **WHEN** the account holds a regular LIMIT order created outside this application for the selected symbol
- **THEN** it appears in both the sidebar and on the chart with its side-derived colour and remains cancellable and draggable

#### Scenario: Chart handle identifies an order
- **WHEN** an open order is drawn on the chart
- **THEN** its handle shows the order notional in USDT and a cancel control, its exact price is readable from the price axis, and no duplicate price label is drawn over the axis

#### Scenario: Exchange-created stop or take-profit order exists
- **WHEN** an open algorithmic stop or take-profit order for the selected symbol exists on Binance
- **THEN** the order appears in both the selected-symbol sidebar and on the chart using the relevant trigger and order-price semantics, shown as display-only without a cancel control and identified as managed on Binance

#### Scenario: Order synchronization has never succeeded
- **WHEN** the selected-symbol order view has no confirmed snapshot because synchronization failed
- **THEN** the UI shows an unavailable/error state and does not present an empty list as proof that no orders exist

### Requirement: Chart interactions respect order source semantics
The chart SHALL distinguish regular and algorithmic orders visually and accessibly. An order SHALL be draggable or cancellable only when the corresponding authenticated exchange operation and identity mapping are supported; otherwise it SHALL remain visible with an explicit display-only indication.

#### Scenario: Supported regular limit order is amended
- **WHEN** the operator drags an amendable regular limit order to a valid exchange-filtered price and confirms the action
- **THEN** the system sends the source-appropriate operation and reconciles the exchange response

#### Scenario: Algorithmic order amendment is not supported
- **WHEN** an algorithmic order is displayed but source-aware amendment is unavailable
- **THEN** the chart does not offer drag amendment and identifies the order as display-only

### Requirement: Order reconciliation remains current after startup
After the first snapshot, the system SHALL combine authenticated user-data
updates with periodic and operator-requested REST reconciliation so that missed
stream events or reconnects do not leave the visible order state permanently
incorrect. The working-order set SHALL be maintained from the authenticated
stream: an execution report that opens or changes an order SHALL update it in
place, and one that reports it settled SHALL remove it, without issuing an
account-wide order read. An account-wide order read SHALL be issued only for a
stated reason — the first snapshot, a stream connect or reconnect, an
operator-requested refresh, or the periodic beat. The periodic read SHALL run
while orders are working and SHALL stop while none are, so that a desk holding
nothing spends no weight on it.

#### Scenario: User-data stream reconnects
- **WHEN** the authenticated stream disconnects and reconnects
- **THEN** the system marks stream-derived order state stale until a REST reconciliation succeeds

#### Scenario: Manual refresh completes
- **WHEN** the operator requests an account refresh and both order sources succeed
- **THEN** the visible selected-symbol orders match the new account-wide snapshots and their freshness becomes ready

#### Scenario: An order settles on the stream
- **WHEN** an execution report reports an order filled, cancelled, expired or rejected
- **THEN** it leaves the working-order set at once and no account-wide order read is issued for it

#### Scenario: An order is opened or changed on the stream
- **WHEN** an execution report reports an order new, partially filled or amended
- **THEN** the working-order set carries it with the values the report gave, and no account-wide order read is issued for it

#### Scenario: No message reports a settlement
- **WHEN** orders are working and no execution report or snapshot arrives
- **THEN** the account is re-read without the operator asking, on a beat measured in tens of seconds

#### Scenario: Nothing is working
- **WHEN** the working-orders list is empty
- **THEN** no periodic read is sent at all

### Requirement: Moving an order is a single atomic amendment
The system SHALL reprice or resize a live regular LIMIT futures order with one Binance USDⓈ-M order amendment. The system SHALL NOT implement a move as a cancel followed by a separate placement.

#### Scenario: Operator drags an order line to a new price
- **WHEN** the operator drags a regular LIMIT order line to a new price and releases it
- **THEN** exactly one amendment command is emitted for that order, carrying its symbol, side, exchange identity, unchanged quantity, and the new price, and no cancel command is emitted

#### Scenario: The exchange rejects the amendment
- **WHEN** Binance rejects the amendment
- **THEN** the original order remains open at its previous price, the rejection is reported with the exchange code, and account state is resynchronized so the displayed order line returns to the confirmed price

#### Scenario: Trading is paused
- **WHEN** the operator has paused trading
- **THEN** the move is refused before any exchange call and the refusal reason is shown

### Requirement: Order direction is derived from side, not position side
The system SHALL derive the displayed direction, entry/exit effect, and colour of an order from its side together with its reduce-only flag, using the declared position leg only when the account reports one. BUY SHALL render in the positive colour and SELL in the negative colour on every surface.

#### Scenario: One-way account reports positionSide BOTH
- **WHEN** an open BUY order for a one-way account is displayed on the chart and in the order list
- **THEN** it renders in the positive colour and is labelled as a long entry, never as a short and never with a bare `BOTH`

#### Scenario: Reduce-only order closes the opposite leg
- **WHEN** a reduce-only BUY order is displayed
- **THEN** it is labelled as a short exit while still rendering in the positive colour of its side

### Requirement: Open orders can be repriced and resized without leaving the list
The order list SHALL let the operator change the price and the size of an open regular order in place, submitting the change through the same atomic amendment, and SHALL expose an unambiguous cancel control on every cancellable row.

#### Scenario: Operator edits price and size in the list
- **WHEN** the operator enters a new price or a new notional for an open order and confirms
- **THEN** one amendment carrying both values is emitted for that order

#### Scenario: Operator cancels from the list
- **WHEN** the operator activates the cancel control on a row
- **THEN** a cancel command is emitted for that order and the control is labelled so its purpose is unambiguous

### Requirement: Positions and working orders are continuously visible
The workstation SHALL present open positions and working orders without requiring the operator to open a tab, including per-position signed unrealized PnL, return on margin, and an aggregate unrealized PnL, and SHALL mark position entry and liquidation prices on the chart.

#### Scenario: A position is open
- **WHEN** the account holds an open position
- **THEN** its direction, size, entry, mark, liquidation, margin mode, leverage, signed PnL, and return on margin are visible alongside the chart, and its entry and liquidation prices are drawn on the chart

#### Scenario: Losses and gains are distinguishable
- **WHEN** unrealized PnL is negative
- **THEN** it is rendered with an explicit sign and the negative colour, distinctly from a positive value

### Requirement: Actionable exchange rejections state the operator remedy
When Binance rejects a futures command with a code whose resolution is known, the rejection surfaced to the operator SHALL include the concrete remedy in addition to the exchange message and code.

#### Scenario: The key is refused for trading
- **WHEN** Binance rejects a place, cancel, or amend command with code `-2015`
- **THEN** the reported rejection states that the futures key must have Futures trading enabled and that an IP-restricted key must allow the current address, while account reads may continue to succeed

### Requirement: Confirmed order updates survive an older account snapshot
The system SHALL treat a confirmed execution report as authoritative until the
account snapshot it is reconciled against is at least as recent. An account
snapshot SHALL NOT replace an open order with an older version of that same
order.

An order the exchange has reported settled SHALL NOT be listed as working again,
by any message. This covers both a report that left the exchange before the
settlement — the reply to a placement that filled the instant it was made — and
an account snapshot read from a service that had not yet seen the settlement.
Settlement is remembered by the order's exchange identity rather than compared by
time, because the exchange does not reuse an order id; the memory SHALL be
bounded, since it guards messages in flight rather than recording history. A
settlement report that carries no order id SHALL settle nothing, its identity
being the prefix every unidentified order on that contract would share.

#### Scenario: Snapshot arrives with pre-amendment values
- **WHEN** an amendment is confirmed and the account synchronization that follows returns the order with an earlier update time
- **THEN** the order keeps the confirmed price and size, and no operator refresh is required to see them

#### Scenario: Snapshot is newer than the local report
- **WHEN** the account snapshot reports the order with a later update time than the last locally applied report
- **THEN** the snapshot values replace the local ones

#### Scenario: The placement's reply arrives after the fill
- **WHEN** an order fills the instant it is placed, so the stream reports it filled before the reply to the placement arrives describing it as new
- **THEN** the order is not listed as working, and no reload is required to clear it

#### Scenario: A snapshot still describes a settled order
- **WHEN** an account snapshot lists an order the exchange has already reported settled, alongside an order that is genuinely resting
- **THEN** the settled one is refused and the resting one is listed

### Requirement: A position can be closed at market or with a reduce-only limit
The system SHALL let the operator close an open position either immediately at
market or through a reduce-only limit order at an operator-chosen price, for the
whole position or a smaller size, from the same control. The size SHALL be
choosable by dragging a control that spans the whole position as well as by
typing an exact size, with both floored to the contract's lot step, and the two
SHALL never disagree about the size being closed. The panel SHALL state what the
exit would settle — the size the position is left holding, the value coming off
the table and the profit that size would realize at the price the exit is priced
at — and SHALL NOT spend a summary cell restating the side or the reduce-only
nature that every close from it carries.

#### Scenario: Operator closes at market
- **WHEN** the operator confirms a market close
- **THEN** one reduce-only MARKET order is submitted on the side that reduces the position, for the requested size

#### Scenario: Operator closes with a limit
- **WHEN** the operator enters a close price and confirms a limit close
- **THEN** one reduce-only LIMIT order is submitted on the side that reduces the position, at the entered price, snapped to the contract's tick and step filters

#### Scenario: Requested close size exceeds the position
- **WHEN** the entered size is larger than the open position
- **THEN** the submission is refused with a stated reason and no order is sent, and the size control shows the whole position rather than more than it

#### Scenario: Operator drags the size control
- **WHEN** the operator drags the close size to a share of the position
- **THEN** the size becomes that share of the open quantity floored to the lot step, and the exact size appears in the field beside it

#### Scenario: Operator types a size
- **WHEN** the operator types an exact size
- **THEN** the control moves to the share of the position that size represents, computed as an exact decimal rather than as a float

#### Scenario: Size control is dragged to nothing
- **WHEN** the operator drags the size control to its lowest point
- **THEN** the panel holds no size, asks for one, and submits nothing

#### Scenario: Operator reads what the exit settles
- **WHEN** a close size is set
- **THEN** the panel states the size that would remain open, the value of the size being closed and the profit it would realize, each shown as absent rather than as zero when the account read cannot value it

#### Scenario: A limit price is entered
- **WHEN** the operator sets a limit close price
- **THEN** the value and the profit are computed at that price rather than at the mark, and the side the limit rests on is stated beside the price

### Requirement: Every order surface opens the same editor
The system SHALL open the order editor from a chart order handle, from an order
row in the trading rail, and from a working-order row in the dock, and SHALL
apply price and size changes from it as one amendment.

#### Scenario: Operator activates a dock working-order row
- **WHEN** the operator activates a working-order row in the dock away from its explicit controls
- **THEN** the order editor opens for that order with its current price and USDT amount

#### Scenario: Row carries an exchange-managed order
- **WHEN** the row carries a conditional or strategy order the app does not amend
- **THEN** no editor opens and the row stays display-only

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
contracts were found against how many were read, and the review SHALL state,
beside the rows, how much of the session it covers — the contracts read of those
found, and how far back the fills it read reach. A bounded review that does not
say so is read as a complete one, and an operator looking for losses they know
they took cannot tell an empty list from a short one.

The count of contracts found is itself a read, and it can fail or run out of
pages. Where it did, the payload SHALL say so and the review SHALL state that
more may have been traded, rather than presenting what was found as all there
was. A failed discovery SHALL NOT discard the pages already read, and SHALL NOT
be reported as a history failure: the contracts the desk already knows about are
still read and still shown.

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

#### Scenario: The traded-contract read fails partway through
- **WHEN** one page of the traded-contract read succeeds and the next is refused
- **THEN** the contracts from the page already read are still covered, the history is not reported as failed, and the review states that more may have been traded

### Requirement: A price the order does not have is reported as absent
Where the exchange reports no price for an order — a market order has no limit
price, an order that has not filled has no average price — the desk SHALL show that
as absent rather than as a zero rendered through the contract's tick.

#### Scenario: A filled market order is listed
- **WHEN** order history lists a market order
- **THEN** its price column reads as absent and its average column carries the price it actually got

#### Scenario: A working order has not filled
- **WHEN** order history lists an order with nothing executed
- **THEN** its average column reads as absent and its limit price is shown

### Requirement: A history row is stamped for when it happened
A history row SHALL carry the half of its timestamp that the row is read for: the
time of day for a row from today, the date for a row from any other day. The whole
stamp SHALL remain available on the element. A closed position SHALL be stamped by
when it closed, and the whole span from opening to closing SHALL remain available
on the element.

#### Scenario: The row is from today
- **WHEN** a history row's timestamp falls on the current day
- **THEN** the column shows its time of day, seconds included, and the full stamp is in the title

#### Scenario: The row is older
- **WHEN** a history row is from any earlier day
- **THEN** the column shows its date and the full stamp is in the title

#### Scenario: A closed position is listed
- **WHEN** the closed-position history lists a round trip
- **THEN** the stamp is when it closed and the title carries the whole span it ran for

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

### Requirement: An order is valued at the price it rests at
An order's stated price and value SHALL be taken from the price it is actually
working at. For a stop or take-profit that is the trigger, which the exchange
reports separately and alongside a `price` of zero for the market-triggered
kinds; the normalized order SHALL carry that trigger for regular orders as it
already does for algorithmic ones, and SHALL omit the field where the exchange
reports no trigger rather than carrying a zero that would be read as a price.

An order SHALL NOT be valued at zero because a field it needs is missing. An
order with no usable price or no usable size SHALL be reported as unvaluable, so
that a row which could not be read is distinguishable from an order that commits
nothing.

#### Scenario: A stop rests in the list
- **WHEN** the exchange reports a resting stop with `price` `0` and a trigger of `58000` for `0.5` contracts
- **THEN** the order is shown at `58000` and valued at `29000` USDT, in the list and in any total of the working orders

#### Scenario: A limit order has no trigger
- **WHEN** the exchange reports a plain limit order
- **THEN** the normalized order carries no trigger price at all, and is shown and valued at its limit price

#### Scenario: An order cannot be valued
- **WHEN** an order carries no usable price, or a close-position stop carries no quantity of its own
- **THEN** it is reported as unvaluable and shown as absent, not as an order worth zero, and it is left out of the working-orders total rather than adding zero to it

### Requirement: A working order's size is stated in USDT
The working-orders list SHALL state an order's size as the USDT amount it
commits, under a header that names the unit, using the same derivation as every
other surface that sizes an order — the ticket, the order editor and the chart
label — so one order reads as one number wherever it appears. The exact contract
quantity SHALL remain available on the cell without occupying the column. An
order whose size is carried against a trigger price SHALL be valued at that
trigger price, because a stop-market carries a `price` of `0`.

#### Scenario: A limit order is listed
- **WHEN** a working order rests at `58445.00` for `0.004` contracts
- **THEN** the size cell reads `234` under a `Size (USDT)` header, and its title states `0.004 contracts`

#### Scenario: An algo order is listed
- **WHEN** a stop order carries `price` `0`, a trigger price of `57000.00` and `0.01` contracts
- **THEN** the size cell reads `570` rather than a zero

#### Scenario: The same order is read on two surfaces
- **WHEN** the operator compares a working order's size in the list against the same order on the chart or in the editor
- **THEN** both state the same USDT amount

### Requirement: The working-orders list is read as a table, not as sentences
The list of working orders SHALL state the unit of each column once, at the head
of the list, and no row SHALL repeat it. Every column SHALL occupy a bounded
track and SHALL shorten its own content when it does not fit, so that no column
can be squeezed out of the row by another and the cancel control keeps its
place at every width.

A price SHALL be stated at the precision the contract quotes where that
precision is known, and with the exchange's float padding removed where it is
not; the padded string the exchange sends SHALL NOT be rendered as though it
were precision. A symbol MAY be shortened to its base asset where the quote
asset is the one every contract on the desk settles in, provided the whole name
remains available on the cell and on every control that acts on the contract.

#### Scenario: A row states a value
- **WHEN** an order worth 10 982 USDT rests in the list
- **THEN** the row states `10982`, the unit is stated once by the column heading, and the exact contract count is available on the cell

#### Scenario: The exchange pads a price
- **WHEN** the exchange reports the order resting at `0.0148410`
- **THEN** the row states `0.014841`, and a contract whose tick size is known is stated at that tick instead

#### Scenario: An order rests on another contract
- **WHEN** the account holds orders on contracts other than the one on screen
- **THEN** every row names its own contract, shortened to its base asset with the whole name on the cell, rather than losing the column to its neighbours

### Requirement: Orders the stream does not report are read on their own beat
Order kinds the authenticated stream does not report — the algorithmic orders
the desk lists and cancels but cannot place — SHALL be read on the periodic
reconciliation and on an operator-requested refresh, and SHALL NOT be read in
response to an execution report or a position change.

#### Scenario: A fill arrives while an algorithmic order rests
- **WHEN** an execution report arrives for a regular order and an algorithmic order is listed
- **THEN** no algorithmic-order read is issued, and the listed algorithmic order stays as last read

#### Scenario: The operator asks for a refresh
- **WHEN** the operator requests an account refresh
- **THEN** the algorithmic orders are read again alongside the regular ones

### Requirement: The account review survives a restart
Orders and trades that have reached a terminal state SHALL be stored locally per
contract, together with the window the stored rows are known to cover. On launch
the review SHALL be presented from the store before any exchange read is issued.
The store SHALL be bounded per contract, SHALL hold only terminal rows, and a
store that is unavailable or unreadable SHALL degrade to reading from the
exchange rather than failing the review.

#### Scenario: The desk is reopened
- **WHEN** the operator opens the history panel in a new run and rows were stored in an earlier one
- **THEN** they are presented from the store, stamped with when they were read, before any request is sent

#### Scenario: The store cannot be opened
- **WHEN** the local store is unavailable
- **THEN** the review is read from the exchange exactly as it is without a store

### Requirement: A history read asks only for what is missing
A history read SHALL ask each contract for the rows after the ones already held
rather than for the whole window, using the identity the exchange pages from. A
contract whose held rows the authenticated stream has kept current SHALL NOT be
read at all, and a stream disconnection SHALL end that assumption for every
contract. A bounded rotation SHALL re-read contracts that have been skipped, so
a missed event cannot hide indefinitely. A read that outlives its renderer's
Futures activation SHALL NOT publish or restore state into a later activation.

#### Scenario: A contract traded since the last read
- **WHEN** the operator refreshes the review and a contract has had fills since the last read
- **THEN** that contract is read forward from the last row already held, not from the start of the window

#### Scenario: A contract that has not moved
- **WHEN** the operator refreshes the review, the stream has been connected throughout, and a contract has had no activity since the last read
- **THEN** no read is issued for that contract and its held rows are presented unchanged

#### Scenario: The stream was disconnected
- **WHEN** the authenticated stream dropped since the last read
- **THEN** the next refresh reads every contract the review covers, because nothing can vouch for what happened while it was down

#### Scenario: A read outlives the Futures activation
- **WHEN** the renderer leaves Futures or disconnects while a history request is in flight
- **THEN** the obsolete request publishes no answer, restores no discovery, and the next activation discovers its own contracts

### Requirement: Contract discovery is asked only when the store cannot answer
The income walk that names which contracts the account traded SHALL be issued
when the store names none, when what it names has aged past the review's window,
or when the operator asks for a full re-read. A refresh the store can answer
SHALL issue no income read. A paged income walk SHALL retain its inclusive time
bounds and SHALL NOT omit contracts merely because multiple rows share the page
boundary timestamp.

#### Scenario: The store names the contracts
- **WHEN** the operator refreshes the review and the store holds contracts within the window
- **THEN** the fan-out covers them and no income read is issued

#### Scenario: The operator asks for a full re-read
- **WHEN** the operator asks for the review to be read in full
- **THEN** discovery runs and every contract it names is read across the whole window

#### Scenario: Income rows share a page-boundary timestamp
- **WHEN** a full discovery page ends at the same millisecond as rows on the next page
- **THEN** discovery reads the next numbered page with the same inclusive time bounds and includes contracts from both pages

### Requirement: Cancelled orders do not clutter the visible review
The order-history presentation SHALL omit rows whose normalized status is
`CANCELED` or `CANCELLED`. The held reading, persisted records, and coverage
cursors SHALL retain those rows so presentation filtering cannot create a gap
in subsequent exchange reads.

#### Scenario: The reading contains cancelled and filled orders
- **WHEN** the operator opens order history for a reading containing cancelled and filled orders
- **THEN** filled orders are shown, cancelled orders are not shown, and the underlying reading remains unchanged

### Requirement: Dense market bursts do not stall the application
The renderer SHALL process aggregate market input of at least 2 MiB per 100 ms
cycle as individually bounded valid workstation events. At each completed cycle
the latest event SHALL reach the visible Futures workspace, the workspace SHALL
remain live, and an operator control SHALL remain responsive. Existing
per-event byte and shape limits SHALL remain unchanged.

#### Scenario: The renderer receives consecutive dense market cycles
- **WHEN** the live Futures App receives at least 2 MiB of valid bounded workstation events for each consecutive 100 ms cycle
- **THEN** the newest cycle is visible after each boundary, no event backlog grows across cycles, and an operator control still responds

### Requirement: A drag lifts the order off the book
Beginning a drag on a working order SHALL cancel that order. The drag SHALL
begin only once the cancellation is confirmed; if it is refused or its outcome is
unknown, the order SHALL be left alone and no drag SHALL start. Once the
cancellation is confirmed the order SHALL leave the chart, the order list and
every other surface that lists working orders, because it no longer exists.

#### Scenario: The operator picks an order up
- **WHEN** the operator begins a drag on a working order and the exchange confirms the cancellation
- **THEN** the order is no longer listed as working and no longer drawn at the price it rested at

#### Scenario: The cancellation is refused
- **WHEN** the exchange refuses the cancellation
- **THEN** no drag begins, the order remains working and drawn where it was, and the refusal is stated

#### Scenario: The cancellation's outcome is unknown
- **WHEN** the cancellation is sent and the exchange does not confirm it either way
- **THEN** no drag begins and the unknown outcome is presented as unknown, so the operator is not told the order is gone

### Requirement: The order being dragged is drawn
While a drag is in flight the order that will be placed SHALL be drawn at the
price under the pointer, carrying its side and its size, and SHALL be the only
mark on the chart standing for it. The price the order was lifted from MAY carry
one faint marker, distinct from a working order and without an axis label.

#### Scenario: An order is being dragged
- **WHEN** an order is being dragged across the chart
- **THEN** it is drawn once, at the pointer, and no working-order mark for it remains at the price it was lifted from

#### Scenario: Other orders during a drag
- **WHEN** one order is being dragged and others rest on the same contract
- **THEN** the others keep their lines, labels and handles unchanged

### Requirement: A drag owes a replacement
From the moment a lifted order's cancellation is confirmed, the system SHALL owe
a replacement order and SHALL discharge that obligation in exactly one of three
ways: by placing the replacement at the price the drag ended on, by placing it
again at the price it was lifted from when the drag is abandoned, or by stating
that neither could be placed. The third case SHALL name the order that is gone,
state why the replacement failed, and offer to place it again. It SHALL NOT be
reported only in a log.

#### Scenario: The drag ends at a new price
- **WHEN** the operator drops a dragged order at a price the desk accepts
- **THEN** a replacement order is placed at that price

#### Scenario: The drag is abandoned
- **WHEN** the operator abandons the drag by releasing the modifier, by cancelling, or by dropping at the price the order was lifted from
- **THEN** the order is placed again at the price it was lifted from

#### Scenario: The replacement cannot be placed
- **WHEN** the replacement is refused by the exchange or by a local limit
- **THEN** the desk states that the order was cancelled and not replaced, names it, gives the reason, and offers to place it again

#### Scenario: The replacement's outcome is unknown
- **WHEN** the replacement is sent and its outcome is not confirmed
- **THEN** it is presented as unknown and no further replacement is placed automatically, because a second attempt could leave two orders on the book

