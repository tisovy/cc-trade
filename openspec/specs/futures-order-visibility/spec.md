# futures-order-visibility

## Purpose

Defines account-wide synchronization of regular and algorithmic Futures orders and their consistent presentation across the chart and sidebar.
## Requirements
### Requirement: The account order model includes regular and algorithmic orders
The system SHALL synchronize both regular open orders and currently open algorithmic orders from the authenticated USDⓈ-M account. Each normalized order SHALL retain its source kind, exchange identity, symbol, side, type, status, quantity, prices relevant to that type, reduce-only or close-position intent when supplied, and exchange update time.

An algorithmic order SHALL additionally retain the identity and price of the
regular order it spawned, when the exchange reports them. The exchange reports an
order that has not fired with an empty value, and that value SHALL be retained as
the exchange states it rather than coerced into a null or a zero — the difference
between "has not fired" and "fired at nothing" is the difference between an order
the operator can still move and one they cannot.

#### Scenario: Account has regular and algorithmic orders for TUTUSDT
- **WHEN** Binance returns one regular order and one algorithmic order for `TUTUSDT`
- **THEN** both orders are present in the normalized account order state with distinct source kinds and identities

#### Scenario: The same numeric identifier occurs in two namespaces
- **WHEN** a regular order and an algorithmic order share the same numeric identifier
- **THEN** they remain distinct because order identity includes the source kind

#### Scenario: One order endpoint fails
- **WHEN** either the regular-order or algorithmic-order request fails while the other succeeds
- **THEN** the successful source is updated, the failed source retains its last confirmed snapshot if any, and the UI reports partial synchronization rather than claiming the combined order list is complete

#### Scenario: An algorithmic order has fired
- **WHEN** Binance reports an algorithmic order carrying the identity and price of the regular order it spawned
- **THEN** both are retained on the normalized order, so the spawned order can be recognized when the stream reports it

#### Scenario: An algorithmic order has not fired
- **WHEN** Binance reports an algorithmic order whose spawned-order identity is the documented empty value
- **THEN** that value is retained as reported, and the order is not read as having fired

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
operator-requested refresh, the periodic beat, or a command whose effect no
stream can report. The periodic read SHALL run while orders are working and
SHALL stop while none are, so that a desk holding nothing spends no weight on it.

A command the desk sends SHALL NOT be a reason on its own. The exchange reports
what the command did on the stream the desk is already listening to, and reading
the account back to learn the same thing spends ninety weight, holds the desk's
resources in a loading state for the length of the read, and — repeated once per
command — exhausts the minute's budget in eight commands. When no authenticated
stream is up there is nothing else to learn it from, and then the read stands.

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

#### Scenario: A command completes while the stream is up
- **WHEN** the exchange answers a placement, cancellation or amendment and the authenticated stream is connected
- **THEN** no account read is issued for it, and the order reaches the desk on the stream

#### Scenario: A command completes with no stream to report it
- **WHEN** the exchange answers a command and no authenticated stream is connected
- **THEN** the account is read, because nothing else can say what the command did

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

### Requirement: The working-order editor offers direction-aware percentage sizing
The working-order editor SHALL present a compact percentage slider synchronized
with its editable `Amount, USDT` field. The slider SHALL cover zero through one
hundred percent in `0.5` percentage-point increments and SHALL translate every
slider selection into a whole-USDT amount before the existing exchange-filter,
local-limit, and atomic-amendment checks run.

For an entry order, one hundred percent SHALL represent the same currently
available USDT sizing capacity used by the execution ticket. For an exit order,
one hundred percent SHALL represent the matching open position available to be
reduced, valued at the editor's current draft price. Typing an amount directly
SHALL remain supported and SHALL update the slider to the nearest representable,
bounded half-percentage without rewriting the typed amount.

#### Scenario: Operator resizes an entry with the slider
- **WHEN** the operator moves an entry order's editor slider to `37.5%`
- **THEN** the amount field shows the whole-USDT notional for `37.5%` of the current available sizing capacity and Apply uses the quantity derived from that amount

#### Scenario: Operator resizes an exit with the slider
- **WHEN** the operator moves an exit order's editor slider to `50%` while the matching position is available
- **THEN** the amount field represents half of that position at the current draft price and Apply remains a single atomic amendment

#### Scenario: Operator types an amount directly
- **WHEN** the operator types a whole-USDT amount that does not land exactly on a half-percentage stop
- **THEN** the typed amount is preserved and the slider reflects its nearest bounded `0.5%` position

#### Scenario: Sizing reference is unavailable
- **WHEN** the current available entry capacity or matching exit position cannot be established
- **THEN** the percentage slider is disabled, the existing amount field remains editable, and all existing validation and refusal messages continue to apply

#### Scenario: Slider selection violates an existing bound
- **WHEN** a slider-derived amount violates an exchange filter or local order limit
- **THEN** Apply remains disabled with the existing contextual reason and no amendment command is emitted

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
order, and SHALL NOT remove an open order the stream has recently reported
working. A snapshot requested before that report could not have seen the order;
a snapshot requested shortly after it may still be answered from a view of the
exchange that has not caught up with its own matching engine. Neither silence is
evidence that the order is gone. Only when the stream has said nothing about the
order for longer than the window the exchange's answer may trail the stream by
does the snapshot decide, and an order it omits is no longer working.

An order the exchange has reported settled SHALL NOT be listed as working again,
by any message. This covers both a report that left the exchange before the
settlement — the reply to a placement that filled the instant it was made — and
an account snapshot read from a service that had not yet seen the settlement.
Settlement is remembered by the order's exchange identity rather than compared by
time, because the exchange does not reuse an order id; the memory SHALL be
bounded, since it guards messages in flight rather than recording history. A
settlement report that carries no order id SHALL settle nothing, its identity
being the prefix every unidentified order on that contract would share.

What the stream has reported working SHALL be remembered on the desk's own clock
and compared against when the read was issued, less that window, so the
comparison does not depend on the exchange's clock agreeing with the desk's. That
memory SHALL be bounded on the same grounds as the settled one, and an order
reported settled SHALL leave it — a settlement the stream reports ends the hold
at once rather than waiting for the window to close.

#### Scenario: Snapshot arrives with pre-amendment values
- **WHEN** an amendment is confirmed and the account synchronization that follows returns the order with an earlier update time
- **THEN** the order keeps the confirmed price and size, and no operator refresh is required to see them

#### Scenario: Snapshot is newer than the local report
- **WHEN** the account snapshot reports the order with a later update time than the last locally applied report
- **THEN** the snapshot values replace the local ones

#### Scenario: A read issued before the order existed answers without it
- **WHEN** an order is placed, the stream reports it working, and an account read issued before that report returns a working-order list that does not contain it
- **THEN** the order stays listed as working, and it is not removed and re-added as later reads catch up

#### Scenario: A read issued after the placement has not caught up with it
- **WHEN** an order is placed, the stream reports it working, the desk reads the account it has just changed, and that read — issued after the report — returns a working-order list that does not contain the order
- **THEN** the order stays listed as working, because the exchange's own answer may trail its stream

#### Scenario: A read reports an order the stream has not spoken about
- **WHEN** an account read returns a working-order list without an order the desk holds, and the stream has reported nothing about that order for longer than the window the exchange's answer may trail it by
- **THEN** the order is removed, because the read is the newer statement about it

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
price, an order that has not filled has no average price — the desk SHALL show
that as absent rather than as a zero rendered through the contract's tick.

The order review SHALL state the order's price and the average it achieved as one
reading rather than as two columns. Where the two differ, the achieved average
SHALL be what is shown, marked as an average rather than as the price the order
names, and both readings SHALL be stated on the element.

#### Scenario: A filled market order is listed
- **WHEN** order history lists a market order
- **THEN** its price cell reads as the average it actually got, marked as an average, and the element states that the order named no price

#### Scenario: A working order has not filled
- **WHEN** order history lists an order with nothing executed
- **THEN** its price cell shows the limit price the order names, and no average is claimed

#### Scenario: An order filled away from its own price
- **WHEN** an order's average fill price differs from the price it was placed at
- **THEN** the cell shows the average, marked as one, and both prices are stated on the element

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

The size an order is valued at SHALL be what is still working: the quantity it
was placed at, less the quantity that has traded. A partly filled order commits
its remainder, and the filled part is already reported as the position it
formed — valuing the order at the size it was placed at states that part twice.
The traded quantity SHALL be read whether the source names it as a stream report
does or as an account snapshot does, and the exact contract count offered beside
the value SHALL state the same working quantity rather than the original one.

What has traded SHALL remain separately readable. Stating what is still working
answers a different question from stating what has filled, and neither SHALL be
derived from the other's absence.

#### Scenario: A limit order is listed
- **WHEN** a working order rests at `58445.00` for `0.004` contracts
- **THEN** the size cell reads `234` under a `Size (USDT)` header, and its title states `0.004 contracts`

#### Scenario: An algo order is listed
- **WHEN** a stop order carries `price` `0`, a trigger price of `57000.00` and `0.01` contracts
- **THEN** the size cell reads `570` rather than a zero

#### Scenario: The same order is read on two surfaces
- **WHEN** the operator compares a working order's size in the list against the same order on the chart or in the editor
- **THEN** both state the same USDT amount

#### Scenario: An order is partly filled
- **WHEN** an order placed for `10` contracts at `100` has `5` contracts filled and is still working
- **THEN** every surface values it at `500` rather than at `1000`, and the exact count offered beside that value states the working `5` contracts

#### Scenario: The filled part is asked for on its own
- **WHEN** the operator reads how much of a working order has traded
- **THEN** that quantity is stated in its own right, unchanged by the order being valued at its remainder

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
Order kinds the desk does not learn from the authenticated stream — the
algorithmic orders it lists and cancels but cannot place — SHALL be read on the
periodic reconciliation and on an operator-requested refresh, and SHALL NOT be
read in response to an execution report or a position change.

This SHALL be stated as what the desk does, not as what the exchange sends. The
exchange documents an `ALGO_UPDATE` event on this stream; whether it is
delivered to this desk is unverified, and nothing here SHALL depend on it until
a received frame says so.

The one exception SHALL be an execution report whose order identity is one a
listed algorithmic order reports having spawned. That parent SHALL be resolved
from the report rather than left on screen until the beat comes round, and it
MAY be read once for that match alone. The read SHALL be deduplicated and SHALL
remain inside the read budget, so a burst of fills against one parent is one
read. An execution report matching no listed parent SHALL still read nothing.

#### Scenario: A fill arrives while an algorithmic order rests
- **WHEN** an execution report arrives for a regular order and an algorithmic order is listed
- **THEN** no algorithmic-order read is issued, and the listed algorithmic order stays as last read

#### Scenario: The operator asks for a refresh
- **WHEN** the operator requests an account refresh
- **THEN** the algorithmic orders are read again alongside the regular ones

#### Scenario: A fill arrives on an order a listed parent spawned
- **WHEN** an execution report carries the identity a listed algorithmic order reports having spawned
- **THEN** that parent is resolved from the report, and at most one algorithmic-order read is issued for the match

#### Scenario: A burst of fills lands on one spawned order
- **WHEN** several execution reports arrive for the same spawned order
- **THEN** they resolve the same parent and produce one read, not one per report

#### Scenario: A cancel-all clears both books
- **WHEN** the operator cancels everything on a contract and the exchange accepts it
- **THEN** the algorithmic orders are read back, because no stream reports what became of them, and the regular ones are not

#### Scenario: The stream reports an algorithmic order
- **WHEN** the authenticated stream delivers an algorithmic-order update for a listed algorithmic order
- **THEN** the listed order is updated from that frame, and no account read is issued because of it

#### Scenario: The stream has never been seen to report one
- **WHEN** the desk can fold such an event but has not observed one arriving on this account
- **THEN** the periodic beat and the post-command read both stay exactly as they are

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
Beginning a drag on a working order SHALL cancel that order. A drag SHALL begin
only on a working order picked up with the trading modifier held, and SHALL be
held by the pointer from then on: the modifier SHALL NOT be required for the
gesture to continue, and releasing it SHALL neither end the gesture nor change
where the order is going. The drag SHALL follow the pointer from the moment the
gesture begins, without waiting for the cancellation to be answered; the desk
SHALL NOT present the order as gone until the cancellation is confirmed. If the
cancellation is refused or its outcome is unknown, the drag SHALL end with
nothing lifted and the order SHALL be left alone. Once the cancellation is
confirmed the order SHALL leave the chart, the order list and every other
surface that lists working orders, because it no longer exists.

#### Scenario: The operator picks an order up
- **WHEN** the operator begins a drag on a working order and the exchange confirms the cancellation
- **THEN** the order is no longer listed as working and no longer drawn at the price it rested at

#### Scenario: The pointer moves before the exchange answers
- **WHEN** the operator begins a drag and moves the pointer while the cancellation is still in flight
- **THEN** the mark for where the order is going follows the pointer, without waiting for the answer

#### Scenario: The modifier is released during the gesture
- **WHEN** the operator lets the trading modifier go while the button is still down
- **THEN** the drag continues and the mark keeps following the pointer, whether or not the cancellation has been answered

#### Scenario: The cancellation is refused
- **WHEN** the exchange refuses the cancellation
- **THEN** the drag ends, the order remains working and drawn where it was, and the refusal is stated

#### Scenario: The cancellation's outcome is unknown
- **WHEN** the cancellation is sent and the exchange does not confirm it either way
- **THEN** the drag ends and the unknown outcome is presented as unknown, so the operator is not told the order is gone

### Requirement: The order being dragged is drawn
While a drag is in flight the order that will be placed SHALL be drawn at the
price under the pointer, carrying its side and its size. Until the cancellation
is confirmed that mark SHALL be drawn as pending — distinguishably from a lifted
order — and the working order SHALL remain drawn at the price it rests at,
because it is still on the book. From the confirmation onward the pointer's mark
SHALL be the only mark on the chart standing for that order, and the price it
was lifted from MAY carry one faint marker, distinct from a working order and
without an axis label.

#### Scenario: The cancellation is still in flight
- **WHEN** the operator is dragging an order whose cancellation has not been answered
- **THEN** the mark at the pointer is drawn as pending, and the working order is still drawn where it rests

#### Scenario: An order is being dragged
- **WHEN** an order is being dragged across the chart after its cancellation was confirmed
- **THEN** it is drawn once, at the pointer, and no working-order mark for it remains at the price it was lifted from

#### Scenario: Other orders during a drag
- **WHEN** one order is being dragged and others rest on the same contract
- **THEN** the others keep their lines, labels and handles unchanged

### Requirement: A drag owes a replacement
From the moment a lifted order's cancellation is confirmed, the system SHALL owe
a replacement order and SHALL discharge that obligation in exactly one of three
ways: by placing the replacement at the price the drag ended on, by placing it
again at the price it was lifted from when the drag is abandoned, or by stating
that neither could be placed. The price the drag ended on SHALL be the price
under the pointer when the button came up, and SHALL NOT depend on whether the
modifier was still held at that moment. A gesture that ends before the
cancellation is answered SHALL be discharged at the price it ended on, on the
same terms as one that ends after. The third case SHALL name the order that is
gone, state why the replacement failed, and offer to place it again. It SHALL
NOT be reported only in a log.

#### Scenario: The drag ends at a new price
- **WHEN** the operator drops a dragged order at a price the desk accepts
- **THEN** a replacement order is placed at that price

#### Scenario: The button comes up with the modifier already released
- **WHEN** the operator lets the modifier go and then releases the button at a new price
- **THEN** the replacement is placed at that price rather than at the price the order was lifted from

#### Scenario: The drop lands before the cancellation is answered
- **WHEN** the operator drops the order at a new price while the cancellation is still in flight, and the cancellation is then confirmed
- **THEN** the replacement is placed at the price it was dropped at rather than at the price it was lifted from

#### Scenario: The drag is abandoned
- **WHEN** the operator abandons the drag by dropping it at the price the order was lifted from, or the gesture is cancelled
- **THEN** the order is placed again at the price it was lifted from

#### Scenario: The replacement cannot be placed
- **WHEN** the replacement is refused by the exchange or by a local limit
- **THEN** the desk states that the order was cancelled and not replaced, names it, gives the reason, and offers to place it again

#### Scenario: The replacement's outcome is unknown
- **WHEN** the replacement is sent and its outcome is not confirmed
- **THEN** it is presented as unknown and no further replacement is placed automatically, because a second attempt could leave two orders on the book

#### Scenario: A second order is reached for before the first has landed
- **WHEN** the operator lifts another order while a replacement for an earlier one is still in flight
- **THEN** the second order is lifted, and the two obligations are discharged independently

#### Scenario: Two replacements both fail
- **WHEN** two outstanding replacements are both refused
- **THEN** each is stated on its own, naming its own order and reason, and placing one again leaves the other's statement standing

#### Scenario: The same order is lifted twice
- **WHEN** a lift is attempted for an order that is already lifted
- **THEN** it is refused with a statement, rather than nothing happening

#### Scenario: Two orders are lifted before either is dropped
- **WHEN** the operator lets go of one drag inside its cancellation round trip, lifts another, and both are then dropped
- **THEN** each order is placed at the price its own drag ended on and in its own size, and neither obligation is discharged by the other's drop

#### Scenario: A drop names an order nothing is owed for
- **WHEN** a drop names an order the system holds no outstanding obligation for
- **THEN** nothing is placed, because that would be a new order rather than a replacement

#### Scenario: One drag ends twice
- **WHEN** the same drag is dropped more than once
- **THEN** one replacement is placed, not one per drop

#### Scenario: An earlier drag is discharged during a later gesture
- **WHEN** an earlier drag's cancellation or replacement is answered while the operator is in the middle of another drag
- **THEN** the drag in hand keeps the pointer and still ends where the operator releases it

### Requirement: A trigger the exchange refused is stated, not silently dropped
When the exchange reports that a conditional order met its trigger and was then
refused by the matching engine, the desk SHALL state that refusal in the
exchange's own words, naming the contract and the order it applies to.

A trigger that was refused SHALL NOT be presented the same as a trigger that
filled, and SHALL NOT be left to disappear at the next reconciliation with
nothing said. This is the one case where the operator's stop does not become a
position, and the reason it did not is the only thing that tells them whether to
place it again.

#### Scenario: A stop triggers and the engine refuses it
- **WHEN** a conditional order triggers and the exchange reports the trigger rejected
- **THEN** the refusal is stated with the exchange's own reason, against the contract and order it names

#### Scenario: The reconciliation catches up afterwards
- **WHEN** the next reconciliation removes the refused order from the listed algorithmic orders
- **THEN** the statement of why it went is not withdrawn by that removal

### Requirement: The account review is read once and then held
The account order and trade history SHALL be read from the exchange when the
Futures workspace opens, and afterwards only on an explicit operator request.
Selecting a history view, returning to a view already selected, changing the
selected contract, or re-entering the workspace SHALL render from the held
reading and SHALL issue no exchange read.

#### Scenario: The operator switches between history views
- **WHEN** the operator selects the order history and then the closed positions, having already loaded the history
- **THEN** both views render from the held reading and no account history request is sent

#### Scenario: The operator asks for a refresh
- **WHEN** the operator uses the refresh control on the history panel
- **THEN** one account history read is issued

#### Scenario: The contract on screen changes
- **WHEN** the operator selects a different contract while a history view is open
- **THEN** the held reading continues to be shown, because it spans the account rather than the contract

### Requirement: A refresh replaces the reading rather than removing it
While a history read is in flight the previously held rows SHALL remain on
screen, marked as being refreshed. They SHALL be replaced only when an answer
arrives. When the read fails the held rows SHALL remain, with the failure stated
beside them rather than in place of them.

#### Scenario: A refresh is in flight
- **WHEN** a history read has been issued and has not yet answered
- **THEN** the rows already read stay on screen and are marked as being refreshed

#### Scenario: A refresh fails
- **WHEN** a history read fails
- **THEN** the held rows remain readable and the failure is stated alongside them

#### Scenario: Nothing has ever been read
- **WHEN** no history reading is held and one is in flight
- **THEN** the panel states that it is loading, because there is nothing to hold

### Requirement: The held review is maintained by the stream
An order reaching a terminal state and a fill reported on the Futures user-data
stream SHALL be folded into the held history, so that the review reflects them
without an exchange read. A folded entry SHALL be identified by the same order
and trade identities the read uses, so the same event cannot appear twice.

#### Scenario: An order is filled while the review is held
- **WHEN** an order reaches a terminal state on the user-data stream and the history has been read
- **THEN** it appears in the order review without a further exchange read

#### Scenario: The same order is then read again
- **WHEN** a subsequent read returns an order already folded in from the stream
- **THEN** it appears once, not twice

#### Scenario: A position is closed while the review is held
- **WHEN** fills that close a position arrive on the user-data stream
- **THEN** the closed-position review reflects the closed position without a further exchange read

### Requirement: The review states how old it is
A held history reading SHALL state when it was taken, so that a reading held
from earlier in the session is not read as one taken just now.

#### Scenario: The review has been open for some time
- **WHEN** the operator opens a history view whose reading was taken earlier
- **THEN** the panel states when the reading was taken

### Requirement: A read replaces only the contracts it covered
The account history read is a fan-out over a bounded set of contracts, and a
contract may drop out of it — its request failed, the discovery that names it ran
short, or it no longer holds a position or working order to seed it. Rows held
for a contract the read did not cover SHALL be kept, and rows for a contract it
did cover SHALL be replaced by what it returned. The panel's statement of how
many contracts the review covers SHALL count only contracts that were read.

#### Scenario: A later read does not reach a contract the review holds rows for
- **WHEN** an account history read returns without covering a contract whose rows are already held
- **THEN** those rows remain in the review, and the closed position they describe is still listed

#### Scenario: A read covers a contract and returns fewer rows for it
- **WHEN** an account history read covers a contract and does not return a row previously held for it
- **THEN** that row is dropped, because the read is the authority on the contract it covered

### Requirement: Contract discovery reaches the session being reviewed
The read that names which contracts the account traded SHALL cover the most
recent part of its window before the rest of it, so that a bounded walk reaches
the contracts traded today rather than those traded at the far end of the window.
Where the walk stops short, the review SHALL state that more may have been
traded.

#### Scenario: The account realized more rows than the walk is bounded to
- **WHEN** the account has more realized-PnL rows in the window than the discovery walk can page through
- **THEN** the contracts traded most recently are the ones discovered, and the review states that the discovery was not complete

### Requirement: A closed position is what was actually closed
Fills SHALL be folded into positions without inventing one. Where a fill reduces
more than the fills in hand show is held, and what the exchange reports it
realized does not account for a reversal, the fill SHALL be read as closing a
position opened before this window of fills rather than as opening one in the
opposite direction. The entry price of such a position SHALL be the one the
exchange's realized PnL states.

That test SHALL be made against the average entry of the size still held —
unmoved by a close, moved only by a further entry — because that is the average
the exchange settles a fill's realized PnL against. It SHALL NOT be made against
the average of everything the round has entered: the two part company as soon as
a position is scaled out of and back into at a different price, and a real
reversal then reads as a remainder.

A fill that realizes exactly nothing states nothing about which of the two it is,
because an opening fill realizes nothing either. Where such a fill would open a
round and the walk has not yet seen that contract flat, the run of fills that
follows it on the same side SHALL settle it: if any of them realizes anything,
the run is reducing a position rather than building one, and the round SHALL be
read as closing a position opened before this window. Fills SHALL be read as one
run only while they stay on the same side and the same position leg. Where the
run settles nothing, the reading SHALL NOT change.

#### Scenario: The window of fills opens while a position is already held
- **WHEN** the operator adds to a position opened before the read's window and then closes all of it
- **THEN** the review shows one closed position of the whole size, and no position in the opposite direction

#### Scenario: The position really did reverse
- **WHEN** a fill reduces past flat and its realized PnL accounts for closing exactly what was held
- **THEN** the review shows the position closed and the opposite one opened

#### Scenario: The position was scaled out of and back into before it reversed
- **WHEN** a position is partly closed, added to again at a different price, and then reduced past flat
- **THEN** the review still shows a closed position and the opposite one opened, each with the entry its own fills state, and neither presented as recovered from a position older than the window

#### Scenario: The window opens on a close that realized nothing
- **WHEN** the first fill of a contract in the read's window closes part of a position older than the window at exactly its average entry, and a later fill on the same side closes the rest at a profit
- **THEN** the review shows one closed position covering both, at the entry the realized PnL states, carrying all of what was realized — and no position in the opposite direction

#### Scenario: The window opens on a position being built
- **WHEN** the first fills of a contract in the read's window open a position and none of them realizes anything
- **THEN** the review reads them as the position they opened, at the entry its own fills state

### Requirement: An open position's value moves with the market between marks
Between two mark-price updates, an open position's unrealized PnL and its
percentage SHALL be re-priced against the most recent traded price for that
contract, at a bounded repaint rate. When a mark arrives, the confirmed
mark-based figure SHALL replace the estimate.

#### Scenario: The market moves between two marks
- **WHEN** trades print for a contract holding an open position and no new mark has arrived
- **THEN** the position's value and PnL follow those prints rather than standing still

#### Scenario: A mark arrives
- **WHEN** a mark price arrives for that contract
- **THEN** the position's PnL is the exchange's own arithmetic on that mark

### Requirement: An estimated reading says that it is estimated
A PnL re-priced from the last traded price SHALL be presented as an estimate,
distinguishably from one computed on a confirmed mark, and SHALL state the
confirmed figure it is an estimate of. Liquidation price and liquidation
distance SHALL NOT be estimated this way, and neither SHALL any margin reading
measured from them — the margin balance and the amount the desk offers for
withdrawal are statements about liquidation, and liquidation is the mark's.

#### Scenario: The operator reads an interpolated PnL
- **WHEN** the value shown was computed from the last trade rather than from a mark
- **THEN** the surface shows it as an estimate, names the mark-based figure beside it, and the liquidation reading remains the mark's

#### Scenario: Margin is measured while the estimate is on screen
- **WHEN** the desk states a margin balance, a distance to liquidation, or an amount of margin that may be withdrawn, while the PnL on screen is an estimate
- **THEN** those readings are computed from the mark's own unrealized PnL rather than from the estimate

### Requirement: A drag does not pay for the rest of the desk
Following the pointer SHALL cost a fixed, small amount of work per pointer move,
independent of how much of the desk is being redrawn at the same time.

The gesture SHALL NOT read the desk's layout while it runs: the chart's box SHALL
be measured once for the gesture and measured again only when the chart is
resized. A layout read is answered cheaply only against a layout that is already
clean, and the desk's never is — the book, the dock and the header write to it
throughout the drag — so a read at pointer rate lays the whole desk out again on
every frame of the gesture.

The mark that follows the pointer SHALL be moved by a property that does not
invalidate layout, so that neither the desk nor the charting library is charged a
fresh layout pass for the frame the operator is dragging in. A pointer move that
leaves the mark on the row it already occupies SHALL redraw nothing.

#### Scenario: The pointer moves while the desk is busy
- **WHEN** the operator drags an order while the rest of the desk is being redrawn from the stream
- **THEN** the mark follows the pointer, and the gesture measures no layout to do it

#### Scenario: The chart is resized during a drag
- **WHEN** the chart's box changes while a drag is in flight
- **THEN** the next pointer move is placed against the new box

#### Scenario: A move that changes nothing
- **WHEN** a pointer move leaves the mark on the row it already occupies
- **THEN** neither the chart nor the mark is redrawn

### Requirement: An algorithmic order that has fired does not read as resting
An algorithmic order that is finished by the regular order it spawned SHALL,
once it reports one, be presented as triggered and awaiting confirmation, not as
an order resting at its trigger price. Every surface that draws working orders —
the chart marker, the working-orders list and the portfolio dock — SHALL state it
the same way, and SHALL withhold the controls that apply only to a working order,
because a marker drawn at a price the market has left invites the operator to
move or cancel something the exchange has already acted on.

An algorithmic order that outlives the order it spawned — a scheduled algorithm
that fills one child and places the next, naming the current one in the same
field — SHALL NOT be read this way. It is still working, and reading a child's
settlement as the parent's own would take a running algorithm off the desk. The
kinds that are finished by their spawned order SHALL be named explicitly, and a
kind the desk has not been shown SHALL read as still working.

A control the exchange still accepts on a triggered parent SHALL remain
available, and one it does not SHALL be stated rather than silently absent.

#### Scenario: A stop fires
- **WHEN** a conditional algorithmic order reports a spawned regular order
- **THEN** it reads as triggered and awaiting confirmation on every surface that draws it, rather than as a working order at its trigger price

#### Scenario: The operator reaches for a triggered parent
- **WHEN** the operator opens the controls on an algorithmic order that has fired
- **THEN** repricing and resizing are not offered, and whether the exchange will still cancel it is stated

#### Scenario: The order has not fired
- **WHEN** an algorithmic order reports no spawned order
- **THEN** it reads as working at its trigger price, exactly as it does today

#### Scenario: A scheduled algorithm names its current child
- **WHEN** an algorithmic order that outlives the orders it spawns names one of them
- **THEN** it reads as working, and the settlement of that child neither removes it from the desk nor keeps it from being listed again

#### Scenario: The exchange reports a kind the desk has not been shown
- **WHEN** an algorithmic order names a spawned order under a kind the desk does not recognize
- **THEN** it reads as working, as it did before spawned orders were carried at all

### Requirement: Account-wide order symbols switch the trading contract
Every valid contract symbol in the trading rail's account-wide open-order table SHALL be an explicit keyboard- and pointer-operable control. Activating that control SHALL select the row's contract through the normal workstation symbol-selection path without opening the order editor, cancelling the order, or activating any other row action. The compact visible label MAY omit the common `USDT` suffix, but its accessible name and pointer title SHALL identify the whole contract.

#### Scenario: Operator selects another order's symbol
- **WHEN** the trading rail lists an order for `TUTUSDT` while another contract is selected and the operator activates the row's symbol control
- **THEN** `TUTUSDT` becomes the selected contract and no order edit or cancellation action is emitted

#### Scenario: Operator activates the symbol with a keyboard
- **WHEN** focus is on a trading-rail symbol control and the operator activates it with the keyboard
- **THEN** the same contract-selection action occurs as for a pointer activation

### Requirement: Compact working-order rows preserve small prices
At the supported Futures workstation rail width and default interface scale, a working-order row SHALL show a quoted price as small as `0.000123` in full, alongside its compact symbol label, side, USDT value, and order action. The price SHALL not be replaced by an ellipsis or wrapped onto another line; values beyond the supported visible track SHALL retain their exact reading through the cell's secondary detail.

#### Scenario: A small decimal order price is listed
- **WHEN** a working order in the trading rail has the formatted price `0.000123`
- **THEN** the row visibly states `0.000123` without ellipsis or wrapping and keeps its symbol, side, USDT value, and action visible

### Requirement: Order-history filled value is stated in USDT
The order-history `Filled` column SHALL state the USDT notional that actually executed rather than displaying executed and original contract quantities as its primary value. The presentation SHALL use the exchange's positive cumulative quote amount when available, otherwise SHALL derive the value from executed quantity and positive average fill price, and SHALL report the value as absent when neither source can establish it. The header SHALL name USDT, while the exact executed and original contract quantities and exact USDT value SHALL remain available as secondary detail.

#### Scenario: Exchange reports cumulative quote value
- **WHEN** an order-history row reports `16441` executed contracts and a positive cumulative quote amount of `3259000.25`
- **THEN** the Filled column presents that executed USDT value under a USDT-labelled header and retains the contract quantities and exact USDT amount as secondary detail

#### Scenario: Cumulative quote value is absent
- **WHEN** an order-history row reports `5000` executed contracts, an average fill price of `0.01962`, and no positive cumulative quote amount
- **THEN** the Filled column presents `98.10` USDT as the derived executed notional and identifies the derivation in its secondary detail

#### Scenario: An order has no established execution value
- **WHEN** an order-history row has no positive cumulative quote amount and lacks either a positive executed quantity or a positive average fill price
- **THEN** the Filled column reads as absent rather than as a confident zero-USDT execution

### Requirement: A history row's day is a heading, not a format
A history row SHALL show its time of day, and the day it belongs to SHALL be
stated by the heading it is grouped under rather than by switching the row's own
format. Rows SHALL be grouped under a heading naming their day, so two rows from
different days are never read as two moments of the same day. The whole stamp
SHALL remain available on the element. A closed position SHALL be stamped by when
it closed and grouped under the day it closed on, and the whole span from opening
to closing SHALL remain available on the element.

#### Scenario: The review spans more than one day
- **WHEN** a history table contains rows from today and from an earlier day
- **THEN** each row is under a heading naming its day, and every row shows its time of day

#### Scenario: A row is read for its exact moment
- **WHEN** a history row is displayed
- **THEN** the full stamp is on the element

#### Scenario: A closed position is listed
- **WHEN** the closed-position history lists a round trip
- **THEN** the stamp is when it closed, the row is grouped under that day, and the element carries the whole span it ran for

### Requirement: An order review states what became of each order
Every row of the order review SHALL state the order's outcome as its leading
reading, and that outcome SHALL be readable at every width the workspace
supports. An order that is still working, one that filled, one that filled in
part and one the exchange ended without a fill SHALL each be distinguishable by
the outcome alone rather than by inference from a quantity pair. Where the
outcome generalizes a status the exchange reported, the exchange's own word SHALL
be on the element.

#### Scenario: An order filled in part
- **WHEN** an order executed part of its quantity
- **THEN** the row states that it filled in part and by what proportion

#### Scenario: An order ended without filling
- **WHEN** the review contains an order the exchange expired or rejected with nothing executed
- **THEN** the row states that outcome, without the reader having to compare an executed quantity against an original one

#### Scenario: The panel is at its narrowest supported width
- **WHEN** the order review is rendered at the narrowest width the workspace supports
- **THEN** the outcome of every row is readable without an ellipsis

#### Scenario: The exchange reported a status the chip generalizes
- **WHEN** the exchange reported a status the review states in its own words
- **THEN** the exchange's own word is on the element

### Requirement: An abbreviation on a review row is labelled
A marker on a review row that abbreviates an order property SHALL carry its
meaning in words for a reader who does not know the abbreviation. A reduce-only
order SHALL be marked for what it does — that it can only close a position —
rather than by an unexplained pair of letters.

#### Scenario: A reduce-only order is listed
- **WHEN** the review contains a reduce-only order
- **THEN** the row marks it as an exit and states `reduce-only` in words on the element

### Requirement: An order that did nothing is quieter than one that did
Among the rows the review presents, those whose orders executed nothing SHALL be
presented less prominently than those whose orders executed, so a review of many
dead orders does not obscure the fills within it. This SHALL be a matter of
prominence only: presentation SHALL NOT remove a row the review is presenting.

#### Scenario: The review is mostly orders that did nothing
- **WHEN** the review contains many orders that executed nothing and a few that filled
- **THEN** the filled ones are the more prominent, and the others are still present and readable

### Requirement: A review can be narrowed without reading the exchange again
The order review SHALL offer narrowing by outcome — all, filled, unfilled — and
to the contract on screen. Narrowing SHALL act on the reading already held and
SHALL issue no exchange read, and the statement of what the underlying read
covered SHALL continue to describe the read rather than the narrowed view.

#### Scenario: The operator narrows to filled orders
- **WHEN** the operator narrows the review to filled orders
- **THEN** only orders that executed are listed, no exchange read is issued, and the scope statement still describes what was read

#### Scenario: The operator narrows to the contract on screen
- **WHEN** the operator narrows the review to the contract on screen
- **THEN** only that contract's rows are listed and no exchange read is issued

### Requirement: Every order surface discloses its synchronization state
The chart, the trading rail and the dock SHALL each present the synchronization
state of the order data they draw, distinguishing at least not yet
synchronized, synchronizing, ready, stale and failed. An empty order display
SHALL state that no working orders exist only when a successful synchronization
reported none. A failed or unsynchronized order resource SHALL offer its
sanitized reason and the retry path.

#### Scenario: Synchronization has not run yet
- **WHEN** the order resource has produced no snapshot
- **THEN** the chart and the dock state that orders are not yet synchronized rather than that there are none

#### Scenario: Synchronization failed
- **WHEN** the order resource is in error
- **THEN** the chart and the dock present the failure and its retry path rather than an empty list

#### Scenario: Synchronization succeeded with no orders
- **WHEN** a successful snapshot reports no working orders
- **THEN** the surfaces state that there are no working orders

#### Scenario: Snapshot is stale
- **WHEN** the last successful snapshot has become stale
- **THEN** the surfaces keep showing its orders and disclose that the data is stale

### Requirement: Order intent is presented, not only direction
The system SHALL present the entry or exit intent it derives for an order or a
position alongside its direction. An order that closes a position SHALL be
classified as an exit regardless of the side it is submitted on.

#### Scenario: Reduce-only order on a long position
- **WHEN** a reduce-only sell reduces an open long
- **THEN** the surface presents it as an exit as well as a sell

#### Scenario: Close-position order
- **WHEN** an order carries close-position intent
- **THEN** it is classified as an exit regardless of its side

#### Scenario: Direction remains readable
- **WHEN** intent is presented
- **THEN** the direction remains visible and distinctly coloured as before

### Requirement: A submission surface does not close on a send it did not achieve
When a submission does not reach the backend — including a transport that is
disconnected — the surface that issued it SHALL remain open, SHALL state the
failure, and SHALL preserve the operator's entered values.

#### Scenario: Editor submits while disconnected
- **WHEN** the order editor submits an amendment and the send is refused because the transport is unavailable
- **THEN** the editor stays open, states the reason, and keeps the entered price and amount

#### Scenario: Send succeeds
- **WHEN** the send reaches the backend
- **THEN** the surface behaves as it does today and the outcome is reported through the command result

#### Scenario: Other submission surfaces
- **WHEN** any other submission surface issues a send that does not reach the backend
- **THEN** it follows the same rule rather than dismissing itself

### Requirement: A review never delays the desk learning what its order did
An operator-triggered history read SHALL NOT hold up the account read that
follows a mutating command. Where both contend for the same rate-limited
admission queue, the read that follows a mutation SHALL be admitted first, and a
history fan-out already in flight SHALL NOT have to finish before it.

Overtaking SHALL be bounded. A request already queued SHALL be passed over only
a bounded number of times, so that a history fan-out under way still finishes
however much the operator trades over it.

A history read SHALL fetch the endpoint the view it is answering needs, rather
than every endpoint the panel could show. The other view SHALL read what it needs
when it is opened.

A history read SHALL replace only the endpoints it covered. What is already held
for an endpoint it did not read SHALL survive it — on screen, and in what the
desk keeps across runs — and a view no read has covered SHALL say so rather than
present itself as empty.

#### Scenario: An order is worked while a review is loading
- **WHEN** the operator opens the account history and places or cancels an order before the fan-out has finished
- **THEN** the account read that follows the command is admitted ahead of the remaining history requests

#### Scenario: The desk keeps trading while a review is under way
- **WHEN** the operator works orders continuously while a history fan-out is in flight
- **THEN** each queued history request is passed over only within the bound, and the fan-out still completes

#### Scenario: The operator opens one view of the history
- **WHEN** the operator opens the closed-position history
- **THEN** the fills of the contracts in the fan-out are read and the order log is not, until the order-history view is opened

#### Scenario: The operator switches to the view that has not been read
- **WHEN** the operator opens the order-history view after the closed-position view has loaded
- **THEN** the fills already loaded stay on screen while the order log is read, and neither view is emptied by the other's read

