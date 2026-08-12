# futures-workstation-presentation

## Purpose

Defines Futures workspace startup and switching, market availability presentation, chart overlay composition, and bounded-tape throttling and filtering.
## Requirements
### Requirement: The last selected market workspace is restored before mount
After credential preflight resolves, the application SHALL read the last explicitly activated market workspace from durable local storage before mounting Spot or Futures. A valid stored Spot or Futures value SHALL become the initial workspace without first mounting, subscribing, or briefly displaying the other market, provided that market's credential pair is complete. When the stored market's credentials are incomplete, the application SHALL show the neutral selector, mount neither market, and retain the stored value so a later start recovers it once the environment is fixed.

#### Scenario: Futures was last active
- **WHEN** the persisted market workspace is Futures at the next successful startup and the Futures pair is complete
- **THEN** Futures is the first market workspace mounted and Spot is not initialized

#### Scenario: Spot was last active
- **WHEN** the persisted market workspace is Spot at the next successful startup and the Spot pair is complete
- **THEN** Spot is the first market workspace mounted and Futures is not initialized

#### Scenario: Operator changes workspace
- **WHEN** the operator successfully switches between Spot and Futures
- **THEN** the newly active workspace is durably stored as the next startup workspace

#### Scenario: Persisted market lost its credentials
- **WHEN** the persisted market workspace names a market whose credential pair is incomplete
- **THEN** the neutral selector is shown, neither workspace mounts, and the persisted value is retained rather than overwritten or cleared

### Requirement: Missing or invalid workspace state has no implicit fallback
The application SHALL NOT default to Spot when the persisted market workspace is absent, unreadable, invalid, or belongs to a market without complete credentials. It SHALL render a neutral Spot/Futures selector, mount neither market workspace, and start no market-specific requests or subscriptions until the operator explicitly selects an available one.

#### Scenario: First run has no stored workspace
- **WHEN** credential preflight resolves but no market workspace has ever been persisted
- **THEN** the neutral selector is shown and neither Spot nor Futures initializes until an explicit selection

#### Scenario: Stored workspace is invalid
- **WHEN** durable storage contains a value other than a supported Spot or Futures workspace
- **THEN** the invalid value is ignored, the neutral selector is shown, and no implicit Spot fallback occurs

#### Scenario: Storage cannot be read
- **WHEN** durable storage is unavailable or throws during startup
- **THEN** the application remains on the neutral selector and allows an explicit session selection without initializing a market automatically

#### Scenario: Only one market is configured
- **WHEN** exactly one market has a complete credential pair and no workspace is persisted
- **THEN** the neutral selector is shown, and the unconfigured market is not selected implicitly in place of the configured one

### Requirement: The inactive market is lazy and quiescent
At startup the application SHALL load and initialize only the persisted active market's React workspace and market-specific data path. The other workspace SHALL be lazy-loaded only after explicit selection and SHALL issue no market-specific public requests, signed account requests, analytics polling, or stream subscriptions while inactive. A shared local diagnostic/control transport MAY remain available if it performs no inactive-market work.

#### Scenario: Startup restores Futures
- **WHEN** Futures is the persisted active workspace
- **THEN** Futures code/data initialization begins and Spot components, subscriptions, account refreshes, and analytics polling remain inactive

#### Scenario: Inactive workspace is selected for the first time
- **WHEN** the operator explicitly selects a workspace that has not been loaded in the current application session
- **THEN** that workspace is loaded on demand and its market-specific initialization begins only then

#### Scenario: Operator switches markets
- **WHEN** the operator switches from the active market to the other market
- **THEN** the previous market's subscriptions and pending market-specific work are cleaned up before or generation-isolated from the newly selected market

#### Scenario: Previously loaded workspace becomes inactive
- **WHEN** a workspace module was loaded earlier but is no longer selected
- **THEN** its cached code MAY remain in memory but its market-specific network activity and timers remain stopped

### Requirement: The chart does not draw a MARK overlay
The Futures chart SHALL NOT render a historical MARK candle series, a horizontal MARK price line, a MARK label, MARK accessibility text, or any MARK contribution to autoscaling. The current mark price SHALL remain available to the header, position rows, and risk calculations. The INDEX reference is removed separately by "The chart shows only decision-relevant overlays", and no accessibility text SHALL describe an overlay the chart no longer draws.

This requirement SHALL be covered by automated chart tests that fail if any MARK presentation returns, if an INDEX presentation returns, or if current mark price stops reaching the header and position rows. Removal verified only by inspection SHALL NOT be considered covered.

#### Scenario: Mark-price data is available
- **WHEN** the workstation receives valid mark-price history and a current mark price
- **THEN** no MARK series or MARK horizontal line is drawn on the chart

#### Scenario: Risk state uses mark price
- **WHEN** a position or liquidation-distance calculation requires mark price
- **THEN** removing the chart overlay does not remove or substitute the underlying mark-price input

#### Scenario: Payload carries mark data
- **WHEN** the chart receives a payload containing mark values
- **THEN** no MARK series, price line, label, or accessibility text is created, and autoscaling is unaffected by mark values

#### Scenario: MARK presentation is reintroduced
- **WHEN** any MARK series, line, label, or accessibility text is added back to the chart
- **THEN** at least one chart test fails

#### Scenario: INDEX presentation is reintroduced
- **WHEN** an INDEX series, line, label, or accessibility mention is added back to the chart
- **THEN** at least one chart test fails

#### Scenario: Mark price still reaches non-chart surfaces
- **WHEN** the workstation renders header and position rows for a symbol with a current mark price
- **THEN** that mark price is displayed, distinguishing overlay removal from loss of mark data

### Requirement: Tape filtering uses displayed trade notional in USDT
The bounded tape SHALL provide a user-configurable minimum displayed trade notional expressed in USDT. A trade's displayed notional SHALL be calculated as absolute price multiplied by absolute quantity, and trades below the configured threshold SHALL be excluded before delivery to the renderer.

#### Scenario: Trade is below the configured threshold
- **WHEN** a trade's calculated notional is less than the minimum displayed USDT value
- **THEN** the trade is not included in the renderer tape payload

#### Scenario: Trade meets the configured threshold
- **WHEN** a trade's calculated notional is equal to or greater than the minimum displayed USDT value
- **THEN** the trade remains eligible for the bounded renderer payload

#### Scenario: Threshold is zero
- **WHEN** the minimum displayed notional is configured as zero
- **THEN** no otherwise valid trade is excluded by notional

### Requirement: Tape delivery can be throttled by a configurable timeout
The bounded tape SHALL provide an on/off throttle and a user-configurable timeout in milliseconds. While enabled, the service SHALL emit no more than one tape payload per configured timeout window and SHALL deliver the newest eligible bounded state at the trailing edge when trades arrived during the window.

#### Scenario: Many trades arrive inside one timeout window
- **WHEN** throttling is enabled and multiple eligible trades arrive before the timeout elapses
- **THEN** the renderer receives at most one coalesced tape update for that window containing the newest bounded state

#### Scenario: Throttling is disabled
- **WHEN** the operator disables tape throttling
- **THEN** eligible trades may be delivered without the configured delay while the notional filter and bounded row limit still apply

#### Scenario: No eligible trade arrives
- **WHEN** all trades in a timeout window are below the configured notional threshold
- **THEN** no redundant tape update is emitted solely because the timeout elapsed

### Requirement: Tape settings are validated and explained
The UI SHALL label timeout units and the USDT notional meaning, SHALL reject or normalize non-finite, negative, or out-of-range input without crashing the stream, and SHALL display the effective settings. The row bound SHALL remain enforced independently of filtering and throttling.

#### Scenario: Invalid timeout is entered
- **WHEN** the operator enters an invalid or unsupported timeout value
- **THEN** the system keeps the previous valid effective timeout and presents validation feedback

#### Scenario: Invalid notional is entered
- **WHEN** the operator enters a negative or non-finite minimum notional
- **THEN** the system keeps the previous valid effective threshold and presents validation feedback

#### Scenario: High-volume stream exceeds the row bound
- **WHEN** more eligible trades are accumulated than the configured bounded-tape capacity
- **THEN** only the newest rows within the bound are retained and delivered

### Requirement: Throttle lifecycle cannot leak stale updates
Pending tape emissions SHALL be canceled or generation-guarded when the symbol generation changes, the workstation stops, or the service is disposed. A delayed payload from an obsolete generation SHALL NOT appear in the current symbol's tape.

#### Scenario: Symbol changes while an emission is pending
- **WHEN** the operator selects a new symbol before the previous symbol's throttle timeout elapses
- **THEN** no delayed payload from the previous symbol is rendered in the new symbol's tape

#### Scenario: Workstation stops while an emission is pending
- **WHEN** the workstation stops or is disposed before the timeout elapses
- **THEN** the pending timer is cleared and emits no later renderer update

### Requirement: Market switching presents unavailable markets explicitly
The market switch SHALL render whenever at least one market is configured. A market without a complete credential pair SHALL be presented as disabled, SHALL expose its missing variable names as its accessible reason, and SHALL NOT be selectable. Selecting an available market SHALL activate it normally. When no market is configured, the blocking configuration screen SHALL replace the selector and switch entirely.

#### Scenario: One market configured
- **WHEN** exactly one market has a complete credential pair
- **THEN** the switch renders with that market selectable and the other market disabled and labeled with its missing variable names

#### Scenario: Attempted selection of an unavailable market
- **WHEN** the operator activates the control for a market without credentials
- **THEN** no workspace mounts, no activation request is sent, and the disabled reason remains visible

#### Scenario: Neither market configured
- **WHEN** no market has a complete credential pair
- **THEN** the blocking configuration screen replaces the selector and switch entirely

### Requirement: The instrument rail reflects what is actually traded
The workstation SHALL persist recently selected contracts, favourites, and the last selected contract. It SHALL restore the last selected contract on startup and SHALL order the contract catalogue by recency, then favourites, then alphabetically.

#### Scenario: Operator reopens the workstation
- **WHEN** the operator restarts the application after trading a contract
- **THEN** that contract is selected again instead of a hard-coded default

#### Scenario: Catalogue is displayed
- **WHEN** the contract list is rendered
- **THEN** recently traded contracts appear first in the single contract list, without a second strip repeating the same entries

### Requirement: Interface scale is adjustable and persisted
The workstation SHALL express its type sizes against a persisted interface scale with a legible floor, expose a control to change it, and SHALL additionally provide persisted window-level zoom shortcuts for surfaces outside that scale.

#### Scenario: Operator enlarges the interface
- **WHEN** the operator increases the interface scale
- **THEN** every futures surface grows proportionally and the choice survives a restart

#### Scenario: Operator zooms the window
- **WHEN** the operator presses the platform zoom-in, zoom-out, or reset shortcut
- **THEN** the whole application scales, including the chart canvas, and the level survives a restart

### Requirement: Order sizing is quantized to whole USDT
Order notional SHALL be quantized to whole USDT wherever it is computed, displayed, or edited, so sizing never presents fractional-cent values.

#### Scenario: Operator drags the size slider
- **WHEN** a percentage of the available balance is selected
- **THEN** the resulting notional is a whole number of USDT in both the readout and the notional field

### Requirement: The chart shows only decision-relevant overlays
The chart SHALL render the contract candles, the operator's drawings and alerts, the operator's orders, and the open position's entry and liquidation prices. The chart SHALL NOT render an index-price overlay, an index price line, or a price-axis marker for the working price draft, and the market header SHALL NOT present an index price field.

The price scale SHALL carry prices. The volume series SHALL NOT stamp its newest
bar onto it: volume is stated by the bars themselves, against their own baseline,
and a quantity in the plate the desk reads levels from is read as a level.

#### Scenario: Chart is rendered for a live contract
- **WHEN** the workstation is live on a contract
- **THEN** no index series, no index price line, and no index header field are present

#### Scenario: Operator picks a price on the chart
- **WHEN** the operator clicks a price to seed the order draft
- **THEN** the draft is reflected in the ticket without adding a coloured label to the price axis

#### Scenario: The newest candle has volume
- **WHEN** the chart draws the volume histogram for the contract on screen
- **THEN** the last bar's volume is not labelled on the price scale

### Requirement: The instrument rail carries no exchange-filter reference panel
The instrument rail SHALL NOT present a contract-filter reference panel. The price tick, the quantity step, the contract's quantity range and its minimum notional SHALL remain enforced on every order draft and SHALL be reported only when they block a specific action. Every other exchange filter SHALL be left to the exchange, and its refusal SHALL be reported to the operator with the exchange's own code and message.

#### Scenario: A contract is selected
- **WHEN** the operator selects a contract
- **THEN** no tick-size, step-size, percent-price, max-orders, or minimum-notional reference panel is rendered

#### Scenario: A draft violates a filter
- **WHEN** a draft order violates the price tick, the quantity step, the quantity range, or the minimum notional
- **THEN** the ticket states the violated constraint for that draft

#### Scenario: A draft violates a filter only the exchange enforces
- **WHEN** a draft order violates a filter the desk no longer evaluates locally
- **THEN** the submission reaches the exchange and its refusal is presented with the exchange's code and message

### Requirement: The default chart interval is 15m
A contract SHALL open on the `15m` interval unless the operator selects another interval.

#### Scenario: Operator opens a contract
- **WHEN** the workstation mounts or a different contract is selected
- **THEN** the chart interval is `15m`

### Requirement: The order book is denominated in USDT and groupable
The order book SHALL express each level's size and cumulative size in USDT,
SHALL let the operator group levels by a price step derived from the contract's
tick size, and SHALL show the levels reached by that grouping rather than a
fixed ten per side. The `Spread` and raw update-id readouts SHALL be replaced by
the last traded price.

Because grouping is applied after delivery, the number of raw levels delivered
to the renderer SHALL be at least the deepest view the grouping control can ask
for and fully fill, and SHALL NOT be reduced below the depth the exchange
publishes. Delivery SHALL carry the whole retained book, and the bound the
payload validator enforces SHALL be the same value the book is built to, so a
book that is legal to build is never rejected on arrival.

#### Scenario: Operator reads a level
- **WHEN** a level rests at a price with a base quantity
- **THEN** the row shows the price, the level's value in USDT, and the cumulative value in USDT from the top of the book

#### Scenario: Operator groups the book
- **WHEN** the operator selects a price step that is a multiple of the contract tick size
- **THEN** levels within one step are aggregated into a single row whose price is the step boundary on that side, and their USDT values are summed

#### Scenario: Contract has no usable tick size
- **WHEN** the contract's filters have not arrived
- **THEN** the book renders ungrouped at exchange precision instead of failing

#### Scenario: A coarse step is selected
- **WHEN** the operator selects a step of 25 or 50 ticks and the exchange has published enough levels to reach it
- **THEN** every visible row is filled from delivered levels, rather than the book appearing to end a fraction of a percent from the mid

#### Scenario: The book reaches the end of what the exchange publishes
- **WHEN** the selected step would need more levels than Binance serves for the contract
- **THEN** the rows that can be filled are filled and the remainder are absent, and no level is invented or inferred from diff traffic beyond the snapshot's window

### Requirement: The order book states which side is leaning on it
The order book SHALL show the split between resting buy and sell value across a
symmetric window of levels — the same number of levels on each side, being the
number the visible side displays — as a two-colour bar with both percentages
stated in text, measured in USDT rather than by level count. The price range
that window covers SHALL be stated beside the split, expressed as a percentage
of the last traded price, because the same split across a fraction of a percent
and across ten percent are different readings.

#### Scenario: Bids rest more value than asks
- **WHEN** the visible bids hold three times the USDT the visible asks hold
- **THEN** the bar is three quarters positive-coloured and states 75.00% buy against 25.00% sell

#### Scenario: Operator changes the price step
- **WHEN** the grouping step changes the range of prices on screen
- **THEN** the split is recomputed over exactly the levels now displayed, and the stated range changes with it

#### Scenario: Operator reads one side only
- **WHEN** only one side is displayed, over twice as many levels
- **THEN** the split is still measured over both sides at that deeper level count, and the stated range says how far it now reaches

#### Scenario: Operator reads how far the book reaches
- **WHEN** the farther of the two visible edges sits 2.43% from the last traded price
- **THEN** the legend states `±2.43%` beside the split

#### Scenario: No book is available
- **WHEN** neither side has any resting value
- **THEN** no split is shown at all, rather than an even one

### Requirement: Instrument recency survives a restart independently of the catalogue
The instrument rail SHALL render persisted recent contracts from the first frame
after a restart as a distinct wrapping group of compact pills, before the
contract catalogue has arrived. Each pill SHALL remain selectable while its
catalogue metadata is pending, and the rail SHALL state that the catalogue is
still loading rather than showing an empty list. Once the catalogue arrives, a
recent contract SHALL adopt its confirmed metadata in place. With an empty
search query the rail SHALL NOT render a second ordinary catalogue list beneath
the recent-pill group.

#### Scenario: Application restarts
- **WHEN** the workstation mounts with a persisted recency list and no catalogue yet
- **THEN** the recent contracts are shown as selectable pills and the rail reports that the catalogue is loading

#### Scenario: Catalogue arrives
- **WHEN** the catalogue delivers metadata for contracts already shown in the recent-pill group
- **THEN** each pill remains in recency order with confirmed metadata and no ordinary catalogue list appears beneath the group

### Requirement: Position rows are read at contract precision without dead fields
Position rows SHALL render entry, mark and liquidation prices at the contract's
tick precision, SHALL NOT show fields the account endpoint does not report, and
SHALL derive return on margin from the reported initial or isolated margin.

#### Scenario: Exchange reports a repeating float
- **WHEN** the exchange reports an entry price such as `3.3449999999999998`
- **THEN** the row shows it rounded to the contract's tick precision

#### Scenario: Margin mode and leverage are not reported
- **WHEN** the position endpoint reports neither margin mode nor leverage
- **THEN** no margin cell is shown, and return on margin is computed from the reported initial or isolated margin

#### Scenario: No margin figure is reported at all
- **WHEN** the position carries no usable margin figure
- **THEN** return on margin is shown as unavailable instead of as zero

### Requirement: Chrome states only what the desk reads
The market header SHALL NOT repeat mark price or basis, SHALL colour funding by
its sign, and the trading rail header SHALL NOT repeat the market identity or
the selected symbol shown elsewhere. Direction controls SHALL be coloured by
direction. Account funds in the ticket — the available balance and the value of
the working orders — SHALL be shown in whole USDT: at six and seven figures the
cents never change a decision and cost a glance on every read.

The workstation identity bar SHALL be the single routine state location. While
the workstation market state is live and any authenticated Futures account
resource is initially synchronizing or refreshing, its state pill SHALL read
`SYNC` in place of `LIVE`; it SHALL return to `LIVE` when synchronization is no
longer in progress. The contract section and trading ticket SHALL NOT repeat a
routine market, readiness, `READY`, or `SYNC` badge. A non-routine disconnected,
stale, or unavailable market state and its reason SHALL remain disclosed, and
this consolidation SHALL NOT suppress an actionable account or command failure.

#### Scenario: Funding is negative
- **WHEN** the funding rate is negative
- **THEN** it is rendered in the negative colour, and positive funding in the positive colour

#### Scenario: Operator reaches for a direction
- **WHEN** the long and short controls are displayed
- **THEN** long controls carry the positive colour and short controls the negative colour, so direction is readable without reading the label

#### Scenario: Balance carries exchange precision
- **WHEN** the exchange reports an available balance such as `245228.33961912`
- **THEN** the snapshot keeps that value exactly, and the ticket shows `245228 USDT` — rounded rather than truncated — as it shows the value of the working orders

#### Scenario: Account refresh begins on a live workstation
- **WHEN** one or more authenticated Futures account resources enter their synchronization state while the workstation market state remains live
- **THEN** the identity state changes from `LIVE` to `SYNC`, and no second routine synchronization badge appears in the contract section or ticket

#### Scenario: Account refresh settles
- **WHEN** no authenticated Futures account resource remains in its synchronization state and the workstation market state is live
- **THEN** the identity state returns from `SYNC` to `LIVE`

#### Scenario: Market state is not routine
- **WHEN** the workstation becomes disconnected, stale, or unavailable
- **THEN** the identity bar discloses that non-routine market state and its reason rather than replacing it with `LIVE`

### Requirement: The last traded price has a source the tape cannot filter
The last-print row between the two book sides, the market header's `Last`, the
grouping step's share-of-price readout and the reference the pressure reach is
measured against SHALL all read one resolved last traded price. That price SHALL
be taken from the newest live candle's close, falling back to the ticker's last
price and only then to the newest displayed trade. The tape's own display
settings — minimum displayed notional and throttle timeout — SHALL NOT be able
to hold that price still.

#### Scenario: Tape filter excludes every recent print
- **WHEN** the operator's minimum displayed trade excludes the prints that are actually trading, so the tape delivers no new row
- **THEN** the last-print row keeps tracking the candle close, at the cadence the chart is drawn from

#### Scenario: Candles are not live
- **WHEN** no live candle is available for the selected interval
- **THEN** the ticker's last price is shown, and the newest displayed trade only if the ticker has none either

#### Scenario: One price on screen
- **WHEN** the last traded price is resolved
- **THEN** the market header, the book's last-print row and the step-share readout state the same number rather than three separately sourced ones

### Requirement: The last-print row states direction as change, not as maker side
The last-print row SHALL be tinted by the direction of the change from the
previously shown price, and its accessible name SHALL state that direction so
the meaning is not exposed as an unlabelled number. It SHALL NOT render a
directional glyph or the visible word `LAST`, and SHALL NOT be tinted by the
buyer-maker flag of the newest displayed trade, which may belong to a print the
tape filter kept on screen long after the market moved past it.

#### Scenario: Price rises
- **WHEN** the resolved last price is higher than the one previously shown
- **THEN** the row uses the buy colour, its accessible name identifies an upward last-price move, and no directional glyph or `LAST` label is rendered

#### Scenario: Price falls
- **WHEN** the resolved last price is lower than the one previously shown
- **THEN** the row uses the sell colour, its accessible name identifies a downward last-price move, and no directional glyph or `LAST` label is rendered

#### Scenario: Price is unchanged
- **WHEN** a new value equals the one on screen
- **THEN** the row keeps the direction it last showed rather than resetting to neutral

#### Scenario: Contract changes
- **WHEN** the operator selects another contract
- **THEN** the first price of the new contract reads as neutral rather than inheriting the previous contract's direction

### Requirement: The order book renders whole rows only
The book SHALL render exactly as many rows per side as the panel can show in
full, measured from the panel itself. No row SHALL be drawn partially, and no
rendered row SHALL be clipped out of view. The sell side SHALL be laid out
against the last-print row, so the levels nearest the traded price are the ones
on screen. Row height SHALL follow the interface scale.

#### Scenario: Panel is shorter than the default row count needs
- **WHEN** the panel can hold nine rows per side
- **THEN** nine whole rows are rendered per side, rather than fourteen rows clipped to eight and a half

#### Scenario: Sell side is short of room
- **WHEN** the sell side cannot show every grouped level
- **THEN** the levels dropped are the ones farthest from the traded price, never the best asks

#### Scenario: Panel cannot be measured
- **WHEN** the panel has no laid-out height, or the environment provides no resize observation
- **THEN** the default row count per side is used rather than an empty book

#### Scenario: Interface scale changes
- **WHEN** the operator raises the interface scale
- **THEN** the rows grow with the type and the row count is remeasured against the taller row

### Requirement: The order book can be read one side at a time
The book SHALL offer a three-way side control — both sides, buy side only, sell
side only — beside the price-step control. A single side SHALL be given the
whole book area, and the number of levels shown SHALL be remeasured for it, so
the operator can reach farther into the book without coarsening the step. The
last-print row SHALL remain visible in every mode.

#### Scenario: Operator shows one side
- **WHEN** the operator selects buy side only
- **THEN** the sell side is not rendered, and the buy side shows the levels that now fit the whole area — roughly twice as many — at the unchanged step

#### Scenario: Operator returns to both sides
- **WHEN** the operator selects both sides
- **THEN** the two sides are shown again, each remeasured to half the area

#### Scenario: Selected mode outlives a contract change
- **WHEN** the operator selects another contract and comes back
- **THEN** the side mode chosen for the first contract is what it is shown with again, rather than being reset or replaced by the mode chosen for the second

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

### Requirement: An amount too large to read is abbreviated by magnitude
An amount whose magnitude is what it is read for SHALL be shown abbreviated —
thousands, millions and billions — rather than as its full digit string, and the
exact figure SHALL remain available on the element. No abbreviation SHALL leave a
suffix that abbreviates nothing, such as thousands of millions.

An abbreviated amount SHALL name the unit it is stated in, and SHALL be the leg
that unit measures: a day's volume in USDT is the quote leg, never the count of
contracts traded. Where both legs exist, the other SHALL remain available on the
element with its own unit named.

#### Scenario: A daily volume is displayed
- **WHEN** the market header shows a 24-hour volume of tens of millions
- **THEN** it is shown as a magnitude with one decimal and its unit, and the exact figure is on the element's title

#### Scenario: An amount reaches the billions
- **WHEN** an abbreviated amount is a billion or more
- **THEN** it carries a billions suffix rather than being printed as a four-digit millions figure

#### Scenario: The contract trades billions of units of a cheap asset
- **WHEN** a contract's 24-hour base volume is billions of contracts and its quote volume is hundreds of millions of USDT
- **THEN** the header states the quote volume against a USDT label, and the base count is on the element's title with the base asset named

### Requirement: A price is shown at its own precision, not the stream's width
A price taken from an exchange stream SHALL be displayed without the padding the
payload carries, and SHALL NOT be re-quantized in a way that drops a digit the
contract trades at.

#### Scenario: A padded close arrives
- **WHEN** a kline close arrives as `2.6010000`
- **THEN** the desk shows `2.601`

#### Scenario: The contract is quoted in fractions of a cent
- **WHEN** a price arrives as `0.00123000`
- **THEN** every trading digit is kept and only the padding is dropped

### Requirement: A reading is never silently sliced by its column
A cell whose content can outgrow it SHALL keep the whole of the reading the
operator is looking for and SHALL carry the exact figures on the element. Where a
cell holds a primary amount and a secondary percentage, the percentage SHALL NOT
be the part that is cut.

A column of money SHALL be sized for the amounts the account can actually reach —
five figures and two decimals — rather than for the amounts it holds today. Where a
table cannot fit every reading in the width it has, a component of a result SHALL
give up its column to the element's title before the result itself does.

#### Scenario: A uPnL and its ROE together outgrow the column
- **WHEN** an unrealized PnL and the ROE beside it are wider than the column allows
- **THEN** the percentage is shown whole, the amount gives way with an ellipsis, and both figures are stated exactly in the cell's title

#### Scenario: A five-figure amount is reported beside its percentage
- **WHEN** a position's unrealized PnL reaches five figures and two decimals
- **THEN** both the amount and its percentage are shown whole, with neither shortened

#### Scenario: A history table has more readings than width
- **WHEN** the closed-position history cannot fit every reading in the dock's width
- **THEN** the realized PnL keeps its column and the fee is stated in that cell's title together with the net

### Requirement: The rail marks the contracts recently worked with
The instrument rail SHALL present contracts the operator has recently selected
as a wrapping group of compact pills rather than as full-width contract rows or
rows carrying a `recent` suffix. The group SHALL preserve most-recent-first order
across an app restart and SHALL allow several ordinary USDⓈ-M symbols to occupy
one line at the instrument rail's supported width. Each pill SHALL expose the
contract selection and favorite state as accessible controls and SHALL disclose
which contract is selected. When no persisted recent contract exists, the
workstation's active starting contract SHALL seed the group so the retained idle
list is never absent on a fresh installation.

When the search field is empty, the recent-pill group SHALL be the only contract
list and the rail SHALL NOT render the ordinary catalogue beneath it. When a
search query is active, the pill group SHALL yield to one unified matching list
so every result appears once and the operator can discover contracts outside
the recent set. The recent-pill group SHALL grow to its wrapped content height
while unused vertical space remains below the execution ticket. It SHALL become
internally scrollable only when showing all recent pills would exhaust the
rail's available height, and SHALL NOT reserve a fixed short scroll viewport
while otherwise usable rail space remains empty.

#### Scenario: A recent contract is confirmed by the catalogue
- **WHEN** the catalogue delivers a contract that is in the recency list
- **THEN** it remains a confirmed recent-contract pill rather than a full-width row carrying only its contract type, and no second catalogue list is rendered

#### Scenario: Several recent contracts are available
- **WHEN** the rail has several ordinary-length recent USDⓈ-M symbols and no search query
- **THEN** they wrap as compact pills with more than one fitting on a line instead of consuming one full row each

#### Scenario: Search is empty
- **WHEN** the search field has no query
- **THEN** the rail renders the recent-pill group without a second ordinary catalogue list beneath it

#### Scenario: A recent contract is selected
- **WHEN** the operator activates a recent-contract pill
- **THEN** that contract becomes selected and the pill discloses the selected state

#### Scenario: A recent favorite is toggled
- **WHEN** the operator activates the favorite control associated with a recent-contract pill
- **THEN** that contract's persisted favorite state changes without selecting a different contract

#### Scenario: The app is restarted
- **WHEN** the operator selects a contract, closes the app and reopens it
- **THEN** the rail shows that contract first in the recent-pill group before the catalogue arrives

#### Scenario: The app has no stored contract history
- **WHEN** the workstation opens with an empty persisted recency list
- **THEN** its active starting contract is shown as the first recent pill and is persisted through the normal symbol-history path

#### Scenario: Operator searches contracts
- **WHEN** the search field contains a query
- **THEN** the recent-pill group yields to a unified matching catalogue list in which a recent contract appears no more than once and non-recent matches remain selectable

#### Scenario: The rail has unused vertical space
- **WHEN** recent pills wrap onto additional lines and the execution ticket still leaves unused space below it
- **THEN** the recent-pill group expands to show those lines without an internal vertical scrollbar

#### Scenario: Recent pills exhaust the rail height
- **WHEN** showing every wrapped recent pill would leave insufficient height for the execution ticket within the rail
- **THEN** the recent-pill group is constrained to the remaining height and becomes internally scrollable without pushing the ticket outside the rail

### Requirement: The order book and tape reserve vertical space for market data
The order book SHALL omit the visible `Price`, `USDT`, and `Total` heading row,
and the aggregate-trade tape SHALL omit the visible `Price`, `USDT`, and `Time`
heading row. Their numeric columns SHALL remain aligned, and every book level and
tape row SHALL expose an accessible name that identifies the meaning and units
of its values after the visible headings are removed.

The last-print row SHALL contain only its resolved price visually. It SHALL have
no divider borders, and its vertical margin and padding SHALL be reduced from
the current separator spacing so the recovered height belongs to complete book
levels rather than chrome.

The tape's pause and filter/settings controls SHALL live in a click-to-open
section that is collapsed by default. Closing that section SHALL hide only its
controls and effective-settings text: the aggregate-trade rows SHALL remain
visible, keep updating unless the tape was explicitly paused, and keep their
current scroll position. Reopening the section SHALL retain all current and
draft setting values.

#### Scenario: Order book is rendered
- **WHEN** the order book has visible levels
- **THEN** no visible `Price`, `USDT`, or `Total` heading row consumes height, while each level remains accessibly identified as price, level USDT, and cumulative USDT

#### Scenario: Last price separates the book sides
- **WHEN** asks and bids are displayed around the last-print row
- **THEN** the separator shows only the resolved price with compact vertical spacing and no horizontal divider borders

#### Scenario: Tape settings have not been opened
- **WHEN** the aggregate-trade panel first renders
- **THEN** its pause, throttle, timeout, minimum-trade, apply, and effective-settings controls are collapsed while the trade rows remain visible

#### Scenario: Operator opens tape settings
- **WHEN** the operator activates the tape-settings disclosure
- **THEN** the pause and filter/settings controls open in place with their current values and can be used as before

#### Scenario: Operator closes tape settings
- **WHEN** the operator closes the tape-settings disclosure after changing or applying a value
- **THEN** the controls collapse without resetting their values, pausing the tape, hiding the trades, or resetting the trade list's scroll position

#### Scenario: Aggregate trades are rendered
- **WHEN** the tape has visible trade rows
- **THEN** no visible `Price`, `USDT`, or `Time` heading row consumes height, while each row remains accessibly identified as price, trade notional in USDT, and time

### Requirement: The execution ticket keeps decision controls and actionable failures
The default Futures execution ticket SHALL present the tabs, selected contract
and leverage, selected price, percentage slider with percentage and USDT
readout, editable USDT notional, decision-relevant account summary, and manual
order actions without a separate readiness/pause header. It SHALL NOT present a
`READY` label or routine readiness reason, an operator `Pause trading` or
`Resume trading` control, a passive shortcut/action label, percentage anchor
buttons, a derived `Quantity` summary row, the mouse-shortcut legend, successful
submission or cancellation acknowledgements, or a passive last-execution card.

Removing that chrome SHALL NOT change sizing, exchange-filter quantization,
confirmation, pause enforcement, or command handling. The exact derived
quantity SHALL remain visible in the confirmation that precedes a send. When an
action is blocked, not sent, rejected, or has an unresolved outcome, the ticket
SHALL still present the contextual reason; account synchronization failures
SHALL remain visible with their valid retry path. Passive success removal SHALL
NOT remove any of those safety-critical messages.

#### Scenario: Operator opens a ready ticket
- **WHEN** the live account and selected contract satisfy the order-entry gates
- **THEN** the ticket shows the slider and order controls without `READY`, a pause control, percentage anchors, `Quantity`, shortcut help, or passive status cards

#### Scenario: Operator sizes with the slider
- **WHEN** the operator changes the percentage slider
- **THEN** the percentage and whole-USDT notional readouts update and the order draft is sized exactly as before without needing an anchor button

#### Scenario: Order reaches confirmation
- **WHEN** an order action stages a valid draft
- **THEN** the confirmation states the exact exchange-quantized quantity even though the ticket summary omits its `Quantity` row

#### Scenario: Order is accepted
- **WHEN** a confirmed order is accepted for submission
- **THEN** no successful-submission banner or passive last-execution card is added to the ticket

#### Scenario: Pending confirmation is cancelled
- **WHEN** the operator cancels a staged confirmation without sending it
- **THEN** the confirmation closes without adding a cancellation-status banner

#### Scenario: Action cannot be sent
- **WHEN** a gate blocks an action or the local transport cannot send it
- **THEN** the ticket keeps the actionable blocking or not-sent reason visible without restoring routine readiness chrome

#### Scenario: Command outcome requires attention
- **WHEN** the exchange rejects a command, a command outcome is unresolved, or an account resource fails synchronization
- **THEN** the ticket retains the corresponding actionable message and valid retry path while passive acknowledgement cards remain absent

### Requirement: Typing opens the contract and interval picker
Typing a bare letter SHALL open a picker over every known contract, and typing a
bare digit SHALL open a picker over the chart intervals, in both cases seeded with
the character typed. Results SHALL rank a symbol the query starts above one it only
contains, and recency above the alphabet. Picking an entry SHALL change the
selection and close the picker.

#### Scenario: A letter is typed on the workstation
- **WHEN** the operator types a letter with no modifier held and no field focused
- **THEN** the picker opens on that letter, listing the contracts worked with lately first

#### Scenario: A digit is typed
- **WHEN** the operator types a digit
- **THEN** the picker offers the chart intervals matching it, and picking one changes the interval

#### Scenario: The keystroke belongs to something else
- **WHEN** the keystroke lands in a text field, or a modifier is held, or the market is not the active one
- **THEN** no picker opens and the keystroke is left to whatever it was meant for

### Requirement: A panel opened at the cursor stays wholly inside the window
A panel anchored at the pointer SHALL be placed so that its whole height and
width remain inside the window, wherever the operator clicked and whatever the
window's size and position on the desktop. The placement SHALL follow the
panel's actual rendered height rather than an assumed one, and SHALL be
corrected when the panel's content changes size while it is open.

#### Scenario: The click lands near the bottom edge
- **WHEN** the operator opens a panel by clicking near the bottom of the window
- **THEN** the panel is placed above that point so that its last control is visible, rather than extending past the window's edge

#### Scenario: The panel grows after it opens
- **WHEN** a panel's content grows while it is open
- **THEN** its position is corrected so it still ends inside the window

#### Scenario: The panel is taller than the window
- **WHEN** a panel cannot fit in the window at all
- **THEN** it is aligned to the top edge, so that its heading and its first controls are the part that is reachable

### Requirement: A panel's drag handle does not swallow the controls on it
A panel's drag handle SHALL start a drag only for a press that did not land on
a control. A press that begins on a button, field or link inside the handle
SHALL reach that control.

#### Scenario: The close button is pressed
- **WHEN** the operator presses the close button that sits on a panel's drag handle
- **THEN** no drag begins and the panel closes

### Requirement: Dock columns line up with the headings above them
Every row of a dock table SHALL resolve to the same column widths as its
heading row. No column in a dock table SHALL be sized by its own content,
because a heading and the cells beneath it never hold the same content and a
content-sized column therefore shifts every flexible column beside it.

#### Scenario: A table with an action column is rendered
- **WHEN** the positions or orders table renders a row carrying an action control and a heading row that carries none
- **THEN** the values sit under the headings that name them

### Requirement: Position size is stated as an unsigned USDT amount
The positions dock SHALL state the size of a position as the USDT amount it is
worth at the current mark price, without a direction sign, under a header that
names the unit. Direction SHALL be carried by the side badge and the row accent
that already state it. The exact contract quantity SHALL remain available on
the cell without occupying the column.

#### Scenario: A short is displayed
- **WHEN** a position of `-0.5` contracts is marked at `60600`
- **THEN** the size cell reads `30300.00` with no leading sign, and the row still states `SHORT`

#### Scenario: Contract quantity is still needed
- **WHEN** the operator inspects the size cell of a position of `-0.5` contracts
- **THEN** the cell's title states `-0.5 contracts`

### Requirement: Row controls are rendered as part of their row
Every interactive cell in the positions dock SHALL carry an explicit style that
matches the row's own typography, colour and alignment, and SHALL express its
affordance through hover and keyboard focus rather than through a
browser-default control face. A cell SHALL NOT change its appearance merely
because its row is the selected contract.

#### Scenario: The selected contract's size cell is interactive
- **WHEN** the row of the selected contract offers the size shortcut
- **THEN** the cell reads as the same text as any other size cell, and reveals its affordance on hover and on keyboard focus

#### Scenario: A position on another contract
- **WHEN** the row belongs to a contract that is not selected
- **THEN** no size shortcut is offered and the cell reads identically to the selected row's cell

### Requirement: Position rows are valued at the live mark price
Between account snapshots, position rows SHALL be re-valued from the live mark
price feed: mark price, USDT size, unrealized PnL and return on margin SHALL
all follow the incoming mark, and the dock total SHALL be the sum of the
re-valued rows. Unrealized PnL SHALL be derived as
`(mark price − entry price) × signed quantity`. A position whose entry price,
quantity or mark is unusable SHALL be left exactly as the account snapshot
reported it, rather than partially re-valued.

#### Scenario: The market moves with no account event
- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140`
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change, and the dock total changes with them

#### Scenario: The mark feed is not connected
- **WHEN** the feed reports no mark for a symbol
- **THEN** the row shows the mark and unrealized PnL from the account snapshot, and no aged mark is presented as a live one

#### Scenario: A mark arrives for a symbol with no open position
- **WHEN** a mark arrives for a symbol that is not in the position list
- **THEN** no row is created or changed

### Requirement: The chart opens on enough history to read the market
Opening a contract SHALL present substantially more than the live streaming
window of candles. The workstation SHALL request candle history once the
contract's live window is on screen, and SHALL present the history and the live
window as one continuous series ordered by open time, with no duplicated or
missing bar at the seam.

#### Scenario: A contract is opened
- **WHEN** the contract's bootstrap completes and history is delivered
- **THEN** the chart shows the live window plus the requested history as one series, ordered by open time

#### Scenario: History overlaps the live window
- **WHEN** a delivered history page contains a candle whose open time is already in the live window
- **THEN** the live window's row is kept and the duplicate is discarded

### Requirement: Candle history is delivered as bounded pages
Candle history SHALL be delivered as pages that respect the same per-event row
and byte bounds as every other resource, each page stating its offset, the
total number of rows in the response, and whether it completes the response.
The renderer SHALL buffer pages and apply them only once the response is
complete, and SHALL discard a buffer whose generation, total or offset does not
continue the one in progress. The live candle window, its per-tick update path
and its frame bound SHALL NOT be changed by history delivery.

#### Scenario: A history response exceeds one event
- **WHEN** the requested history is larger than one event may carry
- **THEN** it arrives as consecutive pages and is applied as a single series once the final page is delivered

#### Scenario: A page arrives out of order
- **WHEN** a page's offset does not continue the buffered rows
- **THEN** the buffer is discarded and no partial history is presented

#### Scenario: The market ticks while history loads
- **WHEN** a live candle update arrives during a history response
- **THEN** the live window updates as it always has, unaffected by the history in flight

### Requirement: Scrolling left loads older candles
When the visible range reaches the oldest loaded candle, the workstation SHALL
request the next page of history behind it and prepend the result, keeping the
bars the operator is looking at in place rather than jumping the viewport. Only
one history request SHALL be in flight at a time. When a response returns fewer
candles than requested, the chart SHALL treat that as the start of the
contract's history and SHALL stop requesting more.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

### Requirement: Loaded candle history survives a restart
A closed candle SHALL NOT be read from the exchange twice. Delivered history
SHALL be stored locally per contract and interval and reused after a restart:
a page the store can satisfy SHALL be applied without issuing any request. Only
closed candles SHALL be stored, the store SHALL be bounded per contract and
interval, and a store that is unavailable or unreadable SHALL degrade to
fetching rather than fail the chart.

#### Scenario: The contract is reopened after a restart
- **WHEN** history for a contract and interval was loaded in an earlier run and is requested again
- **THEN** it is served from the local store and no history request is sent

#### Scenario: The app was closed for days
- **WHEN** the stored history no longer reaches the live window
- **THEN** the missing range is fetched and no gap is presented as continuous data

#### Scenario: The local store cannot be opened
- **WHEN** IndexedDB is unavailable
- **THEN** history is fetched as usual and the chart behaves exactly as it does without a store

### Requirement: History belongs to one contract and interval
Loaded history SHALL be discarded when the contract or the interval changes,
and a history response SHALL be ignored unless it matches the contract,
interval and subscription that asked for it.

#### Scenario: The interval changes
- **WHEN** the operator switches from 15m to 1h
- **THEN** the 15m history is discarded and the 1h chart shows no candle from the previous interval

#### Scenario: A late response arrives after a symbol change
- **WHEN** a history response for the previous contract arrives after the operator switched contracts
- **THEN** it is ignored

### Requirement: The ticket states what the working orders are worth
The trading ticket SHALL state, beneath the available balance, the total USDT
value of the account's working orders. That total SHALL be summed from the same
orders the working-orders list shows and priced by the same valuation as each of
its rows, so the stated figure and a hand-sum of the column cannot disagree. It
SHALL NOT be the margin the exchange holds against those orders, which at
leverage is a fraction of their value and which reduce-only exits do not hold at
all. Where the order list has never synchronized the total SHALL be absent
rather than zero; where the list is synchronized and empty it SHALL be zero,
which is a reading.

#### Scenario: Orders are resting
- **WHEN** the account holds a 116890 USDT entry order and a 30006 USDT reduce-only exit
- **THEN** the ticket states `146896 USDT` as `On order` directly under `Available`, the reduce-only leg included even though the exchange holds no margin against it

#### Scenario: Nothing is resting
- **WHEN** the order list is synchronized and empty
- **THEN** the ticket states zero, which is a reading rather than a gap

#### Scenario: Orders have not synchronized
- **WHEN** no confirmed order snapshot exists
- **THEN** the total is absent, exactly as the available balance is when unread, and is not shown as zero

### Requirement: Transport bounds are derived from the payload they carry
Every bound that a workstation event must satisfy to be delivered and read —
its byte ceiling, the parser's node budget, and the level count the payload
rules accept — SHALL be derived from a single statement of how much book is
delivered, rather than written independently. Exceeding any of these bounds
stops the resource entirely instead of degrading it, so the bounds SHALL be
proven against the widest payload the rules call legal rather than against a
representative one.

#### Scenario: The deepest legal book is delivered
- **WHEN** an event carries a full book at the longest decimals and identities the payload rules accept
- **THEN** it is within the byte ceiling and is parsed to completion, rather than being refused for size or for resource limits

#### Scenario: The delivered depth is changed
- **WHEN** the number of levels delivered per side is changed
- **THEN** the payload validator's bound and the parser's node budget follow it without a second edit

### Requirement: How a contract's book is read is remembered per contract
The side mode and the grouping step SHALL be stored against the contract they
were chosen for and restored when that contract is selected again, including
after a restart. They SHALL NOT be stored as one setting shared by every
contract: the step is a multiple of the contract's own tick, so the same
multiplier is a different share of price on a different contract and would
carry a book-collapsing step from one to the next. A contract with nothing
stored SHALL open at both sides and 1×.

Stored values SHALL be validated on read exactly as fresh operator input is: a
side mode that is not one of the three, or a step that is not one of the
contract's multipliers, SHALL fall back to the default rather than be applied.
The store SHALL be bounded, so a desk that has watched many contracts cannot
grow it without limit.

#### Scenario: Operator returns to a contract
- **WHEN** the operator selects a contract for which a side mode and step were previously chosen
- **THEN** the book opens with that side mode and that step, without being re-dialled

#### Scenario: Operator returns after a restart
- **WHEN** the application is restarted and that contract is selected again
- **THEN** the same side mode and step are restored

#### Scenario: Contract has nothing stored
- **WHEN** a contract is selected for the first time
- **THEN** the book opens at both sides and 1×, and the choice made for another contract does not carry over

#### Scenario: Stored entry is unusable
- **WHEN** the stored value is malformed, or names a step multiplier the contract does not offer
- **THEN** the default is used and the unusable entry changes nothing on screen

#### Scenario: Store reaches its bound
- **WHEN** more contracts have been configured than the store holds
- **THEN** the least recently written entries are dropped rather than the store growing without limit

### Requirement: The order book marks its heaviest levels
The order book SHALL mark the five levels resting the most USDT on each visible
side, ranked over exactly the levels on screen so that changing the grouping
step or the side mode re-ranks with them. The mark SHALL apply to the size cell
alone: the level's price and its cumulative total SHALL read the same on a
marked level as on any other.

Levels resting an equal size SHALL be marked alike, and a side holding no more
levels than there are marks SHALL carry none, because marking every row states
nothing.

#### Scenario: A side holds a few heavy levels
- **WHEN** a visible side holds ten levels, five of which rest far more USDT than the others
- **THEN** those five have their size cell thickened, and their price and cumulative cells are unchanged

#### Scenario: Two levels rest the same size
- **WHEN** the fifth and sixth heaviest levels rest the same USDT
- **THEN** both are marked, rather than one being chosen over its equal

#### Scenario: The visible side is short
- **WHEN** a side shows no more levels than there are marks
- **THEN** no level is marked

#### Scenario: The operator regroups the book
- **WHEN** the grouping step changes which levels are on screen
- **THEN** the marks are recomputed over the levels now displayed

### Requirement: The contract list keeps its rows at their own height
Every row of the instrument rail's contract list SHALL be drawn at the height its
own content needs, whatever the length of the list and whatever height the panel
around it has been given. A list longer than its panel SHALL scroll; it SHALL NOT
be fitted by compressing its rows.

The list SHALL keep a floor of readable rows next to the execution ticket. Where
the two together exceed the column, the column SHALL scroll rather than the list
being reduced to nothing.

#### Scenario: The catalogue is longer than the panel
- **WHEN** the rail lists the whole contract catalogue in a panel that can show only a few rows
- **THEN** each row keeps the height of its own content and the list scrolls to reach the rest

#### Scenario: The ticket beside it is tall
- **WHEN** the execution ticket grows past the height the column has left
- **THEN** the contract list keeps at least three readable rows and the column scrolls

### Requirement: The instrument rail is sized for the rows it carries
The instrument column SHALL be wide enough for a working-order row in the ticket
to state its contract, its side, its price and what it is worth in USDT without
any of them being cut, for the contracts and amounts this desk actually holds.
Where a reading still cannot fit, it SHALL be shortened by the rules that already
govern a sliced reading rather than by narrowing the column further.

#### Scenario: Working orders rest on several contracts
- **WHEN** the ticket lists working orders whose prices run to five significant digits and whose values run to six
- **THEN** every row states its price and its USDT value whole, with neither ellipsized

### Requirement: Chart annotations are drawn under the weight of the candles
Labels the chart puts on its own plotting area — the order handles and what they
are worth, the titles of the entry, liquidation, alert and drawing lines, and the
plates those lines put on the price scale — SHALL be drawn smaller than the desk's
body text, so that a contract carrying a position and several working orders is
still read as price action rather than as a stack of labels.

#### Scenario: A position and its working orders are on screen
- **WHEN** the chart draws the order handles and the entry and liquidation lines of an open position
- **THEN** their text is drawn at a reduced size rather than at the size the surrounding desk is set in

### Requirement: A public read waits for its budget rather than failing
Public market reads SHALL be paced by a local weight window. A read the window
has no room for SHALL be delayed until the window frees the weight it needs and
then issued, rather than refused. A read SHALL be refused for want of weight
only when no room appears within one window; that refusal SHALL name itself, and
SHALL NOT be reported as a market-data failure of the exchange.

#### Scenario: The window is full when a contract is selected
- **WHEN** the operator selects a contract while the window holds no room for the reads that contract needs
- **THEN** each read is issued as soon as the window frees the weight it needs, and the workspace reaches `live` without resynchronizing

#### Scenario: The operator moves on while a read is waiting
- **WHEN** a read is waiting for room and the selection it belongs to is abandoned
- **THEN** that read is dropped without being issued, and it holds no room in the window

#### Scenario: No room appears within a window
- **WHEN** a read would have to wait longer than one whole window for its weight
- **THEN** it is refused, and the refusal states that the local read budget, not the exchange, is what refused it

### Requirement: The read budget admits the work a session actually does
The local weight ceiling SHALL be stated against what the desk's own operations
cost, and SHALL admit a session's ordinary work — repeated contract switches and
the book recoveries a thin contract needs — within one window. The ceiling and
the account reader's ceiling together SHALL stay below the allowance the
exchange gives one address.

#### Scenario: The operator browses contracts
- **WHEN** the operator selects twenty contracts inside one window
- **THEN** every selection's reads are admitted, none of them waits, and none is refused

#### Scenario: The desk's ceilings against the exchange's
- **WHEN** the public-read ceiling and the account reader's ceiling are both at their maximum in one window
- **THEN** their sum is below the weight the exchange allows one address in that window

### Requirement: The book is bought at the page the reading needs
The depth snapshot SHALL be requested at the smallest page the exchange prices
that covers the range the book is being read at — the rows on screen multiplied
by the grouping step. Every contract SHALL be opened at the largest page the
exchange charges its lowest weight for, and a reading that needs a wider range
SHALL take the page that covers it in one read rather than climbing to it. The
range SHALL be stated by the panel that draws the rows, and a range stated for
one contract SHALL NOT be carried to another — it is a distance in the
contract's own quote currency, and means nothing in another's.

#### Scenario: A contract is opened at the default step
- **WHEN** the operator selects a contract and reads its book at the finest step
- **THEN** the snapshot is taken at the cheapest page that covers the rows on screen, not at the deepest page the exchange offers

#### Scenario: The operator coarsens the step
- **WHEN** the operator selects a grouping step whose rows span a wider range than the current snapshot proved
- **THEN** a deeper snapshot is taken and bridged, and the rows are drawn from it

#### Scenario: Another contract is opened
- **WHEN** the operator switches to a contract priced differently from the one being left
- **THEN** its book is bought at the cheapest page, and only the range its own rows need deepens it

#### Scenario: The panel states its reading before the book exists
- **WHEN** the panel states the range its rows need before the subscription that will carry the book has been established
- **THEN** the range reaches that subscription once it exists, rather than being lost with the one it was stated against

### Requirement: The book states the band it can prove
A snapshot proves a band of prices: within it every level is either from the
snapshot or from a diff applied since, and outside it only the levels a diff has
touched are known. The book SHALL record that band and SHALL deliver only levels
within it, so that no row aggregates a range the book cannot account for. When
the market leaves the band, the band SHALL be re-established by a fresh snapshot
rather than by extending the book past what it can prove.

#### Scenario: A diff touches a level outside the band
- **WHEN** a depth diff carries a level beyond the range the snapshot covered
- **THEN** the delivered book does not present it, because the levels beside it are unknown

#### Scenario: The market moves past the band
- **WHEN** trading moves the best price far enough that the proven band no longer covers the rows on screen
- **THEN** a fresh snapshot is taken and bridged, and the rows are drawn from the new band

#### Scenario: The band was wide enough and the market simply moved
- **WHEN** the band no longer covers the rows but its span is wider than they need
- **THEN** the page already held is read again rather than a deeper one bought, so a drifting market cannot climb the desk to the deepest page

#### Scenario: The market moves past a band bought at the deepest page
- **WHEN** the best price leaves a band read at the deepest page the exchange publishes
- **THEN** that page is read again, centred where the market is now, rather than the book going on dropping the levels it can no longer prove

#### Scenario: A grouped row would span unproven ground
- **WHEN** the rows on screen would need more range than the band proves
- **THEN** the panel shows the rows it can prove until the deeper snapshot lands, rather than rows built on partial levels

### Requirement: Releasing a contract releases all of it
Stopping a Futures workstation session SHALL release every resource it holds —
its upstream sockets, its order book, its freshness, reconnect and
interval-reconnect timers, and its queued events — and SHALL complete that
release even when one of those steps fails. A failure in one step SHALL NOT
prevent the others, and SHALL be reported rather than raised to the caller.

#### Scenario: A socket is still connecting when the contract changes
- **WHEN** the operator selects another contract while an upstream socket has not finished its handshake
- **THEN** the session is released in full, no exception escapes the release, and the socket does not remain open

#### Scenario: A timer outlives its session
- **WHEN** a reconnect or freshness timer of a released session fires
- **THEN** it performs no work, because the session it belonged to is no longer current

### Requirement: A contract switch starts the contract that was asked for
A request that selects another contract SHALL start that contract's session even
when releasing the previous one reported a failure. The desk SHALL NOT be left
with the previous contract's data, with no session at all, or with the local
connection torn down.

#### Scenario: The previous session fails to release cleanly
- **WHEN** releasing the previous contract reports a failure and the operator has asked for another contract
- **THEN** the new contract's session is started and the failure is reported as a diagnostic, not as a refusal of the request

#### Scenario: The operator switches contract repeatedly
- **WHEN** the operator selects several contracts in quick succession
- **THEN** only the last selection delivers data, and no frame of an earlier selection reaches the desk after it

### Requirement: A burst of market data does not end the market data
An upstream frame that exceeds the desk's frame ceiling SHALL NOT terminate the
session it arrived on. The desk SHALL keep delivering depth, trades, header and
candles across such a frame, recovering whatever state the dropped frame carried
without a full resynchronization of the workspace.

#### Scenario: A depth frame exceeds the ceiling during a sharp move
- **WHEN** a depth frame larger than the ceiling arrives on a live session
- **THEN** the session stays live and the book is recovered, rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: A stream genuinely disconnects
- **WHEN** an upstream socket closes for any reason other than a frame this desk refused
- **THEN** the session resynchronizes as it does today

### Requirement: A resynchronization names its cause
A resynchronization SHALL carry a reason that distinguishes a connection lost by
the exchange, a connection this desk closed on its own rule, and a resource that
went stale without a close.

#### Scenario: The desk closed the connection itself
- **WHEN** the desk terminates a stream because of its own limit
- **THEN** the reason shown to the operator names that limit rather than reporting a plain socket disconnect

#### Scenario: The desk refused a frame and kept the stream
- **WHEN** the desk drops an upstream frame that exceeds its own ceiling
- **THEN** the refusal is named on the workspace's reason line under a code of its own, the session stays live, and a burst of such frames is stated once rather than once per frame

### Requirement: The workspace fits the window it is given
The Futures workspace SHALL lay out within the height and width of its window
without the page itself scrolling, at every window size the desk supports. A
panel that cannot show all of its content SHALL reduce what it shows rather than
clip it behind a scrollbar it does not own.

#### Scenario: A short window
- **WHEN** the workspace is rendered in a window shorter than its preferred layout
- **THEN** the page does not scroll, and every panel remains readable at the reduced size

### Requirement: No panel is drawn over another
Every panel of the workspace SHALL be contained within the area the layout gives
it. No panel SHALL declare a minimum size that the layout cannot satisfy, and no
panel's content SHALL be painted across the panel below or beside it, at any
window size the desk supports.

#### Scenario: The window leaves the order book less height than it prefers
- **WHEN** the window is short enough that the order book's preferred height does not fit its row
- **THEN** the book shows fewer levels within its own area, and nothing of it is drawn over the aggregate-trade tape

#### Scenario: A table is wider than the panel holding it
- **WHEN** a portfolio dock table's columns need more width than its panel has
- **THEN** the table's own tracks are what give way, and the panel itself neither scrolls nor overflows

### Requirement: The market header never hides the contract's numbers
The market header SHALL present the last price, the day's change, high, low and
volume, and the funding readings, without any of them being placed outside the
visible area of the header.

#### Scenario: The header is given less height than its content prefers
- **WHEN** the grid gives the header less height than its content
- **THEN** the header's values remain visible, and the header does not scroll

### Requirement: Scrolling belongs to the unbounded lists
Only the contract list, the aggregate-trade tape and the portfolio dock's tables
SHALL scroll. The instrument rail as a whole, the trading ticket, the market
header, the chart column and the order book SHALL NOT introduce a scrollbar of
their own.

#### Scenario: The rail holds more than fits
- **WHEN** the contract list is longer than the rail is tall
- **THEN** the list scrolls inside itself and the trading ticket below it stays in place

### Requirement: The shared market rail prioritizes the order book
At supported desktop window sizes where the order book and aggregate-trade tape
share one vertical market rail, the workstation SHALL allocate 65 percent of
their combined panel height to the order book and 35 percent to the tape. The
split SHALL remain stable as live rows arrive, disappear, or update, and neither
panel SHALL paint or scroll into the other's allocation.

#### Scenario: Desktop market rail is laid out
- **WHEN** the workstation renders the order book above the aggregate-trade tape in their shared desktop rail
- **THEN** the order-book panel receives 65 percent and the tape receives 35 percent of the height allocated to the pair, excluding only the separator between them

#### Scenario: Live market data changes row counts
- **WHEN** book levels or aggregate trades arrive, update, or disappear
- **THEN** the 65/35 panel split remains unchanged and each panel contains its own rows

### Requirement: Market-data and portfolio scrollbars stay compact
The aggregate-trade list and every scrollable portfolio-dock table SHALL use a
workstation-themed scrollbar whose vertical width and horizontal height are no
greater than 6 CSS pixels. The track SHALL not introduce light native chrome or
arrow buttons, while the thumb SHALL remain visibly distinct from the track and
gain emphasis on hover. Styling SHALL preserve wheel, touchpad, keyboard, thumb
dragging, and any required horizontal scrolling behavior.

#### Scenario: Aggregate trades overflow vertically
- **WHEN** the aggregate-trade list contains more rows than its 35-percent panel allocation can show
- **THEN** it remains vertically scrollable through a compact scrollbar no wider than 6 CSS pixels, without native arrow-button chrome

#### Scenario: A portfolio table overflows
- **WHEN** a positions, working-orders, or history table exceeds its available vertical or horizontal space
- **THEN** each required axis remains scrollable through compact workstation-themed chrome no thicker than 6 CSS pixels

#### Scenario: Operator points at the scrollbar thumb
- **WHEN** the pointer hovers a compact scrollbar thumb
- **THEN** the thumb becomes more prominent without changing the list's dimensions or scroll position

