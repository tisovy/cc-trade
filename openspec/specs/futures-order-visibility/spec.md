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

A price-moving affordance — the chart's drag grip, and the ticket and dock rows' editor doorway alike — SHALL be offered only on an order whose price is the desk's to move: a regular order resting at a positive price and guarding no trigger. A regular order resting at no price — a stop-market order rests with `price: '0'` while its trigger lives in `triggerPrice` — has nothing the desk could re-price; a regular order guarding a trigger — a stop-limit — could only be "moved" by discarding the trigger and leaving a naked limit where a guard stood, and Binance's amend endpoint re-states LIMIT orders only. Where the pane shows such an order, it SHALL be drawn without the drag affordance, SHALL state accessibly — naming its own price — that it cannot be moved, and SHALL keep its cancel control. No drag SHALL begin on such an order and no pending drag mark SHALL be drawn for it — not at the y-coordinate of price zero, not anywhere. An order with no presentable price at all SHALL not be drawn as a handle. The lift path's own refusal SHALL remain, unchanged, for lifts that are genuinely broken in other ways.

What a handle states — its price, its worth, its trigger state — SHALL be what the exchange last said about the order, even while the viewport stands still; a drag begun from a handle SHALL read the order as it is, not as it was drawn.

#### Scenario: Supported regular limit order is amended
- **WHEN** the operator drags an amendable regular limit order to a valid exchange-filtered price and confirms the action
- **THEN** the system sends the source-appropriate operation and reconciles the exchange response

#### Scenario: Algorithmic order amendment is not supported
- **WHEN** an algorithmic order is displayed but source-aware amendment is unavailable
- **THEN** the chart does not offer drag amendment and identifies the order as display-only

#### Scenario: An order resting at no price offers no drag
- **WHEN** a stop-market order rests with no positive resting price
- **THEN** no drag grip is offered and no pending mark is drawn for it, and where the pane shows the order it stays visible and cancellable

#### Scenario: An order guarding a trigger offers no move
- **WHEN** a stop-limit order rests at its own price with a trigger it guards
- **THEN** no drag grip and no editor doorway are offered on it anywhere an order can be edited, its handle names the trigger it guards, and it stays cancellable

#### Scenario: A partial fill redraws the handle under a still viewport
- **WHEN** part of a resting order fills while the price scale and the order's price do not move
- **THEN** the handle restates the order's remaining worth, and a drag begun from it reads the remaining quantity, not the drawn one

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
nature that every close from it carries. While the panel remains open, it SHALL
read the latest live state of the position it was opened for. A market-close
preview SHALL follow the same current valuation used by the open-position
surface; an operator-entered limit price SHALL remain the price of a limit-close
preview. Live valuation changes SHALL NOT reset an operator-edited close size.

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

#### Scenario: The market moves while a market close is being reviewed
- **WHEN** the live valuation of the selected position changes while its close panel remains in market mode
- **THEN** the panel recomputes the close value and estimated PnL from that current valuation, in step with the open-position surface

#### Scenario: The market moves after the operator edits the close size
- **WHEN** the operator has entered a partial close size and the selected position receives a valuation-only update
- **THEN** the entered size remains unchanged while the market-close value and estimated PnL are recomputed for that size

#### Scenario: The position changes while a limit close is being reviewed
- **WHEN** the selected position receives a live update after the operator has entered a limit close price
- **THEN** the preview uses the current position and the operator's limit price, and a market-price update does not replace that limit price

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
The trade history SHALL report closed round trips rather than fills: a position opens when exposure is taken and closes when that same position key returns to flat. A position key SHALL be `{symbol, LONG}` or `{symbol, SHORT}` for hedge-mode fills and `{symbol, BOTH}` for one-way fills. Each round SHALL be reported with its contract, position leg, side, closed size, average entry and exit, and exchange-reported realized PnL in one `PnL` column. The glance value SHALL be rounded to cents from the bounded exact decimal without converting it through a JavaScript `Number`; a non-zero sub-cent amount that would render as zero SHALL keep its exact text. The element SHALL retain the exact exchange decimal, proven settlement asset, canonical additive or qualified wallet outcome, and fee/funding/insurance/credit/coverage detail in its accessible title; those details SHALL NOT become standalone `Gross`, `NET`, fee, or funding columns.

The size SHALL be stated in USDT, valued at the price the round was entered at, because that is what every other size on this desk is stated in and a contract count cannot be compared across contracts. The count of contracts SHALL remain available on the element.

A position that is proven not to have returned to flat SHALL NOT appear in this history. A position whose opening boundary has not been read SHALL be unresolved until older fills or the current account position prove its state; an unresolved sequence SHALL NOT be invented as either a closed round or an opposite open position. A recovered entry MAY be shown only when exchange-reported realized PnL determines it unambiguously, and SHALL be labelled recovered.

#### Scenario: One close arrives as several fills
- **WHEN** one position leg is closed by an order that fills in several parts
- **THEN** the tab shows one row for that position leg whose single `PnL` cell carries the summed exchange-reported realized PnL, while fees remain in the same element's wallet detail rather than being added to the visible PnL

#### Scenario: Realized PnL requires exact display precision
- **WHEN** the exchange-reported realized PnL is a bounded decimal that would round to signed zero or lose precision as a JavaScript `Number`
- **THEN** Closed Positions shows its cents-rounded value in the single `PnL` cell unless that would hide a non-zero sub-cent amount as zero, and exposes the unchanged exact signed decimal plus proven asset on that element

#### Scenario: The position is still open
- **WHEN** the fills and current snapshot prove that a position key has not returned to flat
- **THEN** no row is shown for it in the closed-position history

#### Scenario: The position was opened before the window
- **WHEN** the oldest fills reduce a position whose opening boundary has not yet been read
- **THEN** the sequence remains unresolved until backfill or unambiguous exchange evidence establishes its round

#### Scenario: A recovered entry is displayed
- **WHEN** unambiguous exchange evidence establishes an entry price for a position opened before the visible fill window
- **THEN** the entry cell visibly and accessibly identifies that price as recovered without relying on hover

#### Scenario: A fill flips the position
- **WHEN** a `BOTH` fill reduces more than the signed exposure holds and opens the opposite side
- **THEN** the closed side is reported with the realized PnL made on the way out, and the leftover opens a distinct live round

#### Scenario: Two contracts were traded in the same window
- **WHEN** the window holds fills on more than one contract
- **THEN** each contract's position keys are folded independently, and a fill on one never changes another

#### Scenario: Both hedge legs are open
- **WHEN** a contract has simultaneous `LONG` and `SHORT` fills
- **THEN** neither leg closes, reduces, or changes the round state of the other

#### Scenario: Both hedge legs expose row actions
- **WHEN** simultaneous LONG and SHORT position rows expose size, margin, or close actions for one contract
- **THEN** each action's accessible name identifies its leg so assistive-technology users cannot select the opposite position by mistake

#### Scenario: A closed round is sized
- **WHEN** the closed-position history lists a resolved round
- **THEN** its size is what the position was worth in USDT at its entry, and the contract count is on the element

### Requirement: An order is valued at the price it rests at
An order's stated value SHALL use its own usable positive limit price where it has one. A stop-limit or take-profit-limit order therefore SHALL be valued at its limit price, not at the trigger that decides when it becomes active. Only an order without a usable limit price, including a market-triggered stop whose ordinary `price` is zero, SHALL fall back to its positive trigger price. The normalized order SHALL carry that trigger for regular orders as it already does for algorithmic ones, and SHALL omit the field where the exchange reports no trigger rather than carrying a zero that would be read as a price.

An order SHALL NOT be valued at zero because a field it needs is missing. An order with no usable price or no usable size SHALL be reported as unvaluable, so that a row which could not be read is distinguishable from an order that commits nothing.

#### Scenario: A stop rests in the list
- **WHEN** the exchange reports a resting stop with `price` `0` and a trigger of `58000` for `0.5` contracts
- **THEN** the order is shown at `58000` and valued at `29000` USDT, in the list and in any total of the working orders

#### Scenario: A stop-limit has both prices
- **WHEN** a stop-limit order has a trigger of `58000`, a limit price of `57900` and a working quantity of `0.5` contracts
- **THEN** its stated value is `28950` USDT from the limit price, while the trigger remains separately available as the activation price

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

A price SHALL be stated at the precision the row's own contract quotes where
that precision is known, regardless of which contract is currently selected,
and with the exchange's float padding removed where it is not; the padded string
the exchange sends SHALL NOT be rendered as though it were precision. A symbol
MAY be shortened to its base asset where the quote asset is the one every
contract on the desk settles in, provided the whole name remains available on
the cell and on every control that acts on the contract.

#### Scenario: A row states a value
- **WHEN** an order worth 10 982 USDT rests in the list
- **THEN** the row states `10982`, the unit is stated once by the column heading, and the exact contract count is available on the cell

#### Scenario: The exchange pads a price
- **WHEN** the exchange reports the order resting at `0.0148410`
- **THEN** the row states `0.014841`, and a contract whose tick size is known is stated at that tick instead

#### Scenario: An order rests on another contract
- **WHEN** the account holds orders on contracts other than the one on screen
- **THEN** every row names its own contract, shortened to its base asset with the whole name on the cell, rather than losing the column to its neighbours

#### Scenario: Another contract uses its own tick
- **WHEN** an order belongs to another contract whose tick is `0.0000100` while the selected contract's tick is `0.1`
- **THEN** its price is formatted to that order contract's tick rather than the selected contract's tick or a generic float trim

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

### Requirement: An execution is applied without waiting for market data
An execution report SHALL reach the surfaces that show working orders and
positions without waiting for market data the desk delivered before it. The cost
of reading quotes SHALL NOT be charged to the path that applies a fill: the
handler that applies account events SHALL NOT be given market-data frames, and
SHALL NOT do work to discard them.

The delay from an execution report arriving at the desk to the working-orders
list and the chart reflecting it SHALL be measurable, and SHALL be measured with
a market-data backlog present as well as without one — a fill matters most during
the burst that produces the backlog.

#### Scenario: A fill arrives during a burst
- **WHEN** an order fills while depth frames are arriving at the exchange's full cadence
- **THEN** the filled order leaves the working-orders list and the chart at the same point it would in a quiet market

#### Scenario: The account handler receives a depth frame
- **WHEN** the desk delivers a book to the renderer
- **THEN** the handler that applies execution reports is not given it and does no work on it

#### Scenario: The delay is measured
- **WHEN** the desk is exercised with and without a market-data backlog
- **THEN** the delay from execution report to applied state is recorded for both, rather than being inferred from the absence of complaints

### Requirement: A working order's filled portion is stated in USDT
The working-orders table SHALL state the filled portion as a USDT value under a header naming USDT. The filled portion SHALL be valued at the exchange's stated average fill price when the payload carries a positive one, because that is the price the fill actually happened at; only when no positive average fill price is stated SHALL the value fall back to the same order-price selection rules as the order's stated size. The exact executed contract quantity SHALL remain available as secondary detail. A zero filled quantity SHALL be presented as zero USDT rather than as an absent reading.

#### Scenario: A stop-limit fills through a gap
- **WHEN** a working stop-limit resting at `58000` has executed `0.1` contracts at an average fill price of `58120`
- **THEN** its Filled column states `5812` USDT — the executed quantity at the average fill price — not `5800` from the price the order rested at

#### Scenario: Nothing has filled yet
- **WHEN** a working limit order at `100` for `10` contracts reports an executed quantity of `0` and the exchange's average fill price of `0`
- **THEN** its Filled column falls back to the resting price and states zero USDT, rather than reading as absent

#### Scenario: A limit order is partly filled
- **WHEN** a working limit order at `100` has executed `2` contracts at an average fill price of `99.5`
- **THEN** its Filled column states `199` USDT and its secondary detail states exactly `2 contracts`

#### Scenario: A market-triggered stop is partly filled without a stated average
- **WHEN** a working stop has no positive limit price, a trigger of `58000`, an executed quantity of `0.1` contracts and no stated average fill price
- **THEN** its Filled column states `5800` USDT from the trigger and retains `0.1 contracts` as secondary detail

### Requirement: A market-triggered stop has a chart price
A working order drawn on the chart SHALL use its positive limit price where it has one and otherwise SHALL use its positive trigger price. A regular or algorithmic market-triggered stop whose ordinary price is zero SHALL therefore remain visible at its trigger. This presentation rule SHALL NOT change submission, execution, editing, dragging or cancellation semantics.

#### Scenario: A stop-market reports price zero
- **WHEN** a working stop-market order reports ordinary price `0` and trigger price `58000`
- **THEN** the chart draws the order at `58000`, keeps the original order data unchanged, and keeps all execution and cancellation actions governed by their existing rules

#### Scenario: A stop-limit reports both prices
- **WHEN** a working stop-limit reports a positive limit price and a different trigger price
- **THEN** the chart draws its working order line at the limit price and keeps the trigger as activation information

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

### Requirement: A kept reading is verified against the exchange, not trusted
A reading kept on disk SHALL be re-read whole from the exchange on a cadence the
desk can afford, and what is held SHALL be replaced by what the exchange
answers wherever the two disagree. The disagreement SHALL be recorded.

This is the condition that makes keeping anything safe. A recomputed reading
that is wrong is wrong until the next pass; a kept one is wrong until someone
notices. Where the read has been narrowed enough that a whole window costs one
request per kind of flow, there is no reason to hold a total the desk has not
checked, and the check SHALL therefore not be deferred to a cadence chosen for
cost when cost is no longer the constraint.

A kept reading SHALL never be preferred to the exchange, and SHALL never be the
answer to a question the exchange was not asked.

#### Scenario: The kept reading is verified
- **WHEN** the verification interval passes with a reading loaded from disk
- **THEN** the window is read again from nothing and compared, and the exchange's answer stands wherever they differ

#### Scenario: The kept reading holds a row the exchange no longer states
- **WHEN** a whole-window re-read does not return a row the file holds, inside the span the re-read covered
- **THEN** the row is dropped and the disagreement is recorded, rather than kept because it was once read

### Requirement: A kept reading names the account it was read from
A reading kept across restarts SHALL be stored under a fingerprint of the
credential it was read with, derived so that the credential cannot be recovered
from it, and SHALL be used only when the desk starts against a credential with
the same fingerprint.

The credential itself SHALL NOT be written to the store, to the desk's record, or
to any log.

#### Scenario: The desk restarts against the same account
- **WHEN** the fingerprint of the running credential matches the stored one
- **THEN** the kept reading is loaded and only the span since it ends is read

#### Scenario: The desk starts against another account
- **WHEN** the fingerprints differ
- **THEN** the kept reading is discarded and the window is read from nothing

#### Scenario: The store is read by anyone
- **WHEN** the stored file is inspected
- **THEN** it contains no API key and no secret, in whole or in part

### Requirement: A closed position is proven per leg and coverage window
Durable fill-acquisition coverage SHALL describe the contract window actually enumerated by `/userTrades`. The renderer SHALL project that proof to every same-generation position key named by retained fills or the authoritative position snapshot, including a current key with no retained fills, and SHALL preserve its retention, page-limit, and continuity state. Each position key SHALL additionally carry whether a flat boundary was proven and whether the current terminal exposure agrees with the account snapshot.

The authoritative snapshot SHALL contain at most one valid exact-quantity row for each canonical `{symbol, leg}` key. A duplicate key or present malformed quantity SHALL invalidate terminal reconciliation for that key rather than using input order, last-write-wins, or absence-as-zero semantics.

A full response at the exchange page limit SHALL be treated as potentially truncated. The system SHALL read older bounded fill windows only for keys that need a boundary, stopping when it proves flat or reaches an explicit retention or request bound. A flat-boundary early stop SHALL require reverse reconciliation from an authoritative current position snapshot belonging to the same Futures activation through a fully enumerated contiguous newest suffix. Every canonical position key encountered for the contract SHALL reach exact zero at the same slice boundary; absence from a current complete snapshot MAY state terminal zero, but a stale/loading snapshot, malformed quantity, mixed position topology, or stream/topology activity during the read SHALL NOT. A zero observed by forward-folding an unknown left edge SHALL NOT qualify. If proof cannot be obtained, the fixed bounded target SHALL remain unchanged, the result SHALL stay unresolved, and page-limit, retention, cancellation, or race evidence SHALL state why.

A successful reverse-flat early stop SHALL retain the original frozen target and SHALL NOT claim that the unenumerated older portion is complete. It SHALL publish the enumerated suffix with its explicit flat boundary, cease only the now-unnecessary older continuation, and remain vouched only while the same authenticated stream proof is current.

Each canonical fill SHALL preserve the settlement asset reported by Binance. A resolved round SHALL have one consistent settlement asset across all contributing fills. Missing or conflicting settlement-asset evidence SHALL keep the affected round unresolved, and the application SHALL NOT infer the asset from a symbol suffix or commission asset. Persisted fills that predate settlement-asset evidence SHALL trigger bounded reacquisition rather than being accepted through their old cursor.

The persistent contract cache SHALL retain at most the declared contract bound for the currently authenticated fingerprint across the entire IndexedDB store. Records without that fingerprint, including legacy symbol-keyed records and records from a previous credential fingerprint, SHALL be removed when the active account is persisted. Reads SHALL remain account-isolated, and removing obsolete namespaces SHALL NOT reduce the active account's own per-contract or contract-count bounds.

Each composite persistent-history update SHALL read the latest stored contracts, merge endpoint-specific evidence, apply global pruning, and write the resulting changes within one IndexedDB read/write transaction. Concurrent renderer or store instances SHALL therefore serialize at the database transaction boundary rather than overwriting evidence from an earlier read. A failed transaction SHALL expose none of its deletes or writes, and each opened database connection SHALL be closed after its transaction completes, aborts, or fails. Injected non-IndexedDB adapters MAY retain the legacy read/write/remove contract for deterministic tests and alternate persistence.

Reported-PnL consistency checks SHALL use exact decimal values and contract precision. A percentage of notional SHALL NOT be treated as rounding tolerance, and a zero-realized fill SHALL NOT by itself prove whether it opened or closed exposure.

Exchange decimal fields SHALL be bounded before regular-expression and `BigInt` work. A scientific-notation JavaScript number SHALL NOT be rounded into an apparently exact fixed-scale fill; unsupported numeric evidence SHALL leave the affected fill/round unresolved.

The REST trade boundary SHALL preserve missing realized-PnL, commission, quantity, price, time, and settlement-asset evidence as missing. It SHALL NOT manufacture a numeric zero or epoch timestamp for an absent exchange field. Before a `/userTrades` response can advance coverage, a cursor, renderer state, or persistent history, every row SHALL have bounded canonical symbol, trade/order identities, side, position side, positive fixed-decimal price and quantity, fixed-decimal realized PnL, non-negative fixed-decimal commission, safe time, and settlement asset. Commission asset MAY be absent only when commission is exactly zero. Missing, oversized, scientific, wrong-type, foreign-contract, or otherwise non-canonical essential evidence SHALL reject the whole page transactionally. Malformed evidence retained from an older schema or another bounded source MAY remain visible as unresolved evidence, but it SHALL NOT make a Closed Positions NET exact.

Optional `/userTrades` request time bounds SHALL distinguish absence from invalid evidence. Undefined, null, or blank optional bounds SHALL be omitted from the query; a present non-integer, negative, unsafe, oversized, or inverted bound SHALL be rejected before any request is sent. A bounded window whose contract is known SHALL reject a response row for another contract before mutating acquired rows or coverage.

The same dependency-free canonical trade validator SHALL govern endpoint admission, bounded-window admission, and v2 persistent-history restore. A restored row with malformed essential evidence MAY remain visible for audit and unresolved-round diagnosis, but it SHALL clear that contract's trade cursor and coverage proof so the old record cannot vouch for exact NET or suppress bounded reacquisition.

A bounded trade-history page SHALL advance contiguous coverage only when its row count is no greater than the admitted page size and every returned row has a reliable trade identity, a valid in-window timestamp, and immutable evidence consistent with any repeated copy of that identity in the same acquisition. An oversized answer SHALL fail with `OVERSIZED_TRADE_PAGE` before row iteration or candidate-map mutation. Invalid rows or conflicting duplicate payloads SHALL fail the pass without committing partial coverage.

Injected trade-window limits MAY reduce the production page size or request allowance for a narrower caller or deterministic test, but SHALL be clamped to at least one and no greater than the declared `FUTURES_TRADE_HISTORY_WINDOW` ceilings. Caller-supplied limits SHALL NOT expand the production memory or request budget.

An unreadable retained fill SHALL be a continuity barrier for its canonical position key. It SHALL NOT be omitted while another round at or after that evidence is promoted to exact. A valid canonical copy with the same reliable trade identity MAY replace an incomplete projection; if the unreadable fill has no provable position key, the supplied batch SHALL remain unresolved because its ownership cannot be established.

Repeated canonical copies of one reliable trade identity SHALL merge only when all evidence present in both copies agrees. Missing optional evidence MAY be enriched by a compatible copy. Conflicting present topology, money, or asset evidence SHALL be a continuity barrier and SHALL NOT be resolved by input order or last-write-wins replacement.

The bounded persistent-history cache SHALL deduplicate equivalent copies of one reliable trade identity but SHALL preserve distinct payload variants for that identity. Its physical trade-row bound SHALL count those retained variants, while its forward cursor SHALL remain the highest reliable exchange identity. Restoring or rewriting the cache SHALL NOT erase a previously observed identity conflict or make its outcome depend on arrival order.

When restored rows contain distinct canonical variants for one reliable contract/trade identity, the rows SHALL remain available as unresolved audit evidence but the restored trade cursor and acquisition coverage SHALL be cleared. The next authenticated basis acquisition SHALL therefore use bounded replacement rather than trusting the conflicted seam or paging only beyond it.

Exact decimal evidence parsed by the fold SHALL remain exact for terminal reconciliation even when a derived JavaScript presentation number would use exponent notation. Rejecting scientific notation at the raw exchange boundary SHALL NOT make an already parsed bounded ratio unreconciled.

Commission-asset evidence SHALL be normalized once at the canonical fill boundary. Commission completeness, exact fee ownership, and subtraction from settlement-asset NET SHALL use that same canonical asset; whitespace or case differences SHALL NOT create a second phantom asset or omit a settlement fee.

#### Scenario: Latest page contains exactly the limit
- **WHEN** the newest account-trade response contains 1000 fills for a contract and no flat boundary is present
- **THEN** the key is marked potentially truncated and older fills are requested within the bound before any exact round is shown

#### Scenario: A trade-history window omits a time bound
- **WHEN** a bounded account-trade read receives a null, blank, non-integer, or inverted start/end time
- **THEN** the read is rejected rather than coercing the missing edge to the Unix epoch

#### Scenario: A fill carries unsafe decimal evidence
- **WHEN** a quantity, price, realized PnL, or commission has an oversized decimal representation or arrives as a scientific number requiring lossy rounding
- **THEN** the parser performs no unbounded integer expansion and the affected fill/round cannot be reported as exact

#### Scenario: A REST fill omits a monetary field
- **WHEN** a user-trade response omits realized PnL, commission, price, quantity, time, or settlement asset
- **THEN** normalization preserves the absence for diagnosis, but the response page is rejected before it advances coverage, cursor state, or persistent history instead of substituting zero or the Unix epoch

#### Scenario: Optional account-trade bounds are omitted or malformed
- **WHEN** an optional `/userTrades` start/end bound is undefined, null, or blank, or is present but non-integer, negative, unsafe, oversized, or inverted
- **THEN** absent bounds are omitted from the request while malformed present bounds reject the request before transport, and neither case becomes an epoch query

#### Scenario: A user-trade row is not bounded canonical evidence
- **WHEN** one response row has an oversized field, a scientific or wrong-type decimal, a non-positive price or quantity, a negative commission, a missing required asset, an invalid side or position side, or a non-exact identity/time
- **THEN** the whole response is rejected before any row, cursor, complete coverage, or persistent record is committed

#### Scenario: A user-trade response names another contract
- **WHEN** a bounded BTCUSDT trade read receives a canonical ETHUSDT row
- **THEN** the page is rejected transactionally and cannot prove BTCUSDT empty or complete

#### Scenario: A persisted v2 trade is no longer canonical
- **WHEN** a restored contract contains a trade with settlement asset but malformed identity, topology, money, or time evidence
- **THEN** the row remains available as unresolved audit evidence while its restored trade cursor and coverage are cleared for bounded reacquisition

#### Scenario: A trade-history page contains invalid or conflicting identity evidence
- **WHEN** a bounded user-trade response contains an unnamed trade, an out-of-window timestamp, or two different payloads for one reliable trade identity
- **THEN** the acquisition does not advance contiguous coverage or publish a newly exact Closed Positions NET from that page

#### Scenario: A trade-history answer exceeds its admitted page size
- **WHEN** a `/userTrades` answer contains more rows than the page size admitted for that bounded read
- **THEN** the reader rejects it atomically with `OVERSIZED_TRADE_PAGE` before iterating or retaining rows, and coverage/checkpoint state does not advance

#### Scenario: A caller injects larger trade-window limits
- **WHEN** a caller supplies `PAGE_SIZE` or `MAX_REQUESTS` above the declared production ceilings
- **THEN** the reader clamps them to the production ceilings, while smaller positive injected limits may still narrow deterministic work

#### Scenario: A retained malformed fill sits inside one position key
- **WHEN** a retained fill has a reliable position key but an unreadable price, quantity, side, or time and no valid canonical copy replaces it
- **THEN** that key's subsequent fold remains unresolved and no exact Closed Positions NET is calculated around the omitted execution

#### Scenario: Repeated canonical trade identity conflicts
- **WHEN** two retained copies of one reliable symbol and trade ID report different present quantity, price, side, time, realized PnL, commission, position leg, or asset evidence
- **THEN** the position key remains unresolved instead of choosing whichever copy happened to arrive last

#### Scenario: A conflicting trade identity crosses a renderer restart
- **WHEN** two distinct bounded payloads for one reliable symbol and trade ID are persisted, restored, and folded after a renderer restart
- **THEN** both variants remain available as order-invariant conflict evidence, the cache remains within its physical row bound, and Closed Positions cannot publish an exact NET from either variant

#### Scenario: Restored conflict cannot vouch a forward cursor
- **WHEN** a v2 contract cache restores individually canonical but conflicting variants of one reliable trade identity beside previously complete coverage
- **THEN** both rows remain visible, but the restored trade cursor and coverage are null so the authenticated bounded replacement path can heal the contract

#### Scenario: An incomplete duplicate contradicts its valid copy
- **WHEN** one retained copy of a reliable symbol and trade ID is incomplete but another field still present on it conflicts with a valid canonical copy
- **THEN** the valid copy does not erase the contradiction and the affected position key remains unresolved until clean canonical reacquisition replaces both inputs

#### Scenario: A malformed duplicate money field is not sparse evidence
- **WHEN** one otherwise canonical copy of a reliable symbol and trade ID carries a present but malformed realized-PnL, commission, commission-asset, or settlement-asset value while another copy carries a valid value
- **THEN** the malformed value is retained as a continuity conflict and the affected Closed Positions NET remains qualified instead of borrowing the valid copy's money or asset

#### Scenario: A malformed asset reaches the round fold directly
- **WHEN** retained, streamed, injected, or future fill evidence carries an empty, oversized, wrong-type, or non-canonical settlement or commission asset despite optimistic complete coverage metadata
- **THEN** the round fold rejects that asset as money evidence and cannot emit a resolved Closed Positions NET or exact fee bucket denominated in it

#### Scenario: A small exact entry is rendered with an exponent
- **WHEN** bounded string fill evidence derives an exact terminal entry such as `0.0000001` and JavaScript presents its numeric view as `1e-7`
- **THEN** terminal reconciliation compares the bounded derived decimal and does not report a snapshot mismatch solely because of exponent notation

#### Scenario: Commission asset needs canonical casing and whitespace
- **WHEN** a valid fill reports the settlement commission asset with surrounding whitespace or non-canonical case
- **THEN** coverage and fee allocation use one trimmed uppercase asset and exact settlement NET subtracts the commission once

#### Scenario: Backfill reaches flat
- **WHEN** progressive older windows reach a fill after which the position key is known flat
- **THEN** the subsequent fills are folded as resolved rounds without reading older history

#### Scenario: Backfill reaches retention without flat
- **WHEN** the available retention ends before a flat boundary is proven
- **THEN** the affected sequence remains unresolved and no exact wallet result is claimed

#### Scenario: Retention ends before a current leg has a retained fill
- **WHEN** contract acquisition is retention-limited and the authoritative snapshot names an open position key for which no retained fill can be folded
- **THEN** that key remains unresolved with the contract's retention-limited coverage and no exact fill-owned PnL or commission is emitted

#### Scenario: A forward fold happens to return to zero
- **WHEN** fills return a leg to zero while the sequence before the oldest covered fill is still unknown
- **THEN** that zero does not stop older acquisition unless same-generation reverse terminal reconciliation proves it at a fully enumerated slice boundary

#### Scenario: Reverse-flat proof races account activity
- **WHEN** the authoritative position snapshot is stale/loading or a fill, reconnect, activation change, or stream-topology change occurs while a candidate newest suffix is being enumerated
- **THEN** the candidate flat boundary is rejected, older work remains tied to the original fixed target and bounded checkpoint, and no early-stopped coverage is promoted to exact

#### Scenario: One contract contains more than one position key
- **WHEN** the contiguous suffix contains `LONG`, `SHORT`, or `BOTH` evidence for more than one canonical position key
- **THEN** older acquisition stops only when reverse reconciliation proves every encountered key exactly flat at the same enumerated boundary

#### Scenario: A reverse-flat proof stops before the frozen target edge
- **WHEN** a current same-activation snapshot and contiguous suffix prove every contract key flat above the original target start
- **THEN** the suffix records its flat boundary and stops older continuation without claiming the unenumerated part of the frozen target is complete

#### Scenario: A break-even close starts the visible window
- **WHEN** the first visible fill realizes zero while closing exposure opened before the window
- **THEN** it is not presented as an opposite opening merely because its realized PnL is zero

#### Scenario: Ordinary PnL differs by less than one percent of notional
- **WHEN** a possible reversal's reported PnL differs from the tentative round by an amount larger than contract precision but smaller than one percent of notional
- **THEN** the difference is not dismissed as rounding and the tentative reversal is not accepted on that basis

#### Scenario: Reconstructed exposure disagrees with snapshot
- **WHEN** a supposedly complete round set implies a different leg, signed quantity, or entry basis from the current account position
- **THEN** that key becomes unresolved and the stale persisted round is not attached to the current position

#### Scenario: The authoritative snapshot duplicates a position key
- **WHEN** two snapshot rows normalize to the same `{symbol, leg}` key, whether their quantities agree or conflict
- **THEN** that key cannot terminal-reconcile or prove a reverse-flat boundary, and permuting the duplicate rows does not change the unresolved outcome

#### Scenario: A round settles in USDC
- **WHEN** every fill of a resolved round reports `marginAsset=USDC`
- **THEN** the round's realized PnL and settlement-denominated fee are identified as USDC and are never labelled USDT

#### Scenario: Settlement-asset evidence conflicts
- **WHEN** contributing fills omit `marginAsset` or report different settlement assets for one tentative round
- **THEN** the round remains unresolved and no exact settlement-asset total is emitted

#### Scenario: Stored fills predate margin asset
- **WHEN** a restored contract has fills or coverage that cannot prove their settlement asset
- **THEN** its old cursor is not treated as proof and a bounded frozen-window reacquisition begins

#### Scenario: Persistent history crosses a credential migration
- **WHEN** IndexedDB contains legacy symbol-keyed records or records for an earlier account fingerprint and the current authenticated account writes its history
- **THEN** obsolete namespaces are removed, no more than the current account's declared contract bound remains, and no cross-account row is restored

#### Scenario: Two store instances persist complementary evidence concurrently
- **WHEN** separate renderer or store instances concurrently persist order-only and trade-only evidence for the same authenticated contract
- **THEN** their IndexedDB transactions serialize, the later update merges from the latest committed record, and the final bounded record contains both evidence sets

#### Scenario: A persistent-history transaction fails
- **WHEN** a composite update aborts or one of its delete or put requests fails
- **THEN** no partial prune or evidence update becomes visible and the database connection is closed after failure handling

### Requirement: Current position settlement does not depend on opening History
For every currently open position key, the desk SHALL acquire and maintain the minimum fill basis needed to state its realized PnL and commission since opening. Persisted fills SHALL be reused, new execution reports SHALL be folded idempotently, and any detected gap SHALL schedule one coalesced targeted read. Opening an order-history or Closed Positions view SHALL NOT be required to update current position settlement.

Shared income-backed traded-symbol discovery SHALL publish monotonically across concurrent renderer sessions. A discovery issued earlier SHALL NOT replace a cache candidate committed by a later-issued successful request, and clearing the active account history SHALL fence all discovery work issued before that reset. This publication ordering SHALL NOT weaken renderer activation, session-disposal, or account-fingerprint admission.

Each renderer's acquisition checkpoints SHALL be retained only while another bounded continuation is eligible. Reaching the declared failure or post-gap retry bound SHALL remove the checkpoint and arm no automatic retry while preserving the final additive/incomplete response. A later explicit request MAY start a fresh checkpoint for its current target.

The renderer SHALL recompute the bounded fill-to-round index only when canonical fills, their coverage generation, or the position fields used for terminal reconciliation (`symbol`, leg, signed quantity, entry basis) change. Mark price, unrealized PnL, margin, and other account-snapshot metadata SHALL NOT repeat the fill fold.

A frozen Full/cold acquisition SHALL consume no more than 16 successful `/userTrades` pages across all of its passes. Each continuation SHALL receive only the checkpoint's remaining page allowance. Exhausting that allowance without proving the frozen window SHALL mark the evidence retention-limited and incomplete, remove the checkpoint, and schedule no further automatic request.

#### Scenario: Fresh profile starts with an open position
- **WHEN** the app starts without held fills and the account reports an open position
- **THEN** a targeted basis read begins for that position key without the operator opening History

#### Scenario: A partial close executes
- **WHEN** an execution report partially closes an open position
- **THEN** its realized PnL and gross commission update once without a history-tab action

#### Scenario: Only order history changes
- **WHEN** an accepted history response updates orders, discovery clocks, or other non-trade metadata without changing canonical fills or their coverage
- **THEN** the held order review updates while retaining the untouched fill/folded collections and without rebuilding the fill-to-round index or Closed wallet reconciliation

#### Scenario: Persisted fills are restored before another exchange event
- **WHEN** a v2 history snapshot with canonical fills is restored into an otherwise empty renderer session
- **THEN** restore advances the trade-evidence revision and Closed rounds plus wallet reconciliation are rebuilt immediately without waiting for a later REST response or stream fill

#### Scenario: A streamed fill names its margin asset
- **WHEN** an authenticated execution report carries `ma` or `marginAsset` for an actual fill
- **THEN** the held canonical fill preserves that settlement asset instead of downgrading the fill and requiring REST to recover the same field

#### Scenario: Execution delivery has a gap
- **WHEN** execution identity shows that one or more fills were missed
- **THEN** one coalesced targeted gap read reconciles the key and duplicate stream/REST fills do not double count

#### Scenario: A stream-only fill falls inside an older covered timestamp
- **WHEN** a held stream fill has not yet been absorbed by REST but its timestamp is no later than the contract window's previously proven right edge
- **THEN** only that position key's proven right edge is capped before the fill, older resolved rounds remain visible, and no round touching the unconfirmed suffix becomes exact

#### Scenario: An order lifecycle event carries no fill
- **WHEN** the user stream reports `NEW`, cancellation, expiry, or another execution report without a traded quantity or trade identity
- **THEN** the event updates working-order state without invalidating proven fill-history coverage or scheduling a trade-history repair

#### Scenario: Stream reconnects during a frozen history read
- **WHEN** stream topology or activity changes while a frozen window or its forward gap is being acquired
- **THEN** the result remains additive and incomplete until a bounded REST continuation reaches every stream-observed fill identity

#### Scenario: Two renderers request history
- **WHEN** two renderer connections have independent Futures activations and one switches market or closes during a repair
- **THEN** its session is discarded without cancelling, stealing, or receiving the other renderer's repair

#### Scenario: Concurrent discoveries answer out of order
- **WHEN** an older renderer discovery answers after a later-issued discovery has already committed a different successful cache candidate
- **THEN** each renderer may receive its own valid response, but reconnect and rotation reads retain the later candidate and never regress to the older cache

#### Scenario: A discovery predates account-history reset
- **WHEN** shared history state is cleared while an earlier discovery request is still in flight
- **THEN** that request cannot restore the retired discovery cache even if its transport later succeeds

#### Scenario: Acquisition exhausts its retry budget
- **WHEN** a cold, Full, basis-gap, or post-gap acquisition uses its final allowed attempt without becoming complete
- **THEN** its final response remains additive/incomplete, its checkpoint and pending retry are removed, and no further automatic read is scheduled

#### Scenario: Operator retries after terminal acquisition
- **WHEN** a later explicit history request follows an exhausted acquisition
- **THEN** it starts with a new current target and a fresh bounded retry budget rather than resuming the terminal checkpoint

#### Scenario: Account refresh changes only valuation metadata
- **WHEN** a periodic account snapshot keeps every position's symbol, leg, signed quantity, and entry basis unchanged while mark, unrealized PnL, or margin fields change
- **THEN** live position presentation updates without recomputing the held fill-to-round index

#### Scenario: Dense frozen history exhausts its cumulative page allowance
- **WHEN** repeated full trade pages require more than 16 `/userTrades` requests across a Full or cold reacquisition and its continuations
- **THEN** no seventeenth page is requested for that checkpoint, coverage remains incomplete and retention-limited, the checkpoint is removed, and no automatic continuation remains armed

#### Scenario: Old and current positions reuse a symbol
- **WHEN** a persisted open round belongs to an older position but the current snapshot has a different leg, quantity, or entry basis
- **THEN** the old round is not used as the settlement start for the current position

#### Scenario: Closed review changes while an older local window is open
- **WHEN** new closed rounds prepend or the held round set shrinks while the operator is reading an older local window
- **THEN** the window preserves its first surviving round identity and clamps a removed anchor instead of silently drifting to different rows or reviving a stale offset later

#### Scenario: A previously read history view becomes unread
- **WHEN** account rotation or history reset clears the selected view's read identity while its tab remains open
- **THEN** the previous successful request does not suppress one new bounded read for the current account state

### Requirement: Every Futures wallet flow has one additive owner
Each canonical realized-PnL, fill-commission, funding, insurance-clear, or underivable commission-credit entry SHALL contribute to at most one additive owner. Fill-derived realized PnL and gross commission SHALL belong to the position leg and round named by the fill. An income entry with a reliable trade identity SHALL belong to the matching fill/round. Funding, insurance, or credit that cannot be reliably attributed to one leg/round SHALL remain in one contract-level or account-level shared bucket and SHALL NOT be copied into multiple row totals. Membership in an open or closed presentation scope SHALL require fill or interval evidence; symbol or leg equality alone SHALL NOT assign a shared entry to an arbitrary open or closed round.

Timestamp interval ownership SHALL require a canonical symbol and SHALL first restrict candidates to that contract and optional leg. Reconciliation SHALL build and reuse a bounded interval index rather than scanning every account round for every income entry, while preserving all overlapping candidates, inclusive boundary ties, open-ended live intervals, and input-order independence.

Wallet reconciliation SHALL admit interval timestamps only as non-negative safe integers or digit-only strings that parse exactly into that domain, and multiple aliases supplied for one coverage boundary SHALL agree. Symbols SHALL match the canonical Futures trade-evidence symbol domain, assets SHALL match its asset domain, and position legs SHALL be only `BOTH`, `LONG`, or `SHORT`. Malformed, contradictory, or non-canonical temporal/identity evidence SHALL fail closed and SHALL NOT prove ownership, denomination, or exact wallet Net.

#### Scenario: Funding lands on a boundary between sequential rounds
- **WHEN** one funding entry shares the close/open timestamp of two sequential one-way rounds
- **THEN** it contributes once to a deterministic owner or one shared contract bucket, never to both round totals

#### Scenario: Both hedge legs overlap funding
- **WHEN** LONG and SHORT are simultaneously open for a contract when one funding entry occurs and the entry names no leg
- **THEN** the entry remains contract-shared and is not included in full in either leg-owned total

#### Scenario: A rebate names a trade
- **WHEN** an underivable commission credit carries a reliable trade identity matching one round
- **THEN** its signed amount is included once in that round's commission adjustment

#### Scenario: A rebate cannot be attributed
- **WHEN** an underivable commission credit lacks a reliable leg/round identity
- **THEN** it remains visible in a shared bucket rather than being discarded or guessed

#### Scenario: A rebate is posted after its possible round closed
- **WHEN** a symbol-scoped commission credit has no trade identity and its posting timestamp lies after every compatible round interval
- **THEN** it remains one global shared amount, every compatible round is qualified instead of claiming exact wallet Net, and the amount is not discarded from the Closed/account reconciliation

#### Scenario: A delayed rebate timestamp enters the next round
- **WHEN** a commission credit has no reliable fill owner and its posting timestamp overlaps a newer open round after a compatible round closed
- **THEN** timestamp alone does not assign it to the newer round, both compatible scopes remain qualified, and the canonical credit stays one shared amount

#### Scenario: A round opens after an unattributed credit
- **WHEN** a compatible contract round opens strictly after a commission credit with no reliable fill owner was posted
- **THEN** causality excludes that future round from the credit's affected set and the earlier credit does not remove its exact wallet Net

#### Scenario: A rebate names a reversal fill
- **WHEN** a reliable trade identity names one reversal fill that closes one round and opens another
- **THEN** the credit remains shared across the complete fill-owner set, contributes to the ledger once, is rendered in one deterministic presentation scope, and neither affected round claims an exact wallet Net from posting-time ownership

#### Scenario: A contract adjustment matches no round interval
- **WHEN** a canonical contract or leg adjustment lies outside every known round interval and has no reliable fill owner
- **THEN** it remains once in the global shared ledger and audit, and neither open nor closed scope claims it merely because a round has the same symbol or leg

#### Scenario: Position-scoped income has no contract identity
- **WHEN** malformed funding or insurance evidence reaches reconciliation without a canonical symbol
- **THEN** timestamp overlap does not assign it to any round, it remains account-shared and qualified, and no contract row claims exact Net from it

#### Scenario: A busy account reconciles many intervals
- **WHEN** the ledger contains many rounds and many income rows across one or more contracts
- **THEN** ownership candidates come from the reusable symbol/leg interval index without a full account-round scan per income row and all genuine overlaps remain represented

#### Scenario: Many unattributed credits affect a long contract history
- **WHEN** many no-fill-owner credits can qualify many earlier rounds of one contract
- **THEN** reconciliation stores compact causal affected scopes and evaluates them in one round pass rather than materializing or scanning the credit-by-round Cartesian product

#### Scenario: Shared income matches unresolved closed intervals
- **WHEN** one shared adjustment falls inside overlapping closed round intervals that remain partial or unresolved
- **THEN** the qualified Closed shared scope includes it once using those interval matches, even though no exact round owner can be selected

#### Scenario: The same income row is read twice
- **WHEN** stream, tail read, and verification deliver the same canonical income identity
- **THEN** the ledger and every aggregate include it once

#### Scenario: Canonical income has only a content-derived fallback identity
- **WHEN** an income row has no reliable exchange transaction identity and its canonical key is derived from amount, asset, time, scope, and optional trade fields
- **THEN** the key MAY deduplicate identical delivery, but remains identity-unreliable and cannot promote an affected round to exact wallet Net

#### Scenario: Conflicting income payloads reuse one reliable identity
- **WHEN** two different income payloads carry the same reliable canonical identity and their attribution evidence can affect different round scopes
- **THEN** the audit records an identity conflict, retains the identity once, and every round scope reachable from either payload remains qualified without an exact wallet Net

#### Scenario: Conflicting identity delivery order reverses
- **WHEN** the same contradictory reliable-identity payloads arrive in opposite orders
- **THEN** canonical and visible per-asset money plus conflict audit remain identical and delivery order cannot select the displayed amount

#### Scenario: A reliable identity conflict selects one shared representative
- **WHEN** contradictory payloads with one reliable canonical identity resolve to a deterministic representative in a contract-shared or account-shared bucket
- **THEN** the bucket remains non-additive, exposes a deterministic `IDENTITY_CONFLICT` qualification, and the selected amount is not represented as ordinary Shared money

#### Scenario: A conflicting payload is delivered repeatedly
- **WHEN** one canonical identity receives distinct payloads `A` and `B` and any delivery path repeats either complete payload signature
- **THEN** reconciliation retains each distinct signature once, emits one stable conflict record for the identity, and permutations such as `[A, B, B]` and `[B, B, A]` produce the same conflict audit and affected scope

#### Scenario: A monetary payload exceeds the exact-decimal safety bound
- **WHEN** a round or income amount contains an exponent, scale, or coefficient too large for the bounded canonical decimal domain
- **THEN** the value is rejected without unbounded integer expansion and every potentially affected result remains qualified rather than presenting an exact wallet Net

#### Scenario: Temporal evidence is absent or inverted
- **WHEN** a round boundary or income timestamp is null, blank, non-finite, or a close precedes its open
- **THEN** it is not coerced to the Unix epoch and cannot prove interval ownership or complete wallet Net

#### Scenario: Temporal evidence is outside the canonical integer domain
- **WHEN** a round boundary or income timestamp is fractional, negative, outside JavaScript's safe-integer range, or a non-digit numeric string
- **THEN** it is rejected while an equivalent non-negative safe integer or digit-only string remains admissible

#### Scenario: Coverage aliases contradict one another
- **WHEN** one optimistic coverage record supplies different canonical times for two aliases of the same boundary
- **THEN** the coverage is partial and cannot promote the affected interval to exact wallet Net

#### Scenario: Wallet scope identity is outside the canonical evidence domain
- **WHEN** a round or income row supplies a punctuated/oversized symbol, a punctuated/oversized asset, or a leg outside `BOTH`, `LONG`, and `SHORT`
- **THEN** that field is rejected and cannot prove contract, asset, or leg ownership even when optimistic coverage metadata accompanies it

### Requirement: Wallet Net states component completeness
A per-position or per-round value SHALL be called wallet Net only when its trade, gross commission, and relevant income coverage are each complete for the stated interval and asset. Otherwise the surface SHALL report a qualified visible net or unknown result and SHALL identify the missing components. In Closed Positions that outcome and its qualification SHALL remain detail on the same single `PnL` element or in one shared-adjustment group, not a second money column. A non-USDT component SHALL remain denominated in its own asset and SHALL NOT be silently included in a USDT total.

Validated settled-income frames with the same account fingerprint, content generation, and digest SHALL reuse the existing canonical wallet reconciliation when only observation clocks advance. A resource metadata update SHALL remain observable, but it SHALL NOT repeat exact-decimal parsing, ownership folding, or round remapping for byte-equivalent money. A changed generation/digest or legacy resource identity SHALL still invalidate the fold.

Position-snapshot cache identity SHALL be independent of exchange array order. It SHALL be derived from a canonical sorted sequence of semantic `{symbol, leg, quantity, entryPrice}` tuples, so an otherwise identical permutation preserves the trade-round index and wallet reconciliation identity while a tuple value change invalidates them.

Round-owned realized PnL SHALL use the consistent settlement asset proven by that round's fills. A commission without its own asset MAY fall back only to that proven round asset. An income entry without its own settlement asset SHALL be rejected as malformed evidence and SHALL NOT inherit an account-wide default or the matched round's asset. An account-wide default, contract suffix, or another component's asset SHALL NOT override missing/conflicting round evidence.

#### Scenario: Opening commission is outside the fill window
- **WHEN** a closed round has a visible closing commission but its opening fill/commission is not covered
- **THEN** the row does not call the partial result the amount that reached the wallet and identifies trade/commission coverage as incomplete

#### Scenario: Income coverage stops before close
- **WHEN** a round closes after the newest fully covered income instant
- **THEN** its income component and wallet Net remain incomplete

#### Scenario: All components are covered
- **WHEN** trade, gross commission, and relevant income cover the entire resolved round in one asset
- **THEN** the row may state an exact wallet Net equal to those signed components

#### Scenario: Commission is paid in BNB
- **WHEN** a round has a BNB commission component and USDT realized PnL
- **THEN** USDT Net excludes the BNB amount and the BNB amount remains explicitly visible in its own denomination

#### Scenario: The sole non-zero exact result is an auxiliary asset
- **WHEN** complete canonical ownership contains zero settlement-asset movement and one non-zero auxiliary-asset total
- **THEN** that ledger total remains the round's exact single-asset Wallet Net even though its asset differs from the round settlement asset

#### Scenario: A USDC round reaches the wallet
- **WHEN** one proven USDC round realizes `+10 USDC`, pays `-1 USDC` commission, and has `-2 USDC` funding with complete coverage
- **THEN** its exact wallet Net is `+7 USDC` and no fictitious USDT component is created

#### Scenario: A round has no proven settlement asset
- **WHEN** realized PnL belongs to a round whose fills omit or conflict on settlement asset
- **THEN** the realized component is not assigned to a guessed asset and the row cannot claim exact wallet Net

#### Scenario: An income entry has no settlement asset
- **WHEN** funding, insurance, or a commission credit omits or blanks its asset
- **THEN** the malformed entry is not assigned guessed USDT money, its possible round scope remains qualified, and no affected row claims exact wallet Net

#### Scenario: An auxiliary asset nets exactly to zero
- **WHEN** complete owned BNB commission and BNB credit entries cancel exactly while the settlement-asset component remains non-zero
- **THEN** the underlying BNB entries remain in the canonical ledger and audit, but the result is not qualified `MULTI_ASSET` solely because of the zero BNB balance

#### Scenario: Verification advances only observation clocks
- **WHEN** a valid same-generation/same-digest settled-income frame advances read or success times without changing canonical lane money or state
- **THEN** resource timestamps update while the wallet ledger, enriched round collection, Closed rows, and open settled-money objects retain their prior reconciliation identity

#### Scenario: The maintained probe reconciles a closed round
- **WHEN** the read-only settlement probe receives canonical fills and settled-income rows for a round
- **THEN** it preserves each fill's `marginAsset` and numeric reverse-flat boundary, derives rounds with the production trade-round index, reports the production wallet ledger's owned and shared sums per asset, and does not attach funding or insurance through legacy overlapping-time or open-position arithmetic

#### Scenario: Exchange reorders an unchanged position snapshot
- **WHEN** a position frame contains the same semantic position tuples as the preceding frame in a different array order
- **THEN** the existing trade-round index, wallet reconciliation, Closed rows, and open settled-money identities are reused rather than refolded

### Requirement: Displayed Futures money conserves the canonical ledger
For any selected account scope and covered interval, the sum of leg/round-owned components plus each shared bucket exactly once SHALL equal the canonical ledger for that scope, asset, and interval. The application SHALL test this invariant independently of presentation order, timestamp ties, hedge overlap, and duplicate delivery.

#### Scenario: Two rounds share one contract adjustment
- **WHEN** two resolved rounds and one unallocated contract adjustment are displayed
- **THEN** the two owned results plus the adjustment equal the ledger and summing visible additive figures does not duplicate the adjustment

#### Scenario: Open and closed ownership meet at a boundary
- **WHEN** a position closes and another opens at the same timestamp
- **THEN** every fill and income identity belongs to exactly one owned/shared component across the boundary

#### Scenario: Shared income matches no resolved round
- **WHEN** a canonical contract or leg adjustment interval-matches a partial or unresolved round in the requested open/closed scope but no resolved round can own it
- **THEN** it remains in one qualified shared bucket for that evidence-backed scope and is not omitted from both open and closed scope results

#### Scenario: A delayed global credit is visible once
- **WHEN** a canonical commission credit has no unique fill or interval owner but can affect known rounds of its contract
- **THEN** the account/Closed reconciliation renders that global shared identity once, the audit remains additive, and all compatible rows remain qualified

#### Scenario: One shared identity reaches open and closed rounds
- **WHEN** a funding, insurance, or commission-credit assignment affects at least one open and one closed round
- **THEN** its canonical owner remains singular, its open and closed presentation projections are disjoint, and the audit reports no projected identity twice

### Requirement: Canonical fill quantities are conserved before round exactness
The trade-round index SHALL audit every deduplicated canonical fill against the exact integer quantity atoms assigned to round contributions before those aggregates reach wallet reconciliation. For each canonical fill identity, assigned atoms SHALL equal source atoms exactly, every assignment SHALL name a canonical source, and duplicate delivery SHALL contribute one canonical source quantity independent of input order. The audit SHALL be derived from the canonical fill set rather than from already-aggregated round totals. A missing, unknown, under-allocated, over-allocated, or otherwise invalid assignment SHALL fail the affected position fold closed, retain its rounds as unresolved evidence, and prevent those rounds from claiming exact wallet Net.

#### Scenario: A reversal fill is split across two rounds
- **WHEN** one canonical fill of six quantity atoms closes four atoms of one round and opens two atoms of the next round
- **THEN** the two exact assignments conserve the single canonical fill and both round contributions may remain eligible for exact reconciliation

#### Scenario: A canonical fill is under-allocated or omitted
- **WHEN** a canonical fill's assigned atoms total less than its source atoms, including no assignment at all
- **THEN** the fill-conservation audit fails and every round in the affected position fold remains unresolved without an exact wallet Net

#### Scenario: A canonical fill is over-allocated or unknown
- **WHEN** assigned atoms exceed the matching source quantity or an assignment names no canonical fill
- **THEN** the fill-conservation audit fails closed and reports the affected fill and round identities for diagnosis

#### Scenario: Duplicate fill delivery is order-independent
- **WHEN** REST, bootstrap, and stream copies of one fill arrive in any order
- **THEN** canonicalization contributes one source quantity, assignments conserve against it once, and the audit result is invariant to delivery order

### Requirement: Income pagination does not skip timestamp peers
Each income type SHALL be read over a fixed inclusive `[startTime, endTime]` target window using the exchange page parameter until the window is complete or an explicit cumulative per-target page/request bound is reached. Pagination SHALL NOT advance a millisecond cursor to escape a full page. Response order SHALL be treated as unspecified: rows SHALL be normalized, canonically deduplicated, and sorted after acquisition, while coverage SHALL derive from successfully completed requested pages rather than observed first/last row order.

Each lane SHALL also enforce a cumulative canonical-row ceiling across all continuation passes for one frozen target, not only a per-pass page limit. When another page or the retained union would exceed that ceiling, the lane SHALL preserve no more than the bounded real rows already acquired, clear any unproven completeness/coverage claim, expose an explicit resource-limit error, and remove its continuation checkpoint so the same oversized target is not paged indefinitely.

The walker aggregate failure signal SHALL be true whenever any requested lane refuses a page or reaches its row/page resource ceiling. A resource-limited lane SHALL NOT be diagnosed as an ordinary healthy partial continuation merely because its bounded rows remain useful evidence.

Every answered page SHALL be validated as one response to the requested lane and frozen window before it can advance a checkpoint or coverage. Its `rows` SHALL be an array no larger than the exact requested page limit. The HTTP adapter SHALL reject an over-requested array before mapping/normalizing its rows, and the walker SHALL independently enforce the same bound before iteration. A malformed container, over-requested page, row that cannot be canonicalized, missing settlement asset, foreign income type, out-of-window time, or conflict with an already acquired row carrying the same reliable canonical identity SHALL fail that lane transactionally with a sanitized diagnostic; the last confirmed rows and coverage MAY remain visible, but the invalid page SHALL NOT be treated as silence or exact coverage. Byte-equivalent delivery overlap MAY be deduplicated.

A transport or adapter result of `null` or `undefined` SHALL remain a transient `EMPTY_ANSWER`, preserve confirmed lane evidence, and remain eligible for the declared bounded confirmation retry. An answered value whose `rows` is not an array SHALL instead fail as `INVALID_INCOME_PAGE`; these outcomes SHALL NOT be conflated even though neither can advance coverage.

Caller-injected page, per-pass page, cumulative target-page, retained-row, and tail-overlap limits MAY narrow deterministic work but SHALL NOT exceed their declared production ceilings. Each limit SHALL default independently when omitted or malformed, so a partial injected limits object SHALL NOT disable the page loop, erase overlap through non-finite arithmetic, or widen resource/request budgets.

Endpoint normalization SHALL preserve an omitted, `null`, or blank income timestamp as missing evidence. It SHALL NOT coerce such input to epoch, because a manufactured timestamp can enter a broad frozen target as a genuine settlement row.

#### Scenario: More than one page shares a millisecond
- **WHEN** over 1000 relevant income rows have the same event time within the fixed target window
- **THEN** subsequent page numbers retrieve the remaining peers and no row is skipped by adding one millisecond

#### Scenario: Binance returns descending rows
- **WHEN** a page arrives newest-first instead of oldest-first
- **THEN** the same canonical ledger and coverage are produced as for ascending delivery

#### Scenario: Page budget ends mid-window
- **WHEN** the allowed page count is exhausted before a target window is complete
- **THEN** the lane remains partial with its successful coverage and target stated, rather than being marked complete

#### Scenario: Full duplicate pages repeat forever
- **WHEN** the exchange or a malformed adapter keeps returning limit-sized pages for one frozen target without adding canonical identities
- **THEN** the cumulative per-target page ceiling stops further continuation, retains only previously confirmed coverage, and reports an explicit incomplete resource-limit error

#### Scenario: An answered page contains an invalid row
- **WHEN** one row is malformed, has no settlement asset, belongs to another income type, or falls outside the requested inclusive window
- **THEN** that page fails transactionally and the lane cannot advance its checkpoint, coverage, or exact-completeness claim

#### Scenario: An answered page exceeds its request
- **WHEN** the adapter or injected reader returns more rows than the exact page limit requested
- **THEN** the adapter rejects before row normalization and the walker independently fails the lane before iterating or retaining any over-limit row

#### Scenario: An answered page has no row array
- **WHEN** a transport or adapter returns a non-array `rows` value
- **THEN** it is a failed page and cannot be coerced to terminal empty success or replace retained evidence

#### Scenario: A confirmation receives no transport answer
- **WHEN** a bounded confirmation attempt resolves to `null` or `undefined` rather than an answered page object
- **THEN** the lane reports transient `EMPTY_ANSWER`, retains its confirmed rows and debt, and remains eligible only for the existing bounded retry policy

#### Scenario: A caller injects partial or oversized walker limits
- **WHEN** a deterministic caller omits some lane-walker limits or supplies any value above its production ceiling
- **THEN** omitted limits use independent production defaults, supplied limits can only narrow work, and acquisition remains bounded and live

#### Scenario: Income timestamp is omitted or blank
- **WHEN** the income endpoint returns a row whose timestamp is omitted, `null`, or blank
- **THEN** normalization keeps the timestamp missing and page validation rejects the row instead of attributing it to epoch

#### Scenario: One income identity carries conflicting money
- **WHEN** one page or a later page in the same frozen target repeats a reliable canonical identity with different row content
- **THEN** the lane fails transactionally instead of selecting one amount by response order, while byte-equivalent overlap remains deduplicated

#### Scenario: Cumulative lane row ceiling is reached
- **WHEN** full pages across one or more continuation passes fill the declared per-lane row ceiling before a terminal page proves the target complete
- **THEN** acquired rows remain bounded and visible as partial evidence, the lane reports an explicit resource-limit error with `complete=false`, and no continuation is queued

#### Scenario: A retained-row ceiling ends the pass
- **WHEN** any requested lane terminates with `ROW_LIMIT_REACHED`
- **THEN** the aggregate walk reports a failed outcome for diagnostics while preserving the lane's bounded real rows and incomplete state

#### Scenario: Retention cuts the request
- **WHEN** requested history predates Binance's available retention
- **THEN** the retention edge is stated as an external coverage bound and no older completeness is claimed

### Requirement: Settled-income completeness is maintained per income lane
Funding, insurance clear, and each required underivable commission-credit type SHALL have independent cursor, coverage, freshness, completeness, and failure state. An aggregate SHALL be complete only for the lanes it requires and only where all of those lanes cover the interval. A failure or delayed refresh in one lane SHALL not erase confirmed rows from another lane.

Delayed confirmation SHALL be persisted as per-lane debt with an explicit not-before deadline. A lane carrying that debt SHALL remain stale and incomplete across process restart. A successful endpoint pass that starts before the applicable not-before instant SHALL NOT clear the debt; in an uninterrupted process that instant comes from the exact newest-event marker, while after restore it comes from the persisted deadline. Only a successful pass started at or after that applicable instant MAY clear it. Restoring the resource SHALL restore the stale state and re-arm any remaining confirmation delay.

The durable confirmation deadline SHALL derive only from the rounded event witness plus the confirmation delay. Acquisition `targetTo` MAY advance independently during bootstrap, continuation, manual refresh, or a pre-deadline walk, but that advancement SHALL NOT extend the deadline for already-held debt. Reapplying or restoring the same debt SHALL preserve the event-derived deadline unless a genuinely newer event witness moves it later.

The durable target and deadline MAY be rounded upward to a fixed one-second bucket so executions inside one bucket share one persisted invalidation. The rounded deadline SHALL be no earlier than `newestEventAt + confirmationDelay`; the live in-memory marker and timer SHALL still use the exact newest event and SHALL NOT confirm before that exact delay. The first event covered by a bucket SHALL synchronously persist the conservative debt before publication, so a restart after later same-bucket events cannot restore an earlier confirmation deadline. A lane carrying debt SHALL be `stale` even when it has no retained rows or coverage.

An event already covered by the held durable target, deadline, stale status, and incomplete state SHALL be recognized from those scalar fields before canonical lane construction. Such a same-bucket witness SHALL retain the existing lane reference and SHALL NOT clone, canonicalize, sort, hash, or persist its unchanged retained rows; only a real bucket transition may pay that full-ledger cost.

When an endpoint pass completes after one or more newer invalidations arrived in flight, the commit SHALL reconcile its walked evidence with the current global resource and finalize against the current generation/content, not the resource captured at walk start. Generation SHALL remain monotonic, and two different debt digests SHALL NOT be emitted under the same generation.

If the process restarts after a bounded backward wall-clock step, restore MAY retain a debt lane whose target is ahead of the new clock only when the displacement is no greater than that lane's persisted confirmation interval. The persisted digest SHALL be verified before any clock-relative degradation. Future rows, coverage, continuation work, and observation clocks SHALL NOT be accepted as current evidence: they SHALL be removed, clipped, or cleared while the target, deadline, stale state, and incomplete confirmation obligation remain. A future claim without that bounded debt relationship, including a ready lane, SHALL be rejected atomically.

#### Scenario: Funding is fresh and rebate is stale
- **WHEN** a funding-only tail succeeds while an underivable rebate lane has not yet been confirmed
- **THEN** funding may be shown as current, but a wallet result requiring the rebate lane remains incomplete

#### Scenario: One lane fails verification
- **WHEN** verification succeeds for five required types and fails for one
- **THEN** the five confirmed lanes retain their coverage, the failed lane is stale/error, and the aggregate is not marked fully complete

#### Scenario: All required lanes complete
- **WHEN** every required lane covers the requested interval successfully
- **THEN** their union is eligible to be reported as a complete settled-income reading

#### Scenario: One lane enters terminal cooldown
- **WHEN** one filtered rebate lane receives a terminal response while funding and insurance remain due
- **THEN** automatic reads pause only that rebate lane, funding and insurance continue, and manual/full verification may probe recovery deliberately

#### Scenario: Application restarts before delayed confirmation
- **WHEN** an affected lane is persisted with confirmation debt and the process restarts before its not-before deadline
- **THEN** the restored lane remains stale, its remaining confirmation delay is re-armed, and an earlier bootstrap success cannot claim it complete

#### Scenario: One hundred executions span distinct milliseconds in one bucket
- **WHEN** one hundred fill witnesses arrive at distinct millisecond timestamps covered by one or two adjacent durable buckets
- **THEN** the full settled-income ledger is cloned/canonicalized and synchronously persisted only at the bounded bucket transitions, while same-bucket witnesses reuse the held lane and the in-memory confirmation timer is replaced to run no earlier than two minutes after the exact newest witness

#### Scenario: Process exits after a later event in the same bucket
- **WHEN** the first event persisted an upward-rounded target/deadline and a newer same-bucket event arrives before the process exits
- **THEN** restart restores a deadline no earlier than the newer event's required confirmation time without requiring another full-ledger write for that event

#### Scenario: Walk completes after newer debt generations
- **WHEN** a pass that started from generation 7 completes after event invalidations have advanced the current resource through generations 8 and 9
- **THEN** completion commits against generation 9/current content, preserves the newest debt, and cannot publish generation 8 with a digest different from the already-published generation-8 frame

#### Scenario: Empty lane receives confirmation debt
- **WHEN** a settlement witness invalidates a lane with no retained rows, coverage, or successful observation
- **THEN** the lane is stale and incomplete rather than loading or ready, because the known confirmation obligation itself is stale resource truth

#### Scenario: Clock moves backward across persisted invalidation
- **WHEN** a valid debt snapshot is restored under a wall clock slightly earlier than its event target, with the displacement inside the snapshot's own confirmation interval
- **THEN** the digest is checked first, future rows/coverage/checkpoint/observation evidence is degraded rather than trusted, and the stale incomplete debt plus its target and deadline survive for post-deadline confirmation

#### Scenario: Future ready snapshot has no confirmation debt
- **WHEN** a restored ready lane claims future target, coverage, rows, continuation, or observation evidence without bounded confirmation debt
- **THEN** the persisted resource is rejected rather than treating future evidence as exact settled money

#### Scenario: Post-deadline confirmation succeeds
- **WHEN** a confirmation pass starts at or after the applicable live or restored not-before instant and completes the affected lane successfully
- **THEN** both persisted and in-memory confirmation debt are cleared and the lane may become ready from its proven coverage

#### Scenario: Stream invalidation precedes the first cache read
- **WHEN** a private-stream event arrives before the account-scoped settled resource has been restored
- **THEN** the existing resource is restored before invalidation is persisted, so confirmed rows are not replaced by an empty initial snapshot

#### Scenario: Pre-deadline bootstrap advances the acquisition target
- **WHEN** a restart or bootstrap walk advances a debt lane's `targetTo` before its persisted confirmation deadline
- **THEN** completion and another restart preserve the original event-derived deadline and remaining delay instead of starting a fresh confirmation interval from the newer acquisition target

### Requirement: Settled-income coverage advances only on successful reads
The settled-income resource SHALL distinguish the latest attempt from the last successful reading. Coverage bounds and the last-successful time SHALL advance only for logical pages that completed successfully. A failed initial read SHALL NOT create a ready empty reading; a failed verification SHALL retain the prior rows, bounds, and successful time while exposing the new failure and clearing current completeness.

The resource SHALL carry `coveredFrom`, `coveredTo`, `targetTo`, and completeness for the required income lanes. A consumer SHALL consider an interval covered only when both ends fall within successful contiguous coverage for every component it requires.

A lane whose latest requested enumeration is pending or failed SHALL be incomplete in the published resource even when it retains older successful rows and bounds. Every row time, coverage bound, target, attempt time, and success time SHALL be a non-negative safe integer. Only `ready` status with safe latest-attempt and last-success times and no pending checkpoint MAY be paired with `complete=true`; `idle`, `loading`, `stale`, `error`, or pending state SHALL force current completeness to false. Durable and renderer trust boundaries SHALL reject blank/absent ready timestamps, a latest attempt older than its stated last success, and ready/complete state paired with a pending checkpoint.

#### Scenario: The first page is refused
- **WHEN** Binance refuses or times out before any logical income page succeeds and no cache exists
- **THEN** no ready/complete empty frame is stored or published, and the resource reports a retryable failure

#### Scenario: Verification fails after success
- **WHEN** a verified reading exists and its next verification fails before a page succeeds
- **THEN** the rows, coverage, and last-successful time remain unchanged while the resource becomes stale with the failure and its current completeness becomes false

#### Scenario: A previously complete lane fails
- **WHEN** one lane had complete confirmed coverage and its next requested enumeration fails
- **THEN** its confirmed rows, bounds, and successful time remain available, but its current completeness becomes false and the aggregate cannot claim exact wallet Net

#### Scenario: A previously complete lane starts another read
- **WHEN** one lane retains complete confirmed rows while its next requested enumeration is loading
- **THEN** the retained evidence remains visible, but current completeness is false until the new enumeration succeeds

#### Scenario: Cached coverage is outside retention
- **WHEN** persisted coverage ends before the current retention window begins or has inverted bounds after clamping
- **THEN** the cache is rejected as usable coverage and is not published as current

#### Scenario: Old edge is covered but newest edge is not
- **WHEN** `coveredFrom` precedes a round but `coveredTo` precedes that round's close
- **THEN** the round's income and wallet result remain incomplete

### Requirement: Settled-income publication follows canonical content
Every income entry SHALL preserve exchange identifiers as exact strings at the HTTP boundary, name a non-empty settlement asset, and use one canonical identity/normalization rule in storage, reconciliation, IPC, and renderer folds. Canonicalization SHALL bound identifier, symbol, type, asset, and decimal text before identity construction, exact-number parsing, hashing, persistence, or IPC. Non-empty canonical income types and symbols SHALL already contain only uppercase ASCII letters, digits, and underscores; canonical settlement assets SHALL already contain only uppercase ASCII letters and digits. A malformed, padded, lowercase, or Unicode-case-foldable token SHALL be rejected rather than trimmed or uppercased into a durable identity. A present non-empty optional identifier that is not an exact bounded integer token SHALL reject the row rather than become an absent identifier and fallback identity. Every valid signed amount SHALL be reduced exactly to one plain-decimal representation before content-derived identity and digest construction, including removal of redundant leading/trailing zeroes, an optional plus sign, and negative zero. Resource publication SHALL use a monotonic content generation or digest covering canonical entry identities, signed amounts, assets, times, coverage, and state. A content correction SHALL publish even when row count and bounds are unchanged; an identical frame SHALL not publish again. Durable serialization MAY reuse the authoritative digest already computed for an unchanged canonical resource, but SHALL validate that digest before replacing the stored snapshot.

Persisted or published settled-income failures SHALL expose only a bounded safe machine code and sanitized message. Arbitrary error codes SHALL fall back to `READ_FAILED`; any bounded source message containing an authorization, API-key, signature, secret, or authentication-scheme marker SHALL become a generic credential-redacted diagnostic rather than attempting syntax-specific partial redaction. Main-process logging of the failure SHALL emit only the sanitized machine code.

Content generation and digest SHALL remain unchanged when a successful verification changes only observation timestamps. Publication SHALL nevertheless deliver one frame when a canonical lane's attempt or success time advances. The renderer SHALL accept such a same-generation frame only when its digest agrees with the held frame, all canonical lane content/state is byte-equivalent, and its `readAt` and lane observation times are monotonic; it SHALL reject a same-generation content or digest conflict or a non-newer replay.

Contract-scoped `FUNDING_FEE` and `INSURANCE_CLEAR` entries SHALL name a non-empty canonical symbol. A page containing either type without that contract identity SHALL fail transactionally and SHALL NOT advance lane rows, coverage, successful time, or exact completeness. Account-level commission-credit types MAY omit a symbol and SHALL remain eligible for the account-shared ledger rather than being rejected solely for that omission.

The renderer SHALL admit a v2 resource frame atomically. After canonical case normalization, lane names SHALL be unique and SHALL equal exactly the complete `FUTURES_UNDERIVABLE_INCOME_TYPES` set; an empty, partial, or extra lane set SHALL NOT be authoritative. Every lane row SHALL be individually canonicalizable, belong to that lane, and have an identity not repeated by another row in the same frame. Each lane and any supplied compatibility aggregate list SHALL be bounded by the shared retained-row ceiling before its rows are canonicalized or sorted. Validation SHALL NOT silently drop malformed, duplicate, conflicting, wrong-lane, oversized, omitted-lane, or extra-lane evidence while preserving exact completeness. Accepted aggregate rows, status, coverage, target, attempt/success times, and completeness SHALL be derived from the validated lanes. Main-process publication SHALL carry authoritative rows once under those lanes rather than duplicating the full union at top level, and SHALL reuse its sorted canonical lane-row snapshot when only observation clocks change under the same activation, account fingerprint, generation, and digest. If supplied aggregate rows or metadata disagree with lane authority, the whole candidate frame SHALL be rejected so the prior confirmed renderer state remains authoritative.

#### Scenario: Verification corrects an amount in place
- **WHEN** verification replaces one row's amount while row count and coverage remain unchanged
- **THEN** the resource generation changes and the corrected frame reaches the renderer

#### Scenario: Verification changes one identity in place
- **WHEN** one canonical row is replaced by another while collection size and bounds remain unchanged
- **THEN** the replacement is published and the removed row no longer contributes

#### Scenario: Identical verification repeats
- **WHEN** a frame repeats byte-equivalent canonical content, coverage, state, and observation timestamps
- **THEN** no redundant renderer publication occurs

#### Scenario: Verification confirms unchanged money later
- **WHEN** verification returns byte-equivalent canonical content, coverage, and state after a later successful attempt
- **THEN** content generation and digest stay unchanged, one newer frame updates attempt and success times, and a same-generation digest conflict cannot replace the held resource

#### Scenario: Same-generation frame changes money behind the same digest label
- **WHEN** a candidate claims the held generation and digest but changes any canonical lane row or non-observation state
- **THEN** the renderer rejects it instead of treating the candidate as an observation-only update

#### Scenario: A contradictory resource frame reaches the renderer
- **WHEN** an IPC frame has absent or blank required temporal metadata, or marks a non-ready lane complete
- **THEN** the renderer rejects the invalid time and cannot restore `complete=true` outside the canonical ready state

#### Scenario: Ready lane has no successful observation
- **WHEN** persisted or IPC lane state says `ready` without safe attempt/success times, places the latest attempt before its last success, or carries a pending checkpoint
- **THEN** the whole candidate is rejected and cannot provide complete coverage or exact NET

#### Scenario: A transaction id exceeds safe integer range
- **WHEN** Binance supplies an identifier that cannot be represented exactly as a JavaScript number
- **THEN** its original string identity survives storage, deduplication, and IPC without collision

#### Scenario: One income field exceeds its protocol bound
- **WHEN** an income decimal, identifier, symbol, asset, or type contains an oversized string
- **THEN** canonical validation rejects the row before expanding, hashing, storing, or broadcasting the oversized evidence

#### Scenario: An income token contains non-canonical characters
- **WHEN** an income type, symbol, or settlement asset contains whitespace, punctuation, or another character outside its canonical exchange-token alphabet
- **THEN** canonical validation rejects the row instead of creating a durable identity from the malformed token

#### Scenario: A token can be Unicode-case-folded into ASCII
- **WHEN** a padded, lowercase, long-s, dotless-I, or ligature-bearing token would become apparently canonical after trim or uppercase conversion
- **THEN** adapter, persistence, and renderer boundaries reject its original form and never create money or identity from the converted spelling

#### Scenario: A present optional identifier is malformed
- **WHEN** an income row supplies a non-empty `tranId` or `tradeId` that is not one exact bounded integer token
- **THEN** the adapter preserves that invalidity and the canonical boundary rejects the row instead of treating the identifier as absent

#### Scenario: Equivalent decimal spellings are delivered
- **WHEN** repeated income evidence spells the same exact amount as `.5`, `+0.500`, or `000.50`
- **THEN** every spelling becomes the same canonical amount and content-derived identity and can contribute at most once

#### Scenario: Income money arrives as a JSON number
- **WHEN** the adapter, persisted store, direct constructor, or IPC frame supplies `income` as a JavaScript number rather than the exchange's exact decimal string
- **THEN** the evidence is rejected before identity or digest construction because any already-parsed digits may have been rounded

#### Scenario: One lane advances beyond the other lane targets
- **WHEN** a funding-only refresh advances the funding lane target while confirmed credit and insurance lanes retain their earlier independent targets
- **THEN** each retained lane remains complete through its own target so older covered intervals stay eligible for exact NET, while resource-wide completeness remains false until every required lane covers the aggregate maximum edge

#### Scenario: A read failure embeds credentials in diagnostics
- **WHEN** an HTTP error carries an arbitrary code or an authorization value containing a scheme and secret token
- **THEN** persistence and IPC use `READ_FAILED` for an unsafe code and redact the entire authorization value without retaining the token

#### Scenario: Credentials use a quoted or JSON diagnostic form
- **WHEN** an error message contains quoted `Authorization`, `Proxy-Authorization`, `X-MBX-APIKEY`, signature, secret, Bearer, or Basic credential markers
- **THEN** store, IPC, renderer, and main-process logs retain no part of the credential-bearing source message

#### Scenario: Adapter returns a malformed page container
- **WHEN** a settled-income adapter answer carries a non-array `rows` value
- **THEN** the lane fails transactionally and retained evidence cannot be replaced by a successful empty-complete reading

#### Scenario: An income row omits its settlement asset
- **WHEN** an HTTP or persisted income row has a blank or absent asset
- **THEN** canonical validation rejects it and no wallet layer may default that row to USDT or count it toward exact Net

#### Scenario: Contract-scoped income omits its contract
- **WHEN** a funding-fee or insurance-clear row has a blank or absent symbol
- **THEN** canonical validation rejects the row, its lane remains incomplete without advancing confirmed coverage, and no unrelated round can claim its amount by timestamp

#### Scenario: An account-level credit omits a contract
- **WHEN** an allowed commission-credit row has complete canonical identity, amount, asset, and time evidence but no symbol
- **THEN** canonical validation retains it as account-level evidence and does not invent a contract owner

#### Scenario: A persisted lane contains rejected evidence
- **WHEN** a persisted v2 lane or its pending checkpoint contains a malformed row, a row for another lane, or a duplicate canonical identity
- **THEN** restoration rejects the whole stored snapshot rather than silently shortening the row set while retaining ready or complete state

#### Scenario: A complete lane contains rejected row evidence
- **WHEN** a v2 frame marks a lane complete but that lane contains a malformed row, a duplicate identity, conflicting values for one identity, or a row naming another income type
- **THEN** the renderer rejects the candidate atomically and cannot publish an exact NET from the shortened canonical row list

#### Scenario: Aggregate rows contradict their lanes
- **WHEN** a v2 frame's aggregate rows add, omit, duplicate, or conflict with any row in the validated lane union
- **THEN** the candidate frame is rejected and no aggregate-only money can enter wallet reconciliation

#### Scenario: Aggregate resource state contradicts its lanes
- **WHEN** supplied aggregate status, coverage, target, attempt/success times, or completeness disagrees with the state derived from validated lanes
- **THEN** the candidate frame is rejected and the prior renderer resource remains authoritative

#### Scenario: Canonical lane and aggregate evidence agree
- **WHEN** every lane is unique and valid and the supplied aggregate rows equal the canonical lane union
- **THEN** the renderer admits the frame with its fingerprint and generation unchanged and derives its accepted aggregate rows from the lanes

#### Scenario: A newer frame omits or invents a lane
- **WHEN** a newer v2 frame carries an empty, partial, or extra lane set instead of exactly every canonical settled-income lane
- **THEN** the renderer rejects the whole candidate and retains the previously held authoritative snapshot

#### Scenario: Observation frame carries a bounded single copy of evidence
- **WHEN** main publishes unchanged money with newer observation times
- **THEN** each canonical row appears only in its authoritative lane, the renderer derives the union, and an over-ceiling lane or compatibility aggregate list is rejected before canonicalization

#### Scenario: Observation-only publication reuses canonical lane rows
- **WHEN** main publishes newer observation clocks with the same activation, account fingerprint, content generation, and digest
- **THEN** it reuses the previously sorted canonical row arrays and does not normalize, clone, or sort the unchanged retained ledger again

### Requirement: Manual refresh reports settled-income outcome independently
An operator refresh SHALL make the settled-income refresh outcome observable independently of balances, positions, and orders. It MAY await all resource outcomes or return an accepted compound operation, but it SHALL NOT report settled income as successfully refreshed before that resource succeeds. The renderer SHALL mark only an operator-originated refresh with explicit validated manual intent. An accepted compound receipt SHALL identify that manual refresh request and server-side request time, SHALL let account resources reach their own terminal outcome, and SHALL refer consumers to the authoritative settled-income resource rather than copying a provisional income result. Startup, periodic, and trading-mutation refreshes SHALL NOT emit a manual receipt and SHALL remain non-blocking.

Manual lane loading SHALL remain process-local coordination state and SHALL NOT become durable exchange evidence. If a funding, fill, or insurance witness must persist confirmation debt while manual loading is active, the durable snapshot SHALL apply that debt to the last exchange-backed lane state and SHALL NOT serialize unrelated provisional loading status, provisional targets, or cleared transient errors. A restart SHALL therefore recover the event debt without restoring an interrupted UI loading intent as canonical account history.

#### Scenario: Account succeeds and income fails
- **WHEN** balances/positions refresh successfully but the income read fails
- **THEN** the operator sees account success and settled-income failure as separate outcomes and the old income remains qualified stale

#### Scenario: Income is still pending
- **WHEN** manual refresh has completed other resources while income remains in flight
- **THEN** settled income remains visibly loading rather than appearing refreshed

#### Scenario: A compound refresh is accepted
- **WHEN** the backend admits a Futures account refresh carrying validated explicit manual intent
- **THEN** the renderer receives a request-correlated accepted receipt, derives account completion only from account-resource attempts at or after that request, and reads income status only from the independent settled-income resource

#### Scenario: Background account work is not a manual refresh
- **WHEN** startup, periodic reconciliation, or a trading mutation asks for a Futures account refresh without explicit manual intent
- **THEN** no manual compound receipt is emitted and each affected resource continues to report through its own authoritative state

#### Scenario: A queued account refresh has not attempted its pass
- **WHEN** a second manual refresh is accepted while an earlier account pass is still running
- **THEN** the second receipt remains account-loading until account resources expose an attempt at or after that receipt's server request time

#### Scenario: Older income walk finishes after manual loading begins
- **WHEN** a background settled-income walk is in flight and the operator's newer Refresh marks one or more lanes loading before that older walk completes
- **THEN** the older completion cannot replace those lanes with ready, stale, or error; retained evidence stays visibly loading until the pass authorized for the newest manual intent reaches its own terminal outcome

#### Scenario: Settlement arrives while manual loading is active
- **WHEN** one or more lanes are visibly loading for a manual refresh and a funding, fill, or insurance witness requires durable confirmation debt
- **THEN** the live resource keeps current loading/debt authority, while persistence writes the new debt over last exchange-backed lanes and stores no unrelated manual-loading state

#### Scenario: A trading mutation schedules income
- **WHEN** an execution schedules a settled-income tail read
- **THEN** the trading command outcome is not delayed, and the independent income resource later reports ready or failed

### Requirement: A joining renderer receives account authority before settled income
The system SHALL preserve strict account-fingerprint isolation for settled income. After a renderer activates Futures, the main process SHALL acknowledge that activation, send that renderer an account-state frame naming the active credential fingerprint, and only then send its current settled-income snapshot with the same fingerprint. A current shared snapshot SHALL remain usable even when its scheduled bootstrap REST read is not yet due, and joining one renderer SHALL NOT rebroadcast an account snapshot to existing renderers.

#### Scenario: A later renderer joins a current shared resource
- **WHEN** one renderer has already made settled income current and another renderer activates Futures for the same credential fingerprint
- **THEN** the later renderer receives activation acknowledgement, matching account authority, and the current settled snapshot in that order without requiring another income REST read

#### Scenario: Settled income belongs to another fingerprint
- **WHEN** a settled-income frame does not exactly match the fingerprint established by the renderer's latest account-state frame
- **THEN** the renderer rejects that frame and does not weaken admission for startup convenience

### Requirement: Trade-history activity requires fill evidence
The system SHALL mark a symbol's trade history dirty and schedule its bounded repair read only when an execution report contains actual fill evidence. A zero-fill order lifecycle report SHALL remain an order-state event and SHALL NOT invalidate confirmed history coverage.

#### Scenario: An order changes lifecycle without a fill
- **WHEN** the user-data stream reports `NEW`, `CANCELED`, or `EXPIRED` with zero last-filled and cumulative-filled quantities
- **THEN** confirmed trade-history coverage remains valid and no trade-history repair read is scheduled

#### Scenario: An execution contains a fill
- **WHEN** the user-data stream reports a `TRADE` execution or positive fill evidence
- **THEN** that symbol's fill-history activity advances, its prior frozen proof no longer suppresses reconciliation, and one bounded trade repair is scheduled for the fill burst
