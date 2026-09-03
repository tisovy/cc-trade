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

The backend SHALL enforce this independently of the renderer. A market-scoped
trading command, subscription or refresh SHALL be accepted only while that
market is the activated one; one arriving before activation, or after the
operator has switched away, SHALL be rejected with a stable bounded reason and
SHALL start no subscription, refresh, timer or stream. Every market-scoped
request SHALL carry the activation generation it was issued under, and a
request from a superseded generation SHALL be discarded rather than applied.

The stamp belongs to the transport envelope and SHALL NOT alter the request a
channel defines: a channel that validates its own request shape SHALL receive
the request without the stamp. Acknowledging an activation SHALL NOT by itself
cause another activation to be requested.

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

#### Scenario: Command arrives before activation
- **WHEN** a market-scoped command or subscription reaches the backend before that market has been activated
- **THEN** it is rejected with a stated reason and no work starts for that market

#### Scenario: Command arrives after switching away
- **WHEN** a market-scoped command reaches the backend after the operator switched to the other market
- **THEN** it is rejected as belonging to a market that is no longer active

#### Scenario: Child effects run ahead of activation on a warm switch
- **WHEN** a previously loaded workspace is selected again and its child effects schedule refresh or subscribe work
- **THEN** none of that work reaches the backend before the parent activation has been accepted

#### Scenario: A superseded generation returns late
- **WHEN** a market-scoped request issued under an earlier activation returns after the operator has switched
- **THEN** its result is discarded and does not alter the current market's state

#### Scenario: A market is returned to after leaving it
- **WHEN** the operator selects Spot, switches to Futures, returns to Spot, and a Spot frame issued before the first switch arrives afterwards
- **THEN** the frame is refused, because it belongs to a superseded activation even though it names the market that is active again

#### Scenario: The transport reconnects
- **WHEN** the local transport drops and reconnects
- **THEN** no market is treated as activated until the new connection acknowledges an activation, and no market-scoped frame is sent before that acknowledgement

#### Scenario: Two activations are requested in quick succession
- **WHEN** two `activate_market` frames arrive before the first has finished being applied
- **THEN** they are applied in the order received and the backend settles on the market the later frame requested

#### Scenario: A frame the transport builds for itself
- **WHEN** a channel subscription or unsubscription is issued while a market is activated
- **THEN** it carries the activation exactly as a frame composed by a caller does

#### Scenario: A stamped request reaches a channel that validates its own shape
- **WHEN** a request for a channel that accepts an exact set of keys is issued under the current activation
- **THEN** the channel receives the request it defines and serves it, while a request issued under a superseded activation is still refused before the channel sees it

#### Scenario: An activation is acknowledged
- **WHEN** the backend acknowledges an activation with its generation
- **THEN** nothing in the renderer's send path changes identity because of it, so no further activation is requested

### Requirement: A connect that outlives its cleanup does not revive a channel
A channel connection attempt that resolves after its channel was cleaned up
SHALL be discarded and closed. Cleanup SHALL leave no live socket, no
reconnect timer, and no handler that can deliver into torn-down state.

#### Scenario: Cleanup happens during an in-flight connect
- **WHEN** a Spot channel is cleaned up while its connect is still pending and the connect then succeeds
- **THEN** the resulting socket is closed and discarded rather than adopted

#### Scenario: Market is switched during a connect
- **WHEN** the operator switches markets while a channel connect is pending
- **THEN** the pending connect cannot deliver data or restart itself for the market that is no longer active

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
The workstation SHALL persist recently selected contracts, favourites, and the
last selected contract. It SHALL restore the last selected contract on startup
and SHALL order the contract catalogue by recency, then favourites, then
alphabetically.

The history SHALL read the same identity alphabet the workstation protocol
selects by — uppercase, titlecase and caseless letters and numbers, with the
dated delivery-contract form — so any contract the operator can stand on is a
contract the history can hold. A history narrower than the protocol reopened
the previous ASCII pair on every remount while the operator worked a CJK
listing (龙虾USDT, 2026-08-28).

#### Scenario: Operator reopens the workstation
- **WHEN** the operator restarts the application after trading a contract
- **THEN** that contract is selected again instead of a hard-coded default

#### Scenario: Catalogue is displayed
- **WHEN** the contract list is rendered
- **THEN** recently traded contracts appear first in the single contract list, without a second strip repeating the same entries

#### Scenario: The operator was standing on a CJK listing
- **WHEN** the workspace remounts — a restart, an activation flap, a reconnect — while a CJK-ticker contract is selected
- **THEN** the workstation reopens that contract, not the previously selected ASCII pair

### Requirement: Interface scale is adjustable and persisted
The workstation SHALL express its type sizes against a persisted interface scale
from 70% through 160% in five-percentage-point steps, expose controls to decrease,
reset, and increase that scale, and keep 100% as the reset value. It SHALL
additionally provide persisted window-level zoom shortcuts for surfaces outside
that scale.

#### Scenario: Operator reduces the interface below the previous floor
- **WHEN** the operator repeatedly decreases the interface scale from 85%
- **THEN** the workstation offers 80%, 75%, and 70%, stops at 70%, and persists the selected value across a restart

#### Scenario: Operator enlarges the interface
- **WHEN** the operator increases the interface scale
- **THEN** every futures surface grows proportionally and the choice survives a restart

#### Scenario: Operator resets the interface scale
- **WHEN** the operator activates the scale reset control from any supported value
- **THEN** the interface returns to 100% and persists that value

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

The steps offered SHALL end at the coarsest one whose rows fit inside the reach
the book states, and the finest SHALL always be offered. A step whose rows would
ask for more book than the desk holds SHALL NOT be offered: it draws the same
levels over fewer filled rows, which is the same reading at lower resolution and
reads as the book ending early. The cut SHALL be made against the
narrower of the two sides, so neither side is asked for rows that cannot be
filled. While the book states no reach the whole ladder SHALL be offered, so a
contract whose page can still be deepened can be asked to deepen it.

The ladder SHALL be spaced closely enough that the cut lands near the reach
rather than well short of it, and SHALL be stated in multiples of the contract's
tick so a step can never fall between two tradable prices.

A step remembered for a contract that the ladder no longer offers SHALL be drawn
at the coarsest step it does offer, and SHALL be left as it is in what is
remembered. A reach that narrows for a moment then costs the operator a redraw
rather than a setting.

The panel SHALL state the reach where the step is chosen, as a share of price, so
that how far the book goes is read rather than inferred.

Grouping SHALL be applied before delivery, and the book SHALL cross to the
renderer as the rows the panel draws rather than as the levels behind them. The
panel states the step and the row count that define those rows, so both sides
already agree on what a row is; the grouping is one exact-decimal pass either
way, and forty rows are a fraction of the bytes of a thousand levels.

Grouping before delivery is what makes a coarse step drawable at all once the
book reaches far. Bounded as levels, a delivery has to choose which of them to
carry, and choosing the nearest — the only choice that keeps the rows next to the
mid correct — returns a dense cluster around the best price and nothing at the
far rows, on exactly the reading the operator coarsened the step to take. Bounded
as rows, there is nothing to choose: every row the panel draws is carried.

A session that has not been told a step and a row count SHALL be delivered
ungrouped to the protocol ceiling, so a book is never short because the panel has
not spoken yet. The bound the payload validator enforces SHALL be the same value
the book is built to, so a book that is legal to build is never rejected on
arrival.

A reading the panel states SHALL be answered from the book already held rather
than at the next delivery the market happens to produce. The trim is on delivery
and never on what is retained, so a coarsened step needs no read and no wait; a
book left trimmed to the previous reading until the next diff arrives would
answer a quiet contract — the one most likely to be read at a coarse step — not
at all.

A delivered row SHALL carry the price of its bucket, the resting quantity in it,
the value that quantity is worth, and the key by which a working order resting
anywhere inside the bucket is matched to it. The value SHALL be the sum of price
times quantity over the levels in the bucket rather than the bucket's boundary
times the summed quantity, which is what the panel computes today and is the
only one of the two that is right.

A delivered row SHALL NOT carry a running total: the cumulative column depends on
which rows are on screen and on which sides are shown, both of which the panel
knows and the book does not.

A delivery SHALL name the step its rows were grouped by, and the panel SHALL
match a working order to a row using that step rather than the step it last
asked for. A reading is stated and answered a delivery later, so between the two
the rows on screen belong to the previous step; a key computed at the new one
matches a bucket nothing was grouped into, and every mark leaves the row it
belongs to for as long as the desk takes to answer.

#### Scenario: Operator reads a level
- **WHEN** a level rests at a price with a base quantity
- **THEN** the row shows the price, the level's value in USDT, and the cumulative value in USDT from the top of the book

#### Scenario: Operator groups the book
- **WHEN** the operator selects a price step that is a multiple of the contract tick size
- **THEN** levels within one step are aggregated into a single row whose price is the step boundary on that side, and their USDT values are summed

#### Scenario: A coarser step has been asked for and not yet answered
- **WHEN** the operator coarsens the step while the rows on screen are still those of the previous one
- **THEN** a working order stays marked on the row it rests in, and moves only when the rows it is matched against do

#### Scenario: Contract has no usable tick size
- **WHEN** the contract's filters have not arrived
- **THEN** the book renders ungrouped at exchange precision instead of failing

#### Scenario: A coarse step is selected
- **WHEN** the operator selects a step of 25 or 50 ticks and the exchange has published enough levels to reach it
- **THEN** every visible row is filled from delivered levels, rather than the book appearing to end a fraction of a percent from the mid

#### Scenario: The book reaches the end of what the exchange publishes
- **WHEN** the selected step would need levels at prices the exchange has never published, in a snapshot or in a diff
- **THEN** the rows that can be filled are filled and the remainder are absent, and no level is invented

#### Scenario: The panel reads a narrow range
- **WHEN** the panel has stated a step and a row count that a fraction of the retained book covers
- **THEN** the delivered book carries exactly those rows on each side, and the levels beyond them are retained in the main process rather than sent

#### Scenario: The panel widens its reading
- **WHEN** the operator coarsens the step so the rows span further than the last delivery carried
- **THEN** the deeper levels are delivered from the book already held, without a fresh snapshot and without waiting for the next diff, because the trim was on delivery and never on what was retained

#### Scenario: The book is read ungrouped on a sparse contract
- **WHEN** the panel draws each raw level as its own row and the levels resting on the contract span further than the stated range
- **THEN** the delivery keeps the floor of levels under that range, so no row the panel can draw is missing

#### Scenario: A book is delivered before the panel has stated its reading
- **WHEN** the first book of a session is delivered and no reading has been stated for the contract
- **THEN** it is delivered ungrouped to the protocol ceiling, so no row the panel is about to ask for is missing

#### Scenario: A delivered level is read
- **WHEN** the renderer reads a row out of a delivered book, which is what a level has become on the wire
- **THEN** it finds the bucket's price, its resting quantity, its value and its key, and computes the cumulative column itself from the rows on screen

#### Scenario: One order rests far past the rest of a side
- **WHEN** a side holds a resting order much further from the market than the levels behind it
- **THEN** the stated reach is not stretched to it, and the ladder is cut where the side still has levels to fill rows from

#### Scenario: A side has too few levels to leave any out
- **WHEN** the share to be left outside the reading rounds down to no levels at all
- **THEN** the side is measured to its own furthest level

#### Scenario: A coarse step reaches past the levels nearest the mid
- **WHEN** the operator selects a step whose rows span further than a thousand levels of the book reach
- **THEN** every row is filled from the levels resting inside it, rather than the near rows being filled and the far ones left blank by a delivery that could carry only the nearest levels

#### Scenario: The coarsest step is offered on a contract whose held book ends early
- **WHEN** the book states a reach that the second-coarsest rung fits inside and the coarsest does not
- **THEN** the coarsest rung is not offered, and the step above it is the last one the operator can select

#### Scenario: No reach has been stated yet
- **WHEN** the book has been delivered from a page the exchange offers a deeper one than
- **THEN** every rung of the ladder is offered, so the operator can select the step that buys the deeper page

#### Scenario: The two sides reach differently
- **WHEN** one side of the page proved further than the other
- **THEN** the ladder is cut against the narrower side, so neither half of the panel is asked for rows that cannot be filled

#### Scenario: A remembered step is past the end of the ladder
- **WHEN** a contract is opened at a step stored from a reading whose reach was wider than the current one
- **THEN** the book is drawn at the coarsest step now offered, and the stored step is left as it is

#### Scenario: The operator reads how far the book goes
- **WHEN** the book states a reach
- **THEN** the panel states it as a share of price beside the step control, and states nothing there while no reach has been stated

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

A disclosed reason SHALL be readable in full: at desktop widths the market-mode
switch overlay SHALL NOT cover any part of the reason code, and the identity bar
SHALL give the reason room below the switch's extent rather than flowing it
through the centre span the switch hangs over.

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

#### Scenario: The desk degrades at a mid-width window
- **WHEN** the workspace is 1366px wide and a degradation reason is shown
- **THEN** the mode switch does not cover any part of the reason code, which sits fully visible below the switch's extent

### Requirement: The last traded price has a source the tape cannot filter
The last-print row between the two book sides, the market header's `Last`, the
grouping step's share-of-price readout and the reference the pressure reach is
measured against SHALL all read one resolved last traded price. That price SHALL
be taken from the newest print the contract made, delivered on a path the tape's
own display settings do not stand in — the minimum displayed notional and the
throttle timeout decide what the tape shows and SHALL NOT be able to hold the
price still. It SHALL fall back to the newest live candle's close, which is the
same figure at the kline stream's cadence, and only then to the newest displayed
trade.

A print SHALL NOT restate the price more often than the operator can read it,
and SHALL NOT be taken as proof that the mark, the funding and the rest of the
header beside it are current — a contract can print while its mark feed is dead.

#### Scenario: Tape filter excludes every recent print
- **WHEN** the operator's minimum displayed trade excludes the prints that are actually trading, so the tape delivers no new row
- **THEN** the last traded price keeps moving with those prints, which the filter never applied to

#### Scenario: Prints arrive faster than they can be read
- **WHEN** a burst of prints arrives inside one repaint window
- **THEN** the price is restated once for the window rather than once per print

#### Scenario: No print has arrived for the contract
- **WHEN** no print has been delivered for the selected contract
- **THEN** the newest live candle's close is shown, which is the same last traded price at the kline stream's cadence

#### Scenario: Candles are not live
- **WHEN** no print has arrived and no live candle is available for the selected interval
- **THEN** the newest displayed trade is shown, the tape being the last resort rather than the first

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

Where a cell states a word the exchange reported — a status, an order type — and
its track cannot hold that word, the desk SHALL state a form that fits and SHALL
carry the exchange's own word on the element. A word cut to an ellipsis with
nothing on the element is not a reading.

#### Scenario: A uPnL and its ROE together outgrow the column
- **WHEN** an unrealized PnL and the ROE beside it are wider than the column allows
- **THEN** the percentage is shown whole, the amount gives way with an ellipsis, and both figures are stated exactly in the cell's title

#### Scenario: A five-figure amount is reported beside its percentage
- **WHEN** a position's unrealized PnL reaches five figures and two decimals
- **THEN** both the amount and its percentage are shown whole, with neither shortened

#### Scenario: A history table has more readings than width
- **WHEN** the closed-position history cannot fit every reading in the dock's width
- **THEN** the realized PnL keeps its column and the fee is stated in that cell's title together with the net

#### Scenario: An exchange word is wider than its track
- **WHEN** a status or order type the exchange reported is wider than the track it is shown in
- **THEN** the cell states a form that fits its track and carries the exchange's own word on the element

### Requirement: The rail marks the contracts recently worked with
The instrument rail SHALL present contracts the operator has recently selected
as a stable three-column group of compact pills rather than as full-width
contract rows or rows carrying a `recent` suffix. The group SHALL preserve
most-recent-first order across an app restart, and each row SHALL hold three
equal-width pill slots at the instrument rail's supported workstation width.
Long symbols SHALL remain within their slot and expose their full value without
changing the grid tracks or replacing any visible characters with truncation.

Each pill SHALL expose contract selection and removal as separate accessible
controls and SHALL disclose which contract is selected. Removing an inactive
pill SHALL remove only that symbol from persisted recency: it SHALL NOT select a
different contract or change the symbol's persisted favorite state. The selected
contract's remove control SHALL remain unavailable until another contract is
selected so the active market remains represented in the rail. Favorite state
SHALL remain manageable from the searchable catalogue rather than from a recent
pill. When no persisted recent contract exists, the workstation's active starting
contract SHALL seed the group so the retained idle list is never absent on a
fresh installation.

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
- **WHEN** the rail has at least six ordinary-length recent USDⓈ-M symbols and no search query
- **THEN** the symbols occupy two rows of three equal-width pills instead of three or more two-pill rows

#### Scenario: A long recent symbol is shown
- **WHEN** a recent symbol is wider than its one-third rail slot
- **THEN** its full value wraps within that slot, the row grows as needed, and no character is hidden or replaced by an ellipsis

#### Scenario: Search is empty
- **WHEN** the search field has no query
- **THEN** the rail renders the recent-pill group without a second ordinary catalogue list beneath it

#### Scenario: A recent contract is selected
- **WHEN** the operator activates a recent-contract pill
- **THEN** that contract becomes selected and the pill discloses the selected state

#### Scenario: An inactive recent contract is removed
- **WHEN** the operator activates the remove control on an inactive recent-contract pill
- **THEN** that pill disappears, the persisted recency list omits its symbol, the current contract remains selected, and the symbol's favorite state is unchanged

#### Scenario: The active recent contract is protected
- **WHEN** the operator reads the remove control on the selected contract's pill
- **THEN** the control is unavailable and identifies that the active contract cannot be removed until another contract is selected

#### Scenario: A recent favorite is toggled
- **WHEN** a recent contract appears in the unified search results and the operator activates its favorite control
- **THEN** that contract's persisted favorite state changes without selecting a different contract or restoring a removed recent pill

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
- **WHEN** recent pills occupy additional rows and the execution ticket still leaves unused space below it
- **THEN** the recent-pill group expands to show those rows without an internal vertical scrollbar

#### Scenario: Recent pills exhaust the rail height
- **WHEN** showing every recent-pill row would leave insufficient height for the execution ticket within the rail
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
and leverage, selected price, percentage slider, editable USDT notional,
decision-relevant account summary, and manual order actions without a separate
readiness/pause header. The sizing block SHALL show its highlighted percentage
immediately after the `Notional, USDT` label, SHALL use the editable notional
field as its only live USDT amount readout, and SHALL render that input value in
larger bold type. It SHALL NOT repeat the notional beside the size slider.

The percentage slider SHALL cover zero through one hundred percent in `0.5`
percentage-point increments. Integer stops SHALL be displayed without a trailing
decimal and half stops SHALL be displayed with `.5`; every selected percentage
SHALL continue to produce a whole-USDT notional.

When a valid shortcut order reaches confirmation, the confirmation popup SHALL
also present a compact zero-through-one-hundred-percent slider in `0.5`
percentage-point increments. For an entry, one hundred percent SHALL represent
the current available-USDT sizing capacity. For an exit, one hundred percent
SHALL represent the matching open position valued at the staged price. The
confirmation slider SHALL update only the staged whole-USDT notional, exact
exchange-quantized quantity, and projected position; it SHALL NOT submit an
order until the operator activates `Send`. The confirmation's displayed USDT
size SHALL use bold weight so the amount being approved remains visually
prominent beside the compact slider.

If the required confirmation sizing reference is unavailable, only that slider
SHALL be disabled and the already staged order SHALL remain confirmable under
the existing live readiness checks. If a slider stop produces a draft below an
exchange minimum, the popup SHALL show the existing contextual draft reason and
disable `Send` until the operator chooses a valid stop or cancels.

The ticket SHALL NOT present a `READY` label or routine readiness reason, an
operator `Pause trading` or `Resume trading` control, a passive shortcut/action
label, percentage anchor buttons, a derived `Quantity` summary row, the
mouse-shortcut legend, successful submission or cancellation acknowledgements,
or a passive last-execution card.

Removing or rearranging that chrome SHALL NOT change sizing, exchange-filter
quantization, confirmation, pause enforcement, or command handling. The exact
derived quantity SHALL remain visible in the confirmation that precedes a send.
When an action is blocked, not sent, rejected, or has an unresolved outcome, the
ticket SHALL still present the contextual reason; account synchronization
failures SHALL remain visible with their valid retry path. Passive success
removal SHALL NOT remove any of those safety-critical messages.

#### Scenario: Operator opens a ready ticket
- **WHEN** the live account and selected contract satisfy the order-entry gates
- **THEN** the ticket shows the slider and order controls without `READY`, a pause control, percentage anchors, `Quantity`, shortcut help, passive status cards, or a duplicate USDT readout beside the slider

#### Scenario: Operator sizes with the slider
- **WHEN** the operator changes the percentage slider from `8%` to `8.5%`
- **THEN** the highlighted readout after `Notional, USDT` shows `8.5%`, the bold input shows the corresponding whole-USDT amount, and the order draft uses that amount

#### Scenario: Operator types a notional
- **WHEN** the operator edits the USDT notional directly
- **THEN** that larger bold input remains the single visible sizing amount and the highlighted percentage beside its label updates without adding another amount above the slider

#### Scenario: Order reaches confirmation
- **WHEN** an order action stages a valid draft
- **THEN** the confirmation states the exact exchange-quantized quantity, renders its USDT size in bold, and presents a compact synchronized percentage slider even though the ticket summary omits its `Quantity` row

#### Scenario: Operator resizes a staged entry
- **WHEN** the operator moves an entry confirmation slider to `37.5%`
- **THEN** the popup shows the whole-USDT amount and exact quantity for `37.5%` of current available capacity, and `Send` submits that updated staged quantity

#### Scenario: Operator resizes a staged exit
- **WHEN** the operator moves an exit confirmation slider to `50%` while the matching position is available
- **THEN** the popup shows half of that position at the staged price, updates the projected position, and keeps the order unsent until `Send`

#### Scenario: Confirmation sizing reference is unavailable
- **WHEN** the staged action's current available balance or matching position cannot be established
- **THEN** the confirmation slider is disabled while the already staged order and existing live readiness checks remain authoritative

#### Scenario: Confirmation slider selects an invalid draft
- **WHEN** a confirmation slider stop produces a draft below an exchange minimum
- **THEN** `Send` is disabled with the existing contextual draft reason and no order command is emitted

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

### Requirement: An untouched zero-size ticket is not presented as an operational error
The Futures trading ticket SHALL distinguish an ordinary incomplete draft from an exchange, connection, account, or validation fault. When the selected price is usable but the operator has not chosen a positive order size, order actions SHALL remain disabled without showing an error-like draft notice. Actionable readiness and validation failures SHALL remain visible, and an attempted gesture or submission SHALL continue to explain why no order was sent.

#### Scenario: Price is selected before size
- **WHEN** a usable limit price is selected and the ticket size remains zero
- **THEN** the manual order actions are disabled and no draft-error notice is shown

#### Scenario: An operational prerequisite is unavailable
- **WHEN** the ticket is blocked by connection, contract metadata, an account failure, balance, pause, or risk-cap state
- **THEN** the corresponding actionable readiness reason remains visible

#### Scenario: A positive draft contains invalid input
- **WHEN** the operator has chosen a positive size but the limit price or entered size is invalid
- **THEN** the ticket shows a validation reason that describes invalid draft input rather than claiming that Binance filters are unavailable

#### Scenario: A gesture cannot be staged
- **WHEN** the operator attempts a chart gesture while the draft cannot be submitted
- **THEN** the ticket continues to state that the order was not sent and gives the blocking reason

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

### Requirement: The chart opens on enough history to read the market
Opening a contract or interval SHALL present substantially more than the live
streaming window of candles. The workstation SHALL request candle history once
that selection's live window is on screen, including when the chart mounted
before the window arrived, and SHALL present the history and the live window as
one continuous series ordered by open time, with no duplicated or missing bar
at the seam. A new contract or interval SHALL start a distinct chart session
whose initial viewport is fitted to that selection rather than inherited from
the series it replaced. Candle rows SHALL be shown only when both their contract
and interval own the current selection, and the series being replaced SHALL be
cleared before the browser paints the new selection.

#### Scenario: A contract is opened
- **WHEN** the contract's bootstrap completes and history is delivered
- **THEN** the chart shows the live window plus the requested history as one series, ordered by open time

#### Scenario: The chart mounts before the live window
- **WHEN** the chart is mounted with no candles and the selected contract's live window arrives later
- **THEN** the chart fits that window and requests its history without requiring an extra viewport event

#### Scenario: The interval changes
- **WHEN** a live chart replaces its selected interval with another interval whose candle window arrives after the selection
- **THEN** the replacement interval receives a fresh fitted viewport and its own initial history request

#### Scenario: A previous selection is still committed during an interval change
- **WHEN** the operator selects a new interval before the workstation state and candle window for that interval have committed
- **THEN** the chart shows no candles until the new selection owns its rows, and no frame displays candles from the selection being replaced

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
bars the operator is looking at in place rather than jumping the viewport. The
left-edge condition SHALL be re-evaluated whenever the oldest loaded candle
first appears or changes, so an asynchronously delivered live window and every
successfully prepended page remain loadable. Only one history request SHALL be
in flight at a time, and a request that can no longer be answered SHALL NOT
count as one: a read outstanding when the session behind it was rebuilt is not
travelling, and the renderer SHALL let it go rather than wait on it. When a
response returns fewer candles than requested, the chart SHALL treat that as
the start of the contract's history and SHALL stop requesting more. A read that
was not served SHALL NOT be treated as such a response: the chart SHALL
conclude that a contract's history has a start only from a page the exchange
actually sent, and a page the exchange sent SHALL be the only thing the
renderer takes for one — a resource restated under a state of the desk's own is
not a page, whatever it carries.

#### Scenario: The operator scrolls to the left edge
- **WHEN** the visible range reaches the oldest loaded candle and history is not exhausted
- **THEN** one request for the candles behind it is issued, and the prepended result leaves the visible bars where they were

#### Scenario: The operator reaches the next left edge
- **WHEN** a full history page was prepended and the operator continues to the oldest candle in the enlarged series
- **THEN** another request is issued behind the new oldest candle rather than the first request disabling further paging

#### Scenario: The operator keeps scrolling while a page is loading
- **WHEN** the left edge is reached again before the outstanding response arrives
- **THEN** no second request is issued

#### Scenario: The contract's history is exhausted
- **WHEN** a history response returns fewer candles than were requested
- **THEN** no further history is requested for that contract and interval

#### Scenario: The read failed rather than came back short
- **WHEN** a read of older candles is not served at all
- **THEN** the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The desk states an outage over the last answer it holds
- **WHEN** a state of the desk's own restates the last history answer while a read is outstanding for it
- **THEN** the restatement is not taken for a page, the contract's history is not concluded to have a start, and the next scroll issues a new read

#### Scenario: The session is rebuilt under an outstanding read
- **WHEN** the connection recovers and the session is rebuilt while a read of older candles is outstanding
- **THEN** the next scroll issues a new read rather than waiting on an answer that can no longer arrive

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
Every bound that a workstation event must satisfy to be delivered and read — its
byte ceiling and the level count the payload rules accept — SHALL be derived from
a single statement of how much book is delivered, rather than written
independently. Exceeding any of these bounds stops the resource entirely instead
of degrading it, so the bounds SHALL be proven against the widest payload the
rules call legal rather than against a representative one.

The byte ceiling SHALL be enforced before a frame is parsed, so an unbounded
frame is refused without being read. What a parsed frame of the desk's own local
protocol is then permitted to contain SHALL be decided by the structural
validators — exact keys, canonical decimals, exchange identities, timestamps and
level counts — rather than by a budget counted during parsing.

A frame from the exchange SHALL keep its own reading. It carries sequence
numbers the whole order book is bridged on, and those are unsigned 64-bit
integers: read as numbers they round, and a book bridged against an identity the
exchange never sent is corrupt in the one place nothing else checks. That
reading SHALL answer such a value as its exact digits, and SHALL keep the bounds
it counts while doing so.

Where a value survives validation as free text — bounded by a length and by no
pattern — it SHALL be rejected if it carries an unpaired surrogate, and those
fields SHALL be named rather than assumed to be covered by the patterns that
spell every other string.

#### Scenario: The deepest legal book is delivered
- **WHEN** an event carries a full book at the longest decimals and identities the payload rules accept
- **THEN** it is within the byte ceiling and is parsed to completion, rather than being refused for size or for resource limits

#### Scenario: The delivered depth is changed
- **WHEN** the number of levels delivered per side is changed
- **THEN** the payload validator's bound follows it without a second edit

#### Scenario: A frame arrives over the byte ceiling
- **WHEN** an incoming frame is larger than the ceiling derived from the payload
- **THEN** it is refused before it is parsed, rather than being read and then rejected

#### Scenario: A frame is within the ceiling but malformed
- **WHEN** a frame within the byte ceiling carries a payload the rules do not accept
- **THEN** the structural validators reject it, and every payload refused before this change is still refused, except refusals of notation alone — which are stated, one by one, rather than claimed equivalent

#### Scenario: A depth sequence number is wider than a number holds
- **WHEN** the exchange sends an update identity past what a JavaScript number holds exactly
- **THEN** it is read as its exact digits and compared as such, rather than rounded to a value the exchange never sent

#### Scenario: A contract carries the exchange's own words
- **WHEN** a contract's type or status, or a header's contract status, carries an unpaired surrogate
- **THEN** the frame is refused, because those are the fields whose only rule is a length

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
by the grouping step. The range SHALL be stated by the panel that draws the rows,
and SHALL travel with the request that selects the contract, so that the page
covering it is bought against the first band a snapshot proves rather than after
a second message and whichever diff happens to arrive next. A page is a count of
levels and a range is a distance in price, and no reading translates one into the
other before a band has been read; what the carried range removes is the wait,
not the first read. A contract selected without a stated range SHALL be opened at
the largest page the exchange charges its lowest weight for, and a reading that
needs a wider range SHALL take the page that covers it in one read rather than
climbing to it. A range stated for one contract SHALL NOT be carried to another —
it is a distance in the contract's own quote currency, and means nothing in
another's.

Buying a deeper page SHALL NOT be held behind the backoff that governs a failed
recovery. The ladder of pages is finite and ratchets in one direction only, so it
cannot loop; a recovery that failed SHALL still back off, and the read budget
SHALL remain the ceiling on what deepening may spend.

#### Scenario: A contract is opened at the default step
- **WHEN** the operator selects a contract and reads its book at the finest step
- **THEN** the snapshot is taken at the cheapest page that covers the rows on screen, not at the deepest page the exchange offers

#### Scenario: The operator coarsens the step
- **WHEN** the operator selects a grouping step whose rows span a wider range than the current snapshot proved
- **THEN** a deeper snapshot is taken and bridged, and the rows are drawn from it

#### Scenario: Another contract is opened
- **WHEN** the operator switches to a contract priced differently from the one being left
- **THEN** its book is bought at the cheapest page, and only the range its own rows need deepens it

#### Scenario: A contract is opened at the step it was last read at
- **WHEN** the operator selects a contract whose grouping step was stored from an earlier reading of it
- **THEN** the reading stated for that contract is the one its own step needs, from the first frame it is drawn in, rather than the reading of the contract being left

#### Scenario: The panel states its reading before the book exists
- **WHEN** the panel states the range its rows need before the subscription that will carry the book has been established
- **THEN** the range reaches that subscription once it exists, rather than being lost with the one it was stated against

#### Scenario: A contract is opened at a step that needs a deep page
- **WHEN** the operator selects a contract whose stored grouping step needs a page several rungs deeper than the cheapest
- **THEN** the reading travels with the request that opens it, and the covering page is bought in one further read against the band the first snapshot proved, rather than the book climbing rung by rung across cooldowns

#### Scenario: The panel has drawn nothing for the contract being opened
- **WHEN** the first contract of a session is selected, before any book has been drawn to state a reading for it
- **THEN** the request states no range and the book opens at the cheapest page, and the reading is stated once the panel has one

#### Scenario: The book is short by several rungs
- **WHEN** the band falls short of the rows by more than one rung of the ladder
- **THEN** the page that covers the reading is bought in one read, without waiting out a recovery backoff between rungs

#### Scenario: Recovery keeps failing
- **WHEN** a snapshot read fails repeatedly while a shortfall persists
- **THEN** the recovery still backs off between attempts, and the persistent shortfall does not turn it into a hot loop

### Requirement: The book states the band it can prove
A snapshot proves a band of prices: within it every level is either from the
snapshot or from a diff applied since, and outside it only the levels a diff has
touched are known. The book SHALL record that band. When the market leaves the
band, the band SHALL be re-established by a fresh snapshot rather than by
treating the levels outside it as accounted for.

The band SHALL bound what the book claims, not what it keeps. A level the stream
restates SHALL be applied wherever it rests: the exchange named its price and its
quantity, and that is exact whether or not a snapshot page happened to reach it.
What the band marks is that beyond it the book is silent about levels nobody has
touched, so a row there can understate the market. Refusing those levels does not
avoid that — it understates by all of them, which is the same error, total. The
whole book streamed for a contract is a few thousand levels a side; one snapshot
page is a thousand of them and, measured, holds under a fifth of the resting
value.

Each delivered row SHALL state whether it is whole: whether the page the band was
read from named every price that row could be holding. The panel SHALL mark the
rows that are not, so a far row is read as what it is by an operator sizing a
breakout against it.

It SHALL be stated per row rather than as a boundary the panel measures its own
rows against. A boundary would be the same arithmetic done on both sides of the
wire, over buckets only one side built, and the two would part exactly where the
bucket key did — a row belongs to the desk that grouped it.

A row grouping several prices SHALL be judged by the end of its bucket furthest
from the market, so a bucket with one foot outside the band is not whole. Part of
it stands over prices nobody read, and a row that may understate is worth naming
even when most of it does not.

A book with no band SHALL call no row whole. That is the honest reading rather
than a special case: a page that proved nothing proves nothing about any row, and
so does a page the market has since traded clean out of.

The mark SHALL NOT change what the row states. Every level the row holds was
named by the exchange and is exact; what may be missing is levels nobody has
restated. Dimming a size to say the size might be low would make the panel state
something false about a number that is true.

Whether the band still reaches the rows on screen SHALL be judged for each side
against its own edge, and the depth bought SHALL answer the side that falls
short. A band whose total span happens to equal the total reading SHALL NOT be
treated as sufficient when one side of it does not reach: the two sides are read
separately and a wide side proves nothing about a short one.

Whether a deeper page is worth buying SHALL be decided per side against what the
page reached when it was read, not against what it still reaches now. A side
whose page did reach the rows has been walked out of, and a deeper page buys it
nothing — the same page re-read is a band centred where the market is now. A side
whose page never reached them is short by depth, and only a deeper page answers
it. Judging both by the distance currently left to the edge would make every
drifting market climb the ladder to the deepest page.

Whether the band still covers the rows and whether it still holds the market are
two questions, and the desk SHALL ask them separately. The first is the reading's
question and a deeper page answers it. The second is the market's, and no page
depth answers it: a band the market has walked to the edge of stops receiving
levels on that side whatever its depth, and the only answer is the same page read
again where the market is now. A band that no longer holds the market SHALL be
re-read whatever its shortfall and whatever page it was bought at, the deepest
one included. A band that still holds the market SHALL NOT be re-read for falling
short of the rows when no deeper page can be bought, so a contract the exchange
publishes no deeper than the reading does not re-read the same page for the whole
session.

Whether the band still holds the market SHALL be judged against what each side's
page proved when it was read, so that it means the same thing at every page depth
and on every contract, and SHALL NOT be judged against the stated range: what a
page proved is fixed the moment it is read, so a band short of the rows would
otherwise stay short of them for the session and never be re-read at all. The
threshold SHALL leave room to spare rather than waiting for the room to run out —
a side re-read once it has nothing left to draw has already been empty on the
screen the operator is trading from.

Coverage SHALL be judged before a book is delivered, and a book that does not
cover the stated range on both sides SHALL be delivered as stale rather than
live. It SHALL still be delivered — the rows it can prove are worth reading —
and SHALL return to live on the first delivery that covers both sides again.

A level of a book delivered short SHALL remain selectable. Such a book is exact
and current in every level it carries; there are fewer of them. Gating the levels
on a live state alone made a book that had merely fallen short of the rows
unusable for seeding a price — permanently, on a contract whose page does not
reach deep enough for the step it is read at.

#### Scenario: A diff touches a level outside the band
- **WHEN** a depth diff carries a level beyond the range the snapshot covered
- **THEN** the level is kept and drawn, and the row carrying it is marked as beyond what the book can account for

#### Scenario: A level nobody has touched
- **WHEN** a price outside the band has rested untouched since the snapshot was taken
- **THEN** nothing is drawn for it, because the book has never been told about it and does not guess

#### Scenario: The market moves past the band
- **WHEN** trading moves the best price far enough that the proven band no longer covers the rows on screen
- **THEN** a fresh snapshot is taken and bridged, and the rows are drawn from the new band

#### Scenario: The band was wide enough and the market simply moved
- **WHEN** the band no longer covers the rows but its span is wider than they need
- **THEN** the page already held is read again rather than a deeper one bought, so a drifting market cannot climb the desk to the deepest page

#### Scenario: The market moves past a band bought at the deepest page
- **WHEN** the best price leaves a band read at the deepest page a single REST read returns
- **THEN** that page is read again, centred where the market is now, rather than the book going on dropping the levels it can no longer prove

#### Scenario: A grouped row would span unproven ground
- **WHEN** the rows on screen would need more range than the band proves
- **THEN** the panel shows the rows it can prove until the deeper snapshot lands, rather than rows built on partial levels

#### Scenario: One side of the band falls short of the rows
- **WHEN** the band reaches past the rows on one side and falls short of them on the other
- **THEN** the shortfall is measured on the side that falls short, and a page deep enough for that side is bought, rather than the wide side being taken as proof that the reading is covered

#### Scenario: A row stands beyond the page the band was read from
- **WHEN** the stream has restated levels outside the band and the panel draws rows over them
- **THEN** each of those rows is delivered marked as not whole, and the panel marks it, while the rows inside the band are left unmarked

#### Scenario: A bucket straddles the edge of the band
- **WHEN** a grouped row covers prices on both sides of the edge of the band
- **THEN** it is not whole, because part of it stands over prices no page named

#### Scenario: The desk has read no page whole
- **WHEN** the book holds levels but no snapshot has proved a band, or the market has traded clean out of the one that did
- **THEN** no row is whole, and every row on the panel is marked

#### Scenario: A short side is delivered
- **WHEN** the book cannot prove the rows on one side and a diff is applied
- **THEN** the book is delivered as stale, carrying the rows it can prove, so the badge over the panel states what the rows show

#### Scenario: The deeper page lands
- **WHEN** a snapshot that covers the rows on both sides is bridged
- **THEN** the next delivery reads live again, without waiting for a separate status to say so

#### Scenario: A price is picked off a short book
- **WHEN** the operator clicks a level of a book delivered short
- **THEN** the level seeds the price it rests at, exactly as it does on a book that covers the rows

#### Scenario: The market walks out of a band that never covered the rows
- **WHEN** the market takes most of the room out of one side of a band that was bought at the deepest page and never reached the rows on screen
- **THEN** that page is read again, centred where the market is now, rather than the book going on dropping every level the market moves to for the rest of the session

#### Scenario: A band short of the rows is resting under the market
- **WHEN** a band bought at the deepest page falls short of the rows on screen while the market rests well inside it
- **THEN** nothing is read, because no deeper page exists to buy and the band is drawing every level it can prove

#### Scenario: A side is refilled before it empties
- **WHEN** the market has taken most, but not all, of one side's room out of the band
- **THEN** the re-read is asked for while that side still has rows to draw, rather than once it has none

#### Scenario: The market walks out of the band of a contract nobody is showing
- **WHEN** the best price leaves the proven band of a held session that is not being shown
- **THEN** no snapshot is taken for it, and the band is re-established when the contract is selected

#### Scenario: The market has walked out of the band, and no reading is stated
- **WHEN** a book whose reading is unstated no longer holds the market
- **THEN** it is delivered as stale rather than live

#### Scenario: The operator reads a row past the proven band
- **WHEN** the book is drawn at a step whose rows reach beyond the band a snapshot proved
- **THEN** those rows carry what the stream has restated and are marked as such, rather than being blank or being presented as complete

### Requirement: Bounded order-book delivery orders only the levels it can send
When a valid stated range bounds delivery to fewer levels than the retained
side, the workstation SHALL select the exact nearest levels required by the
range, the delivery floor, and the protocol limit before fully ordering the
selected result. It SHALL NOT fully order the unread retained tail.

The delivered bids and asks, their nearest-first order, the inclusive range
edge, the minimum-level floor, the maximum-level limit, and the reported spread
SHALL remain exactly equivalent to a full exact-decimal ordering of the retained
book. Price selection and ordering SHALL preserve decimal strings of different
scales and magnitudes beyond safe binary-number precision without lossy numeric
coercion. No level SHALL be synthesized.

An absent, invalid, non-positive, or effectively unbounded range SHALL continue
to deliver up to the protocol ceiling. Selection for delivery SHALL NOT weaken
the exact nearest-level ordering used to trim retained state.

#### Scenario: A realistic range reads a fraction of the retained book
- **WHEN** a valid range reaches roughly two hundred and twenty of one thousand retained levels on each side
- **THEN** only the bounded nearest subset is fully ordered, and the delivered bytes match the full exact-decimal reference for both bids and asks

#### Scenario: A narrow range falls below the delivery floor
- **WHEN** fewer levels lie inside the valid range than the minimum delivered level count
- **THEN** the nearest levels needed to reach the floor are selected and ordered exactly, without ordering the remaining retained tail

#### Scenario: Exact decimal prices have mixed scales and wide magnitudes
- **WHEN** retained prices use different decimal scales, include values wider than safe binary-number precision, and arrive in different insertion orders
- **THEN** bounded selection returns the same price strings, quantities, side order, and spread as the full exact-decimal reference

#### Scenario: The stated range covers the retained side
- **WHEN** a valid range reaches every retained level on a side
- **THEN** every level up to the protocol limit is delivered in exact nearest-first order and none is invented

#### Scenario: The range does not provide a usable bound
- **WHEN** the range is absent, invalid, non-positive, or wide enough that the protocol ceiling is the effective bound
- **THEN** delivery keeps the existing ceiling behavior and exact nearest-first output

#### Scenario: Retained state exceeds its side limit
- **WHEN** depth updates require the retained book to discard levels beyond its retention ceiling
- **THEN** retention keeps the exact nearest levels on each side independently of the bounded delivery selection

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
The market header SHALL present the selected contract identity together with the last price, the day's change, high, low and volume, and the funding readings, without placing any reading outside the visible header. At supported desktop widths, the identity SHALL remain at the left while the seven readings SHALL occupy a compact two-row arrangement beside it, pairing last price with 24-hour change, high with low, volume with funding, and leaving next funding in the remaining column. The header SHALL use a responsive non-scrolling fallback when the available width cannot hold that composition.

#### Scenario: The desktop header is width constrained
- **WHEN** the selected contract identity and all seven market readings fit through the two-row desktop composition
- **THEN** the readings remain beside the identity in four compact columns instead of moving as one full-width row beneath it

#### Scenario: The header is given less height than its content prefers
- **WHEN** the grid gives the header less height than its content
- **THEN** the header's values remain visible, and the header does not scroll

#### Scenario: The responsive header is narrower than the desktop composition
- **WHEN** the available width cannot keep the identity and paired readings beside one another without overlap
- **THEN** the header wraps into a readable fallback without clipping a value or introducing a header scrollbar

### Requirement: Scrolling belongs to the unbounded lists
Only the recent-contract group, searchable contract list, execution-ticket body,
aggregate-trade tape and portfolio dock's tables SHALL scroll. The ticket body
MAY scroll only when the ticket is taller than the rail allocation, while the
ticket tabs and the instrument rail stay in place. The instrument rail as a
whole, the execution ticket as a whole, the market header, the chart column and
the order book SHALL NOT introduce a scrollbar of their own.

#### Scenario: The rail holds more than fits
- **WHEN** a recent or searchable contract list is longer than the rail is tall
- **THEN** the list scrolls inside itself and the trading ticket below it stays in place

#### Scenario: The ticket body is taller than its allocation
- **WHEN** the ticket fields and actions need more height than the instrument rail can allocate to them
- **THEN** only the ticket body scrolls, its tabs remain visible, and every order action remains reachable

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
Every scrollable recent-contract group, searchable contract list,
execution-ticket body, aggregate-trade list and portfolio-dock table SHALL use a
workstation-themed scrollbar whose vertical width and horizontal height are no
greater than 6 CSS pixels. The track SHALL not introduce light native chrome or
arrow buttons, while the thumb SHALL remain visibly distinct from the track and
gain emphasis on hover. Styling SHALL preserve wheel, touchpad, keyboard, thumb
dragging, and any required horizontal scrolling behavior.

#### Scenario: A contract list overflows vertically
- **WHEN** a recent or searchable contract list contains more rows than its rail allocation can show
- **THEN** it remains vertically scrollable through compact workstation-themed chrome no wider than 6 CSS pixels

#### Scenario: The execution ticket body overflows vertically
- **WHEN** the execution ticket body contains more controls than its rail allocation can show
- **THEN** every control remains reachable through a compact scrollbar without light native track or arrow-button chrome

#### Scenario: Aggregate trades overflow vertically
- **WHEN** the aggregate-trade list contains more rows than its 35-percent panel allocation can show
- **THEN** it remains vertically scrollable through a compact scrollbar no wider than 6 CSS pixels, without native arrow-button chrome

#### Scenario: A portfolio table overflows
- **WHEN** a positions, working-orders, or history table exceeds its available vertical or horizontal space
- **THEN** each required axis remains scrollable through compact workstation-themed chrome no thicker than 6 CSS pixels

#### Scenario: Operator points at the scrollbar thumb
- **WHEN** the pointer hovers a compact scrollbar thumb
- **THEN** the thumb becomes more prominent without changing the list's dimensions or scroll position

### Requirement: Chart tools fit without a toolbar scrollbar
The chart toolbar SHALL present its interval choices and all four display-only
drawing and alert actions within the visible chart width at supported desktop
workstation sizes without introducing a horizontal scrollbar. Each chart action
SHALL use a compact recognizable icon while retaining its complete accessible
name, explanatory pointer title, pressed state where applicable, and disabled
state.

#### Scenario: Desktop chart toolbar is width constrained
- **WHEN** the chart column is rendered at its narrowest supported desktop width
- **THEN** every interval and chart-tool action remains visible in one toolbar row and the toolbar has no horizontal scrollbar

#### Scenario: Operator reads an icon-only chart action
- **WHEN** the operator focuses or points at a drawing or alert action
- **THEN** the complete action name remains available to assistive technology and as a pointer title even though the visible control is an icon

#### Scenario: Chart action availability changes
- **WHEN** a drawing, draft price, or display alert makes a chart action available or unavailable
- **THEN** the matching icon control preserves the same pressed or disabled state and invokes the same display-only action

### Requirement: Structural color is distinct from trading risk
The futures workstation SHALL use neutral dark surfaces and borders for layout,
and a calm non-red accent for ordinary selection, focus, and active workspace
identity. Red SHALL be reserved for sell direction, negative performance,
liquidation risk, destructive controls, unavailable or disconnected state, and
errors. Positive outcomes SHALL remain green and cautionary state SHALL remain
amber so ordinary navigation cannot be mistaken for trading risk.

#### Scenario: Operator selects an ordinary control
- **WHEN** the operator selects a recent contract, chart interval, or display-only chart tool
- **THEN** the control uses the calm interaction accent rather than the red negative-state color

#### Scenario: Negative and positive readings are shown together
- **WHEN** the workstation renders a loss or sell state beside a profitable or buy state
- **THEN** the former remains red, the latter remains green, and neither color is reused by surrounding panel borders

#### Scenario: Workstation structure is rendered
- **WHEN** the futures desk draws its shell, panel separators, and inactive surfaces
- **THEN** those structural elements use neutral slate tones rather than a saturated red outline

### Requirement: The portfolio dock can yield space to the chart
The lower portfolio dock SHALL open in its current expanded state and expose an
accessible control that collapses both dock panels into one compact summary row
for the current session. The collapsed row SHALL retain the positions count,
working-orders count, total unrealized PnL, and an expand control while removing
the full tables from layout so the chart and market rails receive the released
height. Collapsing and expanding SHALL NOT mutate account data or reset the
selected order view.

#### Scenario: Operator collapses the expanded dock
- **WHEN** the operator activates the collapse control
- **THEN** both full dock panels yield their layout height and one compact row states positions, working orders, and total unrealized PnL

#### Scenario: Operator expands the compact dock
- **WHEN** the operator activates the expand control after changing the dock's order view before collapse
- **THEN** the full dock returns with the same order view, positions, orders, and account readings it held before collapse

#### Scenario: A new workstation session starts
- **WHEN** the futures workstation mounts in a new session
- **THEN** the portfolio dock starts expanded and no collapsed preference is restored from storage

### Requirement: A resync redraws every candle it corrected
When a re-read of the candle series is applied, the chart SHALL determine
whether any candle changed, not only whether the series has the same length and
the same first and last open time. A change to an interior candle SHALL reach
the canvas.

#### Scenario: An interior candle was corrected
- **WHEN** a re-read returns a series of the same length and endpoints in which an interior candle's values differ
- **THEN** the chart is updated with the corrected candle

#### Scenario: Only the last candle moved
- **WHEN** a re-read differs only in the newest candle
- **THEN** the chart takes the cheap path and updates that candle alone

### Requirement: A failed futures history read leaves history loadable
A read of older candles that cannot be served SHALL be answered rather than
passed over in silence, and the answer SHALL name the read it belongs to. The
renderer SHALL release its in-flight read on that answer so the next scroll
issues a new one, SHALL leave the run on screen exactly as it was, and SHALL NOT
take the failure for the exchange saying there is nothing older. The operator
SHALL be told at the chart, and told until a read succeeds — a notice that
withdraws itself leaves the chart looking like a contract whose history ends
there.

A notice SHALL NOT instruct an action the desk will not carry out. Where the
chart will issue no further read for that contract and interval, the operator
SHALL be told that the history ends there rather than told to scroll again, and
SHALL be told whose end it is: the exchange having nothing older is a fact about
the contract, while a run this chart will not draw past is a fact about the desk,
and the desk SHALL NOT state its own limit as the contract's beginning.

#### Scenario: The exchange read fails
- **WHEN** the backend cannot serve a read of older candles
- **THEN** the failure is answered, the renderer's in-flight read is released, and the next scroll issues a new read

#### Scenario: The failure answers a read the chart moved on from
- **WHEN** a failure arrives naming a read other than the one being waited on
- **THEN** it is ignored and the read in flight is still in flight

#### Scenario: A page arrives after a failure
- **WHEN** a later read is served
- **THEN** the operator is no longer told that older candles could not be loaded

#### Scenario: The chart will not ask again
- **WHEN** the chart has concluded that the contract's history has a start
- **THEN** the operator is told the history ends there, and is not told to scroll again to retry

#### Scenario: The chart stops on its own ceiling
- **WHEN** the chart will issue no further read because the run it draws cannot be deepened
- **THEN** the operator is told the chart holds as far back as it draws, and is not told that the contract's history starts there

### Requirement: The bars the live window drops are kept behind it
The window of candles the stream re-sends is bounded and slides. The renderer
SHALL keep the closed candles that leave it, joined to the end of the history
already held, so the series drawn has no bar missing between the two. Rows that
do not continue what is held SHALL NOT be joined across the gap between them.

#### Scenario: A bar leaves the live window
- **WHEN** a bar opens and the oldest bar in the re-sent window is no longer in it
- **THEN** that bar is kept at the end of the held run and the drawn series stays continuous

#### Scenario: The window jumped rather than slid
- **WHEN** the window returns at a position that does not continue what is held
- **THEN** the rows that left are dropped rather than joined across the gap

### Requirement: Futures chart history is bounded in the renderer
The renderer SHALL bound the candle series it holds for a contract and interval
to the same ceiling the disk cache applies, dropping the oldest rows when older
pages arrive beyond it.

#### Scenario: Many history pages are paged in
- **WHEN** the operator scrolls far enough left to exceed the ceiling
- **THEN** the held series stays at the ceiling, keeping the rows nearest the live end

### Requirement: A market feed keeps trying while its contract is wanted
A Futures workstation session that is being shown SHALL continue attempting
to restore its market data for as long as the contract is selected, and
SHALL NOT reach a state from which only reloading the window or reselecting
the contract can recover it. A held session that is not shown SHALL NOT
attempt on its own: it is parked and rebuilt by selection or by the desk's
warmer.

Exhausting the fast reconnect ladder SHALL end the hurry, not the recovery: the
shown session SHALL fall back to a slow steady interval and keep attempting on
it. The slow interval SHALL be long enough that a route which is gone for hours
costs negligible traffic, and short enough that a route which returns is picked
up without the operator acting.

The session SHALL stop only when the contract it serves is no longer wanted or
the service itself is stopped. The number of attempts already made SHALL NOT be
a reason to stop.

While the session is attempting recovery, the resources it can no longer feed
SHALL be presented as not carrying rather than as current, and the session SHALL
retain nothing that would let a stale reading be read as a live one.

#### Scenario: The route is gone for longer than the fast ladder
- **WHEN** market data cannot be restored for longer than the fast reconnect ladder allows
- **THEN** the shown session keeps attempting on the slow interval, and restores the chart, order book and tape on its own when the route returns, without the operator reloading the window or reselecting the contract

#### Scenario: The route returns during the slow interval
- **WHEN** the route becomes reachable again while the shown session is attempting on the slow interval
- **THEN** the next attempt succeeds, the fast ladder is available again for any later interruption, and the workspace returns to live

#### Scenario: The contract is no longer wanted
- **WHEN** the operator selects another contract or the workspace is released while a session is attempting on the slow interval
- **THEN** the attempts stop with the session, and no timer of the released session performs work

#### Scenario: A background contract loses its route
- **WHEN** the route drops for a held session that is not shown
- **THEN** it is parked with the reason and attempts nothing until selected or woken in a free minute

### Requirement: A feed that has stopped carrying says so where it stopped
When a Futures workstation session is not carrying market data, the workspace
SHALL state it on the surfaces that lost it — the chart, the order book and the
aggregate-trade tape — rather than only in the contract list. The statement
SHALL name that recovery is still being attempted.

A manual retry SHALL be reachable from that statement. The retry offered in the
contract list SHALL NOT be the only way to ask for recovery, and SHALL NOT
describe the loss of the market feed as a loss of the contract list.

The statement SHALL stand for as long as it is true. An attempt made after the
fast ladder has run out SHALL NOT withdraw it: nothing has been recovered
between two attempts on the slow interval, and withdrawing the statement takes
the retry away with it at the moment the operator is most likely to reach for
it.

#### Scenario: Market data stops while a contract is selected
- **WHEN** the session stops carrying market data for the selected contract
- **THEN** the chart, order book and tape each state that they are not carrying, and the workspace states that recovery is being attempted

#### Scenario: The operator asks for recovery from the statement
- **WHEN** the operator uses the retry offered beside the stopped surfaces
- **THEN** an attempt is made at once without waiting for the slow interval, and without the operator reselecting the contract

#### Scenario: Another attempt is made while the statement is on screen
- **WHEN** the session makes a further attempt after the fast ladder has run out
- **THEN** the statement and its retry stay on screen for the whole attempt, and are not withdrawn and restored around it

### Requirement: The desk holds several contracts and shows one
The workstation service SHALL be able to hold more than one contract's session
at a time, each with its own streams, order book, timers and state. Selecting a
contract SHALL select which held session is delivered to the renderer, and SHALL
start a session only for a contract that is not already held.

#### Scenario: The operator returns to a contract they just left
- **WHEN** the operator selects a contract whose session is still held
- **THEN** its current state is delivered without a new bootstrap, and the workspace does not pass through `loading`

#### Scenario: The operator selects a contract for the first time
- **WHEN** the operator selects a contract that is not held
- **THEN** a session for it is started, and the sessions already held are unaffected

### Requirement: A held session is a whole session, shown or not
A held session SHALL carry every stream it would carry while shown, including
the depth diff, and SHALL keep its order book, tape and candles current from
those streams whether or not it is the one being shown. Being shown SHALL
decide whether the session delivers to the renderer, and whether the session
recovers on its own: a session that is not shown SHALL NOT open a socket or
issue a REST read on its own account, and SHALL be parked instead when its
streams stop carrying or its book needs rebuilding.

A session that is not shown draws no rows and SHALL NOT issue a depth read
for any reading; the reading is answered from the book in hand when the
contract is selected.

#### Scenario: A held contract is selected
- **WHEN** the operator selects a contract whose session is held, live and not shown
- **THEN** its book, tape and candles are delivered as the session already holds them, with no snapshot read and no stream opened

#### Scenario: A held contract is not shown
- **WHEN** a held session is live and not the one being shown
- **THEN** it keeps parsing its streams and updating its state, and delivers nothing to the renderer

#### Scenario: The band of a held contract stops covering its reading
- **WHEN** a session that is not being shown holds a book whose page no longer reaches the reading last stated for that contract, or the market has walked out of it
- **THEN** no depth read is issued for it; the reading is answered from the book in hand when the contract is selected

#### Scenario: The shown contract's band stops covering its reading
- **WHEN** the page the shown contract's book was bootstrapped from stops reaching the rows on screen
- **THEN** the rows beyond the page are drawn from the stream and marked as such, and no page is bought for it

#### Scenario: A held contract's stream stops
- **WHEN** a held session that is not shown loses a stream or proves a gap
- **THEN** it is parked, and no read or socket is spent on it until it is selected or woken in a free minute

### Requirement: The pool is bounded
The number of held sessions SHALL be bounded by a stated setting, and the least
recently shown session SHALL be released in full when the bound is reached.

#### Scenario: The bound is reached
- **WHEN** the operator has shown more contracts than the pool holds
- **THEN** the least recently shown session is released in full, and the rest keep running

### Requirement: A failure belongs to its own session
A resynchronization, a refused frame or a lost socket SHALL affect only the
session it occurred on. Other held sessions, and the delivery of the shown
session when it is not the failing one, SHALL continue. A held session that
is not shown SHALL NOT rebuild itself over a failure: it is parked, and
rebuilt by selection or by the desk's warmer.

#### Scenario: A background session loses its connection
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the shown contract's data continues uninterrupted

#### Scenario: A session that failed unwatched is selected
- **WHEN** a held session lost its stream or fell out of sync while it was not being shown, and the operator selects it
- **THEN** it is rebuilt at once and takes the screen, stating under `loading` the reason it stopped, rather than being delivered as current

#### Scenario: A background session is parked
- **WHEN** a held session that is not being shown loses its stream
- **THEN** the contract being shown does not change, the session keeps the place in the pool it already had, and no rebuild is attempted until it is selected or woken in a free minute

#### Scenario: A background session reconnects
- **WHEN** a parked session is rebuilt by the desk's warmer in a free minute
- **THEN** the contract being shown does not change, and the rebuilt session keeps the place in the pool it already had

### Requirement: A market too quiet to bridge still opens its book
The desk bridges a depth snapshot to the diff stream by finding the buffered
diff that spans the snapshot's update id. Where no diff has been published at
all — the contract's book has not changed since the snapshot was taken — the
snapshot IS the current book, and the desk SHALL go live on it rather than
treating the absence as a failure. The bridge is then owed to the first diff
that arrives: it SHALL be accepted if it continues from the snapshot's update id
or spans it, and a diff that begins beyond the snapshot proves updates were
missed and SHALL be treated as the sequence gap it is. A snapshot that a
buffered diff proves stale SHALL still be refused.

#### Scenario: A contract nobody is trading is opened
- **WHEN** a snapshot is read and no depth diff has been delivered for the contract at all
- **THEN** the book goes live on that snapshot and the panel draws it, rather than the snapshot being read again

#### Scenario: The market moves after a quiet start
- **WHEN** the first diff arrives after a book went live on an unbridged snapshot, continuing from or spanning its update id
- **THEN** it is applied, and the book carries on from it

#### Scenario: Updates were missed before the first diff
- **WHEN** the first diff after such a snapshot begins beyond the snapshot's update id
- **THEN** the book is rebuilt from a fresh snapshot rather than applying it

#### Scenario: A buffered diff proves the snapshot stale
- **WHEN** a diff already buffered begins beyond the snapshot's update id
- **THEN** the snapshot is refused and read again, as it is today

### Requirement: A book that cannot be built costs the book, not the desk
A depth bootstrap that cannot be bridged SHALL NOT resynchronize the session.
The desk SHALL come live without the book — chart, candles, header and tape
delivering — with the book marked stale and rebuilt in the background on its own
cooldown, exactly as a live book already answers a sequence gap. The aggregate
timing SHALL distinguish a session that reached live with its book from one that
reached live without it.

The cooldown between rebuild rounds SHALL widen while rounds keep failing and
SHALL be bounded by a stated ceiling, and one bridged snapshot SHALL return it
to its floor. A round abandoned because the contract is being released or the
session is resynchronizing SHALL count as neither. Buying a deeper page of a
live book is not a recovery and SHALL stay exempt from this cooldown. A book
that cannot be bridged is one the exchange cannot serve a usable snapshot for,
and asking at a fixed rate for as long as that lasts spends the desk's read
budget against the exchange at exactly the moment it is refusing work.

#### Scenario: The book cannot be bridged at startup
- **WHEN** every snapshot attempt of a bootstrap fails to bridge
- **THEN** the session reports `live`, the header, candles and tape keep being delivered, and the book is reported stale rather than the workspace going to `RESYNCHRONIZING`

#### Scenario: The book is rebuilt afterwards
- **WHEN** a later recovery bridges a snapshot for a session that came live without its book
- **THEN** the book is delivered live to the panel without the session having been rebuilt

#### Scenario: The timing log is read afterwards
- **WHEN** a session comes live without its book
- **THEN** its aggregate timing says so, distinctly from a session that came live with one and from one that failed

#### Scenario: The exchange cannot serve a bridgeable snapshot
- **WHEN** rebuild rounds keep failing because no snapshot bridges
- **THEN** each failed round widens the pause before the next, up to the stated ceiling, instead of asking at the same rate for as long as the condition lasts

#### Scenario: The exchange recovers
- **WHEN** a snapshot bridges after a run of failed rounds
- **THEN** the pause returns to its floor, and the next broken sequence is answered at the ordinary cadence

### Requirement: A fault the desk recovered from is written down
Every internal fault the desk absorbs — a bootstrap that could not bridge, a
book recovery, a rejected stream frame, a history read that failed — SHALL reach
the operator's log naming the phase it happened in and the reason code, in the
operator's own build and not only under test. The line SHALL carry the code and
nothing from the market payload. Reasons that differ SHALL NOT share a code.

A rebuild of the book SHALL be asked for under the name of what happened. A
live chain that broke, a diff arriving on a book that is already down, and a
bootstrap buffer that overflowed before a snapshot bridged are three different
conditions, and the code the record carries decides where the reader looks —
at the stream, or at the snapshot that would not bridge. A book that stays down
while its recoveries fail SHALL NOT be recorded as a fresh sequence break on
every diff that lands on it.

An attempt inside a recovery that read its snapshot and could not bridge it
SHALL state the same bridging reason the initial bootstrap states — the
snapshot could not be tied to the stream, or the buffered diffs had a hole in
them — rather than moving to the next attempt without a word. A recovery that
leaves the book down having said only why it started has told the reader where
it was standing, not why it stayed there.

#### Scenario: A bootstrap cannot bridge its snapshot
- **WHEN** the book fails to bridge because no snapshot could be bridged, or because the buffer had a hole in it
- **THEN** the log names the phase and a reason code distinct to each of the two

#### Scenario: The desk is running the operator's own build
- **WHEN** any of these faults happens outside a test
- **THEN** it is logged, rather than being reported to a reporter nothing was wired to

#### Scenario: A live book's chain breaks
- **WHEN** a diff arrives that does not continue the live book's sequence
- **THEN** the rebuild it asks for is recorded as a sequence gap

#### Scenario: Diffs keep landing on a book already down
- **WHEN** the book is down awaiting a rebuild and the stream keeps delivering
- **THEN** a rebuild a further diff asks for is recorded as the book being down, not as another sequence gap

#### Scenario: A recovery reads a snapshot it cannot bridge
- **WHEN** an attempt inside a recovery reads its snapshot and fails to bridge it
- **THEN** the record carries that attempt's bridging reason, under the same code the initial bootstrap would state

### Requirement: A failed read states why it failed
A read the desk records as failed SHALL carry the reason it failed, not only the
phase and the outcome. A phase with several fast-rejection paths — a proxy that
is not configured, a request aborted before it was issued, a refusal from the
admission ladder — SHALL be distinguishable in the record without re-reading the
code that produced it.

A failure the desk expects and recovers from SHALL NOT be recorded as an error.
An error line that appears on every start is either a fault nobody has priced or
a lie the record tells routinely, and both teach the reader to stop reading error
lines.

#### Scenario: A read fails before it reaches the exchange
- **WHEN** a workstation read is rejected in a handful of milliseconds, before any request goes out
- **THEN** the record names which rejection it was, so the cause can be read rather than guessed between

#### Scenario: A first attempt is expected to lose a race
- **WHEN** an attempt is one the desk expects to fail and retries by design
- **THEN** it is not recorded as an error, and what it is instead is stated where the reader will find it

### Requirement: The book states how far it reaches
A delivered book SHALL state how far past the best price the book the desk holds
reaches on each side, in the contract's own quote currency. That reading is a
fact about the book on hand rather than about the rows on screen, and the panel
SHALL NOT be left to infer it from the levels it was sent: delivery is already
trimmed to the range the panel stated, so a panel measuring what it received
would only ever measure its own step back.

The reading SHALL be a property of the book, not a claim about the exchange. What
the exchange publishes is wider than any one snapshot page — the diff stream
restates levels far outside it — so a reading taken from the page states what the
desk can draw, which is what the ladder must be cut against, and states nothing
about what the market holds beyond it.

The reading SHALL be taken from where the book still has substance rather than
from the single level furthest from the market. A resting order far outside the
market is legal, real, and nothing anybody trades against; cut against it, the
ladder offers a step whose rows span a stretch of price the book has almost
nothing in, which is the blank far rows the ladder exists to prevent. A share of
each side's levels SHALL be left outside the reading, expressed as levels dropped
rather than as a position in the side, so a side with nothing to spare is still
measured to its own edge.

The reading SHALL NOT be taken from the distance currently left to the edge of the
band, which shrinks as the market walks and would move the ladder under the
operator's hand.

The reading SHALL be stated only when no deeper page can be bought. Until the
ladder of pages is exhausted a wider reading is one read away, and the ladder
should not be cut against a page the operator can still ask to deepen.

#### Scenario: The book is bought at a page short of the deepest
- **WHEN** the book is delivered from a page the exchange offers a deeper one than
- **THEN** it states no reach, because a deeper page may still be bought

#### Scenario: The book is bought at the deepest page
- **WHEN** the book is delivered from the deepest page the exchange serves in one read
- **THEN** it states how far the book it holds reaches past the best price on each side

#### Scenario: The market walks inside the band
- **WHEN** the market moves toward one edge of a band bought at the deepest page
- **THEN** the stated reach is unchanged, because it is what the page proved and not what is left of it

### Requirement: A stream that delivers nothing is treated as disconnected
An upstream market socket that stays open while delivering nothing SHALL be
treated as a disconnection once its silence passes a stated bound, and SHALL
enter the same recovery a closed socket enters. Marking the resources it feeds
as stale SHALL NOT be the whole of the desk's answer: a route that answers the
handshake and then says nothing raises no error and never closes, so a desk that
only marks staleness sits on a dead feed for as long as the operator leaves it
there.

The bound SHALL be chosen by what the exchange guarantees about that stream, and
SHALL be measured rather than assumed:

- A stream that pushes on an unconditional cadence, regardless of whether
  anything trades, SHALL be judged by its frames. Silence past the bound on such
  a stream is a feed that stopped delivering, not a market with nothing to say.
- A stream whose silence can be legitimate SHALL be judged by the connection's
  own traffic instead — its frames or the exchange's protocol pings, whichever
  came last — at a bound of no fewer than two missed pings. A quiet contract
  SHALL NOT be read as a dead route.

The judgement SHALL be made per socket and SHALL NOT depend on whether the
contract it serves is the one displayed, because a contract held warm behind the
one on screen is exactly the one whose dead feed would otherwise go unnoticed
until the operator switched to it.

The disconnection SHALL name which bound was crossed, distinctly from a socket
the exchange closed and from one the desk retired on its own rule.

A watchdog belonging to a socket that has been closed, rotated or torn down
SHALL report nothing.

#### Scenario: The guaranteed cadence stops
- **WHEN** the socket carrying the per-second mark stream delivers no frame for longer than its bound
- **THEN** the session reports a disconnection naming that bound and recovers as it does from a closed socket

#### Scenario: The contract is genuinely quiet
- **WHEN** a contract trades nothing for minutes and the exchange keeps sending protocol pings on its streams
- **THEN** no disconnection is reported, and the streams stay live

#### Scenario: The route stops answering entirely
- **WHEN** a socket receives neither a frame nor a protocol ping for longer than two ping intervals
- **THEN** the session reports a disconnection naming that bound, without waiting for a close that is not coming

#### Scenario: The contract is warm but not displayed
- **WHEN** a session that is not the displayed one has a socket go silent past its bound
- **THEN** it is judged and recovered the same as the displayed one

#### Scenario: The generation was released
- **WHEN** a socket is closed, rotated at its lifetime, or torn down with its session
- **THEN** its silence watchdog reports nothing thereafter

### Requirement: A book that goes silent while its tape prints is not a quiet book
Where the desk carries an aggregate-trade stream and a depth stream for the same
contract, the book's silence SHALL be judged against the tape's activity: a trade
printing against the book is a change to the book, so depth cannot be silent
through one. Depth silent past a stated margin while its own tape has printed
SHALL be reported as a disconnection.

The margin SHALL be set from measurement of the thinnest contract the desk
carries, and SHALL leave room for the longest silence observed there while its
tape was printing. Where the measurement leaves no such room, this rule SHALL NOT
be enforced at all, rather than enforced at a bound that resynchronizes a live
desk.

Both streams silent together SHALL NOT be judged by this rule; that is a quiet
market, and the connection's own traffic already answers for it.

This rule SHALL be reported under a reason of its own, because it states
something a cadence bound does not: not that a connection died, but that one of
two independently served routes stopped carrying while the other kept talking.

#### Scenario: The book stops while trades print
- **WHEN** aggregate trades keep arriving for a contract and its depth stream delivers nothing past the margin
- **THEN** the session reports a disconnection under this rule's own reason and recovers

#### Scenario: Nothing is trading
- **WHEN** neither the tape nor the book has anything to deliver
- **THEN** this rule reports nothing, and the streams are judged only by the connection's own traffic

#### Scenario: The margin is not there to be had
- **WHEN** measurement of the thinnest carried contract shows book silences through printing trades that reach the proposed margin
- **THEN** the rule is not enforced, and the measurement that ruled it out is written down

### Requirement: Market data state does not disarm order entry
Chart price picking, chart trading gestures and order-book level selection SHALL
remain available while the market data is stale, quiet, disconnected or
resynchronizing. They SHALL be unavailable only where the surface has never
received data and therefore has no price to act on. Lifting an order off the
chart SHALL NOT depend on the market data state at all, because the order being
lifted is the desk's own.

#### Scenario: The workspace is resynchronizing
- **WHEN** the market data resynchronizes while the operator holds a position
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: The contract is quiet
- **WHEN** the selected contract records no trade for longer than the freshness window
- **THEN** the chart gestures, the price pick and the book's levels remain usable

#### Scenario: Nothing has ever been received
- **WHEN** a contract's chart has received no candle at all
- **THEN** picking a price from it is unavailable, because there is no price on it

#### Scenario: The book was delivered empty
- **WHEN** the order book carries no level on either side
- **THEN** there is no level to pick, and picking one is unavailable

### Requirement: A price taken from a non-live reading states its age
A price picked from a surface that is not live SHALL be presented with the age
of the reading it came from, on the ticket and on the confirmation panel, so the
operator confirms a price whose age they can see. The age SHALL be counted from
the time the reading was observed to the moment it is read, so a panel left open
states a growing age rather than the age it was staged at. A price the operator
typed carries no reading and SHALL state no age.

#### Scenario: A gesture is made on a stale chart
- **WHEN** the operator opens an order from a chart whose data is stale
- **THEN** the confirmation states how old the price it carries is

#### Scenario: The confirmation is left open
- **WHEN** a confirmation carrying a non-live price stays open
- **THEN** the age it states grows with the time the reading has been held

#### Scenario: The operator typed the price
- **WHEN** the price on the ticket was typed rather than picked off a surface
- **THEN** no reading age is stated for it

### Requirement: A silent stream on a live transport is named quiet
A market-data resource that has stopped updating while its transport is still
proven live SHALL be presented as quiet rather than stale. A resource whose
transport is not proven live SHALL keep the state the transport gave it.

#### Scenario: A contract with no trades
- **WHEN** the connection is live and the selected contract's candles stop arriving
- **THEN** the chart is marked quiet and states how long ago its last candle arrived

#### Scenario: The connection is gone
- **WHEN** the workspace is disconnected
- **THEN** the chart is not called quiet

### Requirement: A non-live reading is stated beside the chart, not over it
A chart that carries candles SHALL remain readable whatever its state: the state
and the age of its last reading SHALL be stated beside the chart rather than
drawn across it. The chart SHALL be covered only where it carries no candle at
all and therefore has nothing to read.

#### Scenario: The chart is quiet or stale but drawn
- **WHEN** the chart's data is not live and candles are on screen
- **THEN** the candles stay legible and the state and age are stated in a corner notice

#### Scenario: The chart has nothing on it
- **WHEN** the chart carries no candle
- **THEN** the chart is covered by a notice that states there is nothing to read

### Requirement: Every window width presents the positions and orders dock
The workstation layout SHALL present the positions and orders dock at every
supported window width. A layout template SHALL be applied only at widths its
columns fit in, so no width falls between a template that is too wide and a
breakpoint that has not yet applied.

#### Scenario: Narrow window
- **WHEN** the window is narrower than the desktop breakpoint
- **THEN** the positions and orders dock is present and readable

#### Scenario: Just above the breakpoint
- **WHEN** the window is at a width where the desktop columns no longer fit
- **THEN** the narrower template is already in force

### Requirement: An action available by pointer is available by keyboard
A row or control that opens an editor SHALL be focusable, SHALL activate with
Enter and Space, and SHALL state its action for assistive technology. A pointer
gesture SHALL NOT be the only way to reach an action that changes an order or a
position.

#### Scenario: Repricing an order without a mouse
- **WHEN** the operator focuses an order row and presses Enter
- **THEN** the order editor opens for that order and can be submitted from the keyboard

#### Scenario: The row states what it does
- **WHEN** assistive technology reads a row that opens an editor
- **THEN** it announces the action the row performs

### Requirement: A frame redraws the panel it belongs to and no other
The workstation SHALL redraw the order book only for a frame that changes the
book, and the tape only for a frame that changes the tape. What a frame costs to
draw SHALL NOT depend on how much of the panel it did not change: a print SHALL
cost the same whether two levels a side are on screen or twenty-four.

This replaces coalescing depth deliveries to an animation interval, which was
measured and does not pay. The exchange sends depth ten times a second and the
tape is throttled to four; against the sixty an animation interval allows there
is nothing to coalesce, and the one case there was — a burst on a socket that
stopped accepting bytes — is already collapsed in the transport, where the newer
book replaces the undelivered older one. What the burst actually cost was paid in
the panel: every frame of either kind rebuilt both ladders and every tape row.

#### Scenario: A print arrives
- **WHEN** a tape frame arrives and the book has not changed
- **THEN** the tape rows are redrawn and the book rows are not

#### Scenario: A book update arrives
- **WHEN** a depth frame arrives and the tape has not printed
- **THEN** the book rows are redrawn and the tape rows are not

#### Scenario: A frame changes both
- **WHEN** a frame carries both a new book and a new print
- **THEN** both are redrawn, because both are what changed

### Requirement: A price tick does not restart the render
The workstation SHALL derive the last-print direction without updating state
during render. A price tick SHALL cause one render pass of the workstation.

A turn of the market — a price that moves the other way from the one before it —
MAY cost a second pass, because a direction is a comparison with what was on
screen before and nothing the render is given carries that. It SHALL be decided
after the render and before the browser paints, so a turn is drawn on the frame
it happened rather than a frame late.

#### Scenario: A price tick arrives
- **WHEN** a new last price arrives moving the same way as the one before it
- **THEN** the workstation renders once and the direction reads the same as it does today

#### Scenario: The price does not move
- **WHEN** the same last price arrives again
- **THEN** the workstation renders once and keeps the direction it last had

#### Scenario: The market turns
- **WHEN** a last price arrives moving the other way from the one before it
- **THEN** the turn is drawn on that frame rather than the next one

#### Scenario: The first price of a contract
- **WHEN** a contract's first last price is drawn
- **THEN** it reads as neutral, because a first reading is not a move

### Requirement: The Futures identity strip owns the top of the workspace
While the Futures workspace is active, its blue `USDⓈ-M FUTURES` identity strip SHALL be the first visible workspace surface at the top edge of the window, with no production-red backdrop or empty chrome above it. The Spot/Futures market switch SHALL be centered as an absolute overlay on that strip so its controls hang down across the strip without changing the strip's height. The identity, live/synchronization state, market-switch controls, and interface-scale controls SHALL remain legible, operable, and non-overlapping at supported desktop widths; at narrower responsive widths the strip MAY grow or wrap to preserve those properties.

#### Scenario: Futures workspace reaches its first frame
- **WHEN** an active Futures workspace is rendered at a supported desktop width
- **THEN** the blue identity strip begins at the top edge, no red background appears above it, and the centered market switch overlays the strip

#### Scenario: Header controls share the identity strip
- **WHEN** the identity, workspace state, market switch, and interface-scale controls are all visible
- **THEN** each remains readable and operable without one control covering another

#### Scenario: The active workspace is narrow
- **WHEN** the Futures workspace renders below the desktop breakpoint
- **THEN** its top strip may wrap or increase in height while the identity, state, market switch, and scale controls remain usable

### Requirement: The active workspace keeps local time in sight
While a Spot or Futures workspace is active, the application SHALL present a centered local clock as part of the active interface. In Spot the clock SHALL remain immediately beneath the market-mode switch. In Futures the clock SHALL occupy a dedicated centered row immediately beneath the blue identity strip and its overlaid market switch. The Futures row SHALL reserve its own layout space so the clock does not cover the market header, instrument rail, or another workspace control. Reserving that row SHALL NOT displace the desktop layout it sits in: at desktop widths the chart and tape rows keep their proportional window-shared sizing, the portfolio dock remains fully inside the desk, and the desk's height budget subtracts only the page chrome that actually surrounds it. The clock SHALL use the host system's local time, SHALL show an English abbreviated weekday and month with day, hour, minute, and second in the form `Sat 15 Aug 15:00:56`, and SHALL advance through seconds without requiring market data or operator interaction. Its fixed-width numeric presentation SHALL not displace the mode switch or adjacent workspace controls as the value changes.

#### Scenario: An active workspace is mounted
- **WHEN** credential preflight has completed and either Spot or Futures is the active workspace
- **THEN** a centered in-interface clock is visible and states the current local weekday, day, month, hour, minute, and second

#### Scenario: An active Futures workspace is mounted
- **WHEN** credential preflight has completed and Futures is the active workspace
- **THEN** a centered clock is visible in a reserved interface row beneath the blue identity strip and states the current local weekday, day, month, hour, minute, and second

#### Scenario: An active Spot workspace is mounted
- **WHEN** credential preflight has completed and Spot is the active workspace
- **THEN** a centered clock remains visible immediately beneath the market-mode switch and states the current local weekday, day, month, hour, minute, and second

#### Scenario: Local time advances
- **WHEN** the host system clock advances to the next second while the workspace remains mounted
- **THEN** the visible clock advances to that local second without a market frame or operator action

#### Scenario: The clock crosses a calendar boundary
- **WHEN** local time advances into a new day or month
- **THEN** the weekday, day, month, and time are all recomputed from the host system clock rather than incrementing only the displayed seconds

#### Scenario: The clock row and the desktop grid share one window
- **WHEN** the Futures workspace renders at or above the desktop breakpoint with the clock row present
- **THEN** the chart and tape rows keep their proportional shares of the window, the tape does not collapse to its content's height, and the portfolio dock ends at or above the desk's bottom edge rather than being clipped below it

#### Scenario: The desk fills the window it was given
- **WHEN** the Futures workspace renders at or above the desktop breakpoint
- **THEN** the desk's height equals the window minus the page's own padding, with no dead band between the dock and the bottom of the window

### Requirement: Futures chart time agrees with the host-local workspace clock
The Futures chart SHALL format every visible time-axis tick and crosshair time label in the host system's current local time zone. The chart SHALL preserve the exchange candle timestamp as the plotted instant and SHALL NOT shift candle ordering, interval boundaries, history paging, or the data shared by price and volume series merely to change its displayed time zone.

#### Scenario: The host time zone differs from UTC
- **WHEN** a Futures candle is rendered on a host whose local time-zone offset is not UTC
- **THEN** the chart axis and crosshair state the candle's host-local date and time rather than its UTC clock reading

#### Scenario: The chart and workspace clock are compared
- **WHEN** the newest live candle and the workspace clock refer to the same current host-local period
- **THEN** both surfaces use the same local time basis and do not appear separated by the host's UTC offset

#### Scenario: Only time presentation changes
- **WHEN** host-local formatting is applied to candle timestamps
- **THEN** candle and volume rows keep their original instants, order, interval alignment, and shared time coordinates

### Requirement: Recent contracts fill three complete pill rows
The Futures workstation SHALL retain at most the nine most recently selected unique contracts and SHALL present them in the existing three-column recent-contract group. A tenth distinct selection SHALL discard only the least recent retained contract, and reading an existing persisted history SHALL preserve up to nine valid entries without changing the storage identity or the most-recent-first ordering. At a supported desktop height that can hold the complete group and execution ticket, the group SHALL show all retained rows without a scrollbar; internal scrolling SHALL remain available only when the rail is genuinely shorter than their combined allocation requires.

#### Scenario: Nine recent contracts are retained
- **WHEN** the operator has selected nine distinct valid Futures contracts and the supported desktop rail has room for the complete group
- **THEN** all nine are retained and shown as three complete rows of three recent-contract pills without an internal scrollbar

#### Scenario: The rail is genuinely too short
- **WHEN** the available rail height cannot show all retained recent contracts while preserving the execution ticket's reachable controls
- **THEN** the recent-contract group becomes internally scrollable and the execution ticket remains usable

#### Scenario: A tenth contract is selected
- **WHEN** nine distinct recent contracts are retained and the operator selects a tenth distinct contract
- **THEN** the new contract becomes first, the previous least recent contract is discarded, and exactly nine unique contracts remain

#### Scenario: Nine persisted contracts are restored
- **WHEN** the app starts with nine valid unique contracts stored by the existing symbol-history record
- **THEN** all nine are restored in their persisted most-recent-first order

### Requirement: The desk is exercised at the cadence it fails at
The desk SHALL have an automated case that delivers market data at the exchange's
full cadence — a depth frame at the widest legal payload every hundred
milliseconds, with candles alongside it — and issues a terminal execution report
during that burst. The case SHALL assert a stated bound on how late the execution
may be applied, and that bound SHALL be set from a measured run rather than
estimated.

The case SHALL assert that the book delivered during the burst is the newest one
and that whatever was superseded is counted, so a desk that keeps up by silently
falling behind does not pass. It SHALL run under the project's existing
verification surface, without a browser or Electron automation runner.

A burst is the condition the desk's latency defects appear under and the
condition none of them appear without; a suite that only exercises a quiet market
proves the desk works when nothing is at stake.

#### Scenario: An execution lands during a burst
- **WHEN** a terminal execution report is issued while depth frames arrive at the exchange's full cadence
- **THEN** it is applied within the stated bound, and the case fails if it is not

#### Scenario: The desk falls behind during the burst
- **WHEN** the desk cannot deliver every depth frame of the burst
- **THEN** the book it delivers is the newest, and the frames it superseded are counted rather than silently lost

#### Scenario: The case is run
- **WHEN** a developer invokes the burst case
- **THEN** it runs under the existing test surface, launching no browser and no Electron automation runner

### Requirement: A session is matched by an identity the protocol typed
The workstation protocol SHALL require every identity a frame is matched by to be
a string before testing it against the pattern that spells it, rather than
relying on the coercion a regular expression performs on a value of another type.

`requestId` is the key a session is matched by: ten strict comparisons decide by
it whether a request belongs to the session it names, whether a frame belongs to
the subscription listening for it, and whether an unsubscribe releases the
contract on screen. A frame whose `requestId` is a number, a boolean or an array
SHALL be refused under the protocol's identity code, not accepted under the
string its coercion happens to produce.

This is the rule the rest of the file already keeps — what a frame is permitted
to contain is decided by the validators and not by the transport — stated for the
one field that did not keep it.

#### Scenario: An identity arrives as something other than a string
- **WHEN** a request or an event states a `requestId` that is a number, a boolean or an array
- **THEN** it is refused as an invalid identity, rather than matched against a session under its coerced spelling

#### Scenario: An identity is wider than a number holds
- **WHEN** a frame states a `requestId` of `9007199254740993`
- **THEN** it is refused, rather than accepted under `9007199254740992` — an identity the sender never wrote, and one any other id rounding to the same value would share

#### Scenario: An identity arrives as it always has
- **WHEN** a frame states a `requestId` that is a string matching the identity pattern
- **THEN** it is accepted exactly as before, and every session comparison behaves identically

### Requirement: Account traffic is carried ahead of market data
The local transport SHALL carry account traffic and market data on separate
lanes. Account traffic — account state, execution reports, symbol configuration
and command outcomes — SHALL be delivered without loss and ahead of market data
already queued. Market data — depth, header, candles and tape — SHALL be
latest-wins: a frame still waiting to be accepted by the socket SHALL be replaced
by a newer frame for the same resource rather than both being queued behind each
other.

Only a resource that repeats everything the frame before it said may be
superseded. A book, a header, a tape window and a candle series each state the
whole of what they are, so the newer frame says everything the undelivered older
one said. A catalog page, a history page and a status line do not: a catalog is
assembled by offset and a dropped page discards the whole of it, a history page
is the answer to one request, and a status line names a cause the next line does
not repeat. Those SHALL be queued as market data and never replaced, and SHALL
NOT be dropped to make room either: what may not be superseded may not be
discarded, since the renderer assembles it and a missing part loses the whole.
A resource carried on more than one series SHALL be superseded per series, since
one series is not a newer statement of another.

Whether a queued frame may leave the queue unsent SHALL be decided by that frame
and not by the one arriving. Being replaced and being dropped are one removal, so
a frame that may not be dropped SHALL NOT be superseded either — including by a
frame of another market that names the same resource for the same contract.

The transport SHALL account for what the socket has not yet accepted, and SHALL
supersede rather than stack when it is behind. What was superseded SHALL be
counted per resource and made available to the diagnostic record, because a frame
dropped without a count is indistinguishable from a market that went quiet. That
count SHALL be stated when a backlog clears rather than per superseded frame: the
backlog worth recording is a socket blocked for a minute at the exchange's full
cadence, which is exactly when a line per frame would cost more than it tells.

"Without loss" SHALL have a stated end. A renderer that has not accepted a
bounded number of queued account frames SHALL be closed rather than served a hole
in its own account state, and reads the account again when it reconnects.

#### Scenario: A fill lands during a depth backlog
- **WHEN** an execution report is issued while depth frames are queued and not yet accepted by the socket
- **THEN** the execution report is delivered ahead of them, and none of it is dropped

#### Scenario: The renderer falls behind on depth
- **WHEN** depth frames arrive faster than the socket accepts them
- **THEN** the newest book is delivered and the frames it superseded are counted, rather than the operator reading a book that is several frames old

#### Scenario: Account traffic is never superseded
- **WHEN** two account frames are queued and the transport is behind
- **THEN** both are delivered, because an account fact is not replaced by a later one the way a quote is

#### Scenario: A paged resource is queued while the transport is behind
- **WHEN** a catalog page, a history page or a status line is queued behind an unaccepted send
- **THEN** it is delivered rather than replaced by a later frame of the same resource, because it states part of something and not the whole of it

#### Scenario: A catalog is sent as more pages than the queue is sized for
- **WHEN** the desk sends a contract catalog as pages back to back and the socket stops accepting bytes partway through
- **THEN** every page is delivered — a book already replaced by a newer one gives way first, and the queue grows rather than losing a page the renderer is assembling

#### Scenario: Two markets name one resource for one contract
- **WHEN** a frame that may be replaced and a frame that may not are queued for the same contract under the same resource name
- **THEN** the one that may not be replaced is delivered, because what may be removed is decided by the frame that would go

#### Scenario: A contract's two candle series are both waiting
- **WHEN** the contract's own series and the index series are queued for the same contract
- **THEN** each is superseded only by a newer frame of its own series

#### Scenario: A renderer stops taking its account traffic
- **WHEN** a renderer has not accepted a bounded number of queued account frames
- **THEN** it is closed rather than served a hole in its account state, and reads the account again on reconnect

### Requirement: A delivered frame is serialized once and parsed once
A workstation event SHALL be serialized once on the way out: the representation
measured against the byte ceiling SHALL be the representation that is sent. An
incoming frame SHALL be parsed once, at the boundary it arrives on, and
subscribers SHALL receive the parsed, typed event rather than the raw frame.

A subscriber SHALL be delivered only the event kinds it handles. No subscriber
SHALL parse a frame in order to discover that it does not want it.

#### Scenario: An event is delivered to the renderer
- **WHEN** the desk delivers a workstation event
- **THEN** it is serialized once, and the size it was checked against is the size that was sent

#### Scenario: An oversized event is refused
- **WHEN** an event exceeds the byte ceiling
- **THEN** it is refused exactly as it is today, from the single serialization

#### Scenario: A depth frame arrives with several subscribers listening
- **WHEN** a depth frame is delivered and both market-data and account subscribers are attached
- **THEN** it is parsed once, reaches the market-data subscriber, and is never handed to an account subscriber

### Requirement: A resting order is drawn as a price, not as a band
A working order's line on the chart SHALL be drawn at the same weight as every
other price overlay the chart carries. A standing fact SHALL NOT be drawn heavier
than the candles it sits among: at two pixels against bars a few pixels wide it
reads as a band rather than as a level, and it covers the very bars trading at
the price the operator is watching when the order is about to fill.

A line drawn while an order is being *dragged* is exempt. That marks an action in
progress rather than a standing fact, and it is on screen only while the operator
is holding it.

#### Scenario: An order rests on the chart
- **WHEN** a working order is drawn at its price
- **THEN** its line is the same weight as the drawings, alerts, entry band and liquidation line around it, and the candles at that price stay readable

#### Scenario: An order is being dragged
- **WHEN** the operator lifts an order and drags it to a new price
- **THEN** the line following the pointer stays emphasized, because it is an action rather than a level

### Requirement: A candle-history request settles from the answer issued for it
A completed candle-history response SHALL be applied from the workstation event that carried that response, not re-read from a resource snapshot that a later status event may have rewritten. A rejection issued before a session can own and serve the history request SHALL be returned as an explicit unavailable workstation outcome carrying the subscription request identity and selection, without claiming a resource generation or revision. Either kind of answer SHALL release only the matching in-flight read; a failure SHALL leave loaded rows intact, SHALL NOT imply exhaustion, and SHALL allow the next scroll to retry.

#### Scenario: A served page and an outage arrive in one renderer cycle
- **WHEN** a complete live candle-history page is followed by an outage event before the renderer commits the page
- **THEN** the rows from the live page are applied and the later outage does not reclassify or discard that answer

#### Scenario: The workstation no longer owns the history request
- **WHEN** the backend refuses a candle-history command because its request, contract or interval is no longer owned
- **THEN** it emits a bounded unavailable history outcome naming that subscription request, contract, interval and end time so a matching renderer releases the read and may ask again

#### Scenario: An ownership refusal belongs to an abandoned selection
- **WHEN** an unavailable history answer names a request or selection the renderer no longer waits for
- **THEN** the renderer ignores it and does not release or alter the current selection's in-flight read

### Requirement: Routine depth delivery is bounded and latest-wins
Consecutive routine order-book deliveries for the shown contract SHALL be separated by at least 200 milliseconds. The first eligible update MAY be delivered immediately; updates arriving before the next eligible instant SHALL occupy one replaceable pending slot, and the newest complete book SHALL be delivered at that trailing instant. The pending queue SHALL therefore remain bounded to one book and SHALL NOT lose the last state received during the spacing period.

Depth state transitions that tell the operator the book is stale, unavailable or resynchronizing, the first live depth after recovery, and the first delivery of a session SHALL bypass the routine delay. Immediacy belongs to the change of delivery state, not to its value: a delivery whose state matches the state last delivered — stale included — SHALL remain a routine delivery under the bound above. A book whose staleness stands across consecutive diffs SHALL therefore be delivered at the routine cadence, latest-wins, for as long as the state does not change, and the delivery that states the change itself SHALL NOT be delayed. Releasing, replacing or hiding the owning session SHALL cancel its pending timer and payload so no late book can be delivered under another owner.

#### Scenario: Several diffs arrive in one delivery window
- **WHEN** multiple valid depth diffs update the shown book within 200 milliseconds
- **THEN** an eligible leading book may be delivered immediately, exactly one newest book remains pending for the earliest instant at least 200 milliseconds later, no intermediate book is queued, and that trailing book contains the latest state

#### Scenario: A book failure occurs while a routine update is pending
- **WHEN** the book becomes stale or unavailable before a pending routine delivery fires
- **THEN** the non-live state is delivered immediately and is not delayed behind the routine book

#### Scenario: The book stays stale across consecutive diffs
- **WHEN** the shown book remains stale — for example a standing range shortfall at the deepest published page — while valid depth diffs keep arriving within one delivery window
- **THEN** the delivery that stated the transition into stale was immediate, and the deliveries that follow while the staleness persists remain bounded and latest-wins: one newest stale book at the trailing instant, no delivery per diff

#### Scenario: Book recovery completes while routine delivery is bounded
- **WHEN** a recovery rebuilds a live book
- **THEN** the recovered live state is delivered immediately rather than waiting for the ordinary depth window

#### Scenario: The depth owner is released
- **WHEN** a contract session with a pending depth delivery is released or replaced
- **THEN** its pending timer and book are discarded and nothing from that session is emitted later

### Requirement: Position labels are independent from price-scale typography
The `ENTRY` and `LIQ` annotations SHALL be drawn independently from the chart library's standard price-line titles and price-scale tick typography. Changing either annotation's font size SHALL NOT require reducing the price-scale font size. Their entry and liquidation lines and numeric scale prices SHALL remain visible, and each custom label SHALL stay aligned with the line it names as the chart resizes, scrolls or changes price range. An annotation SHALL be repainted whenever anything it states changes — its side wording and tone included — not only when its price or coordinate moves.

#### Scenario: Annotation text is made smaller
- **WHEN** the entry and liquidation annotation font is configured below the price-scale font
- **THEN** `ENTRY` and `LIQ` use the annotation size while ordinary scale ticks retain the independently configured scale size

#### Scenario: The chart range changes
- **WHEN** candles, positions or viewport movement change the price-to-coordinate mapping
- **THEN** each custom position label moves to the current coordinate of its own line

#### Scenario: A position lacks a usable liquidation price
- **WHEN** an open position has an entry price but no positive liquidation price
- **THEN** the entry annotation is drawn and no liquidation label or invented liquidation price is shown

#### Scenario: The position flips at an unchanged entry price
- **WHEN** a one-way position changes side at the same entry price under an unmoved viewport
- **THEN** the entry annotation states the new side and tone without waiting for a price or viewport change

### Requirement: The Futures chart offers a complete weekly interval
The Futures interval choices SHALL include `1w` immediately after `1d` in the chart toolbar and in the keyboard interval picker. Selecting `1w` SHALL replace the current interval through the same typed workstation path as every existing choice and SHALL deliver Binance weekly live candles and older weekly history as one isolated series. Weekly history SHALL remain keyed separately by contract and interval and SHALL treat consecutive weekly candles as seven days apart for continuity and local cache reuse.

The `15m` default, the behavior and order of all existing Futures intervals, unsupported-interval rejection, and Spot interval behavior SHALL remain unchanged. At supported workstation widths the added control SHALL remain visible and operable without introducing a toolbar scrollbar or hiding another interval.

#### Scenario: Weekly interval is visible
- **WHEN** the Futures chart toolbar is rendered
- **THEN** it shows a `1w` interval control immediately after `1d` and identifies it as an unselected or selected chart interval like the existing controls

#### Scenario: Weekly interval is selected from the toolbar
- **WHEN** the operator activates `1w`
- **THEN** the workstation accepts `1w`, replaces the previous interval subscription, and draws weekly live candles and weekly history without rows from the previous interval

#### Scenario: Weekly interval is selected from the keyboard picker
- **WHEN** the interval picker is opened with a query that matches `1w` and the operator selects it
- **THEN** the picker closes and the chart changes to the same `1w` reading as the toolbar control

#### Scenario: Weekly history is reused
- **WHEN** closed `1w` candles have been cached for a contract and the same contract and interval are reopened
- **THEN** contiguous weekly rows seven days apart are reused under the `1w` cache key and no daily or other interval row is mixed into them

#### Scenario: A previous interval answers late
- **WHEN** the operator switches to `1w` and a candle or history answer from the abandoned interval arrives afterwards
- **THEN** the late answer is ignored and the weekly series remains owned by the `1w` selection

#### Scenario: Existing defaults and validation remain in force
- **WHEN** the workstation opens without an explicit interval selection or receives an unsupported interval
- **THEN** it still opens at `15m`, rejects the unsupported value, and does not treat adding `1w` as permission for any other interval

#### Scenario: The toolbar is width constrained
- **WHEN** the Futures chart renders at a supported narrow workstation width
- **THEN** `1w` and every existing interval remain visible and operable without a horizontal toolbar scrollbar

### Requirement: Shared and multi-asset Futures money remains explicit beside compact row money
The positions and Closed Positions surfaces SHALL present leg-owned amounts separately from contract/account-shared adjustments. Shared buckets and distinct asset amounts SHALL remain visible in their rendered row/group, and shared/unattributed/conflict qualifications SHALL remain focusable rather than existing only in a hover title. A compact row-owned PnL or settled-money cell MAY show only its signed amount; its exact components and coverage qualification SHALL remain on that money element's accessible title without adding an inline badge. An empty partial reading SHALL NOT be described as proof that nothing settled.

#### Scenario: A contract has shared funding
- **WHEN** funding cannot be attributed between overlapping hedge legs
- **THEN** the contract group shows the funding once as shared and neither leg row claims it as its own wallet Net

#### Scenario: The only component is BNB
- **WHEN** complete additive ownership leaves `-0.003 BNB` as the only non-zero settled component of a round whose trade settlement asset is USDT
- **THEN** the visible surface keeps exact `-0.003 BNB` rather than rounding the non-zero movement to zero, a bare dash, or relabelled USDT amount, and the element retains exact Wallet Net plus any qualification

#### Scenario: An open position has settlement and auxiliary assets
- **WHEN** an open position has a settlement-asset total plus a commission or credit in another asset
- **THEN** every asset amount remains visible in the compact position cell while exact components and any row-owned partial qualification remain named on that money element

#### Scenario: A closed round settles in USDC
- **WHEN** Closed Positions renders a round whose proven settlement asset is USDC
- **THEN** its single `PnL` element retains the USDC denomination for exact realized and wallet detail and never labels or formats either value as USDT

#### Scenario: Exchange realized PnL has sub-cent or large exact precision
- **WHEN** a closed round carries a bounded exact realized-PnL decimal that would round, become signed zero, or lose integer precision as a JavaScript `Number`
- **THEN** the `PnL` cell rounds directly from the exact text to cents for its glance value except where that would hide a non-zero sub-cent amount as zero, and retains the unchanged exact signed decimal plus proven asset on the element without a JavaScript `Number`

#### Scenario: Open settled money has sub-cent or large exact precision
- **WHEN** an open position's canonical settled total or component contains a sub-cent decimal or a value beyond JavaScript's safe integer range
- **THEN** the position row sums exact signed decimal strings, shows a cents-rounded glance value except where that would hide a non-zero sub-cent amount as zero, and retains every unchanged exact total/component plus proven asset in its accessible breakdown

#### Scenario: Open settlement components cancel exactly
- **WHEN** one or more exact settlement-asset components belong to an open position and their signed sum is zero
- **THEN** the compact position cell states `0.00` in that asset and its accessible breakdown retains the cancelling components instead of presenting an absent reading

#### Scenario: Retained money is shown during a non-ready resource state
- **WHEN** a loading, stale, error, or idle settled-income resource is paired with contradictory precomputed exact wallet money
- **THEN** Closed Positions retains the visible amount but qualifies it and does not label it Wallet Net until the resource is ready

#### Scenario: A partial read contains no rows
- **WHEN** a bounded income read has no rows but does not completely cover the interval
- **THEN** the surface states that the result is partial rather than `Nothing settled`

#### Scenario: Unresolved closed intervals contain shared income
- **WHEN** shared income interval-matches only partial or unresolved closed rounds
- **THEN** Closed Positions can present it once as qualified shared money rather than omitting it or assigning it to one arbitrary row

#### Scenario: Shared income has no open or closed interval evidence
- **WHEN** a shared entry matches no known round interval or reliable fill
- **THEN** it remains global/account audit information, the Closed/account reconciliation may render it once as unattributed money, and no position row labels it as owned merely from symbol equality

#### Scenario: A delayed credit cannot be assigned to one Closed row
- **WHEN** a real commission credit posts outside every known round interval and has no reliable trade identity
- **THEN** Closed Positions shows the shared amount once with an unattributed qualification and every plausible row avoids claiming an exact wallet outcome

#### Scenario: One shared adjustment reaches open and closed scopes
- **WHEN** funding, insurance, or a commission credit can affect both a closed round and the next open round while Dock and Closed Positions are simultaneously rendered
- **THEN** the canonical amount appears in exactly one shared-adjustment group, all affected position rows remain qualified, and neither surface claims a second copy

#### Scenario: Shared qualification receives keyboard focus
- **WHEN** a keyboard or touch operator reaches a shared, unattributed, or conflicted adjustment group
- **THEN** the missing ownership explanation is visible and focusable without hover

#### Scenario: Compact row-owned money is partial
- **WHEN** one open-position or Closed PnL amount has incomplete coverage but no separate shared adjustment row
- **THEN** the cell keeps only the amount at a glance, uses its partial styling, and names the coverage reasons on the money element without adding a badge or second measure label

#### Scenario: Shared adjustments reorder after reconciliation
- **WHEN** a refreshed canonical ledger changes the order of already rendered shared adjustment buckets
- **THEN** each row keeps its stable entry identity so keyboard focus is not silently reassigned to a different monetary adjustment

#### Scenario: A large shared bucket gains another entry
- **WHEN** a shared adjustment contains up to the admitted lane-sized history and refresh adds or reorders member entries without changing its presentation kind, owner, symbol, or leg
- **THEN** its React identity remains one compact collision-safe scope key, no render sorts or serializes the complete member identity list, and the focused DOM row is updated rather than remounted

#### Scenario: Simultaneous shared buckets have similar labels
- **WHEN** open or Closed presentation contains multiple shared buckets whose visible labels overlap
- **THEN** presentation kind, owner, symbol, and leg distinguish their compact row identities without falling back to list index or member identities

#### Scenario: Open shared credit has unreliable identity
- **WHEN** an open-position shared bucket contains an unattributed commission credit whose canonical identity is content-derived
- **THEN** the visible and focusable row states that it is unattributed, names commission credit as the movement type, and exposes the `IDENTITY_UNRELIABLE` qualification instead of showing only a generic Shared label

#### Scenario: A shared representative has a reliable identity conflict
- **WHEN** an open or Closed shared bucket contains the deterministic representative of contradictory payloads that reuse one reliable identity
- **THEN** visible and focusable text identifies an identity conflict, and the selected amount is not labelled as ordinary Shared money or exact wallet Net

#### Scenario: Lane-sized shared bucket rerenders
- **WHEN** a canonical shared bucket contains a lane-sized member list and an unrelated React update rerenders its surface
- **THEN** the row reads the ledger's bounded component summary and does not rescan, map, filter, sort, or serialize the member entries to derive its name or identity

#### Scenario: Unrelated account state changes beside open positions
- **WHEN** orders, balances, history, or another state field changes while positions and settled-income content/window are unchanged
- **THEN** the memoized settled window and other stable row props retain identity so every open-position row is not recomputed solely because the parent state object changed

### Requirement: Closed history states scope and measure precisely
Closed Positions SHALL state fill reach and completeness per contract/position key, including when the visible result is empty. A cumulative quantity SHALL be named `Closed volume`; a primary value named `Position size` SHALL represent peak position size rather than cumulative turnover. Day headings and their tests SHALL accept the product locale rather than assuming one punctuation format.

#### Scenario: One contract is truncated and another is complete
- **WHEN** the review has complete fills for one contract and a page-limited window for another
- **THEN** each contract states its own reach and only the affected rows are qualified

#### Scenario: Empty review has incomplete discovery
- **WHEN** no closed round is shown but contract discovery or fill coverage is incomplete
- **THEN** the empty state states that more history may exist

#### Scenario: A round scales out and re-enters
- **WHEN** cumulative closed contracts exceed the maximum simultaneous exposure
- **THEN** the cumulative figure is labelled `Closed volume` and is not labelled position size

#### Scenario: Date punctuation differs by locale
- **WHEN** the runtime locale formats a day as `07/14` instead of `14.07`
- **THEN** the day remains a valid accessible heading and verification does not fail solely on punctuation order

#### Scenario: Two hedge legs share one settled contract
- **WHEN** BTCUSDT LONG has a settled reading and BTCUSDT SHORT has no leg-owned reading
- **THEN** the SHORT explanation says the same contract was read but no amount was assigned to that leg, and it does not call LONG one other contract

### Requirement: Live valuation does not repaint the held review
An incoming market valuation SHALL update the affected open-position presentation without rebuilding the held order or Closed Positions review. Opening a long review SHALL keep the mounted review work bounded: only a finite visible window plus overscan SHALL be rendered at once, while every held row remains reachable through an accessible review control.

#### Scenario: A mark ticks while Closed Positions is open
- **WHEN** a mark update changes one open position and the held history inputs have not changed
- **THEN** the Closed Positions review does not render again and its derived rounds are not folded again

#### Scenario: Only explanatory tape detail changes
- **WHEN** a tape-only update changes no accepted mark
- **THEN** the position aggregate does not recompute and the held review does not render

#### Scenario: Only mark freshness advances at the same price
- **WHEN** a newer valid mark frame repeats the accepted mark price and changes only its source time
- **THEN** freshness remains available without recomputing the numeric aggregate or action previews that do not display that time

#### Scenario: The review holds thousands of rounds
- **WHEN** the operator opens a Closed Positions review larger than the render window
- **THEN** the initial DOM row count remains bounded and the operator can reach older rows without another exchange read

#### Scenario: An execution changes history
- **WHEN** a new execution changes the held fills while Closed Positions is open
- **THEN** the review recomputes from the new history even if no mark changed

### Requirement: Position actions use current account facts and known safety bounds
Opening a close or margin action from a valued row SHALL retain only the row identity and current raw account position as command authority; a presentation valuation SHALL never be reclassified as an account snapshot. Once a successful positions resource confirms that the leg is absent, the action SHALL close or remain disabled rather than targeting a stale or reopened leg.

Margin adjustment SHALL fail closed independently by direction. ADD requires a known available balance. REMOVE requires a strictly positive maintenance requirement, a coherent account-risk snapshot, and a known removable amount. Unknown, zero, negative, or generation-mixed risk inputs SHALL NOT enable submission.

#### Scenario: A valued row opens an action and then disappears
- **WHEN** an action is opened from a live-mark row and a successful positions reading no longer contains that leg
- **THEN** the live-derived DTO is not relabelled as an account snapshot, no command remains enabled for the absent position, and a later position with the same symbol and side does not inherit the stale action draft

#### Scenario: ADD has no confirmed wallet bound
- **WHEN** available USDT is unknown
- **THEN** ADD is unavailable and no adjustment command is submitted

#### Scenario: REMOVE has incomplete risk inputs
- **WHEN** maintenance margin is absent, zero, negative, or not coherent with the current account position, or removable margin is otherwise unknown
- **THEN** REMOVE is unavailable and no adjustment command is submitted

### Requirement: Ticket account summaries distinguish unknown from empty
Ticket counts and empty-state copy SHALL be derived from resource availability. Zero and “none” SHALL be shown only after a successful authoritative read; idle, first-load, and never-successful error states SHALL remain unknown, while stale held data MAY remain visible with its stale status.

#### Scenario: Ticket opens before its first account read
- **WHEN** positions or orders are idle, loading, or failed without a prior successful reading
- **THEN** their count is shown as unknown and the Ticket does not state that there are no positions or orders

#### Scenario: Ticket receives a successful empty account read
- **WHEN** the corresponding account resource is ready with an authoritative empty list
- **THEN** the Ticket shows zero and its truthful empty-state copy

#### Scenario: Ticket holds stale successful rows
- **WHEN** refresh fails after a prior successful reading
- **THEN** the held count and rows remain visible with stale/error qualification rather than changing to either unknown or empty

### Requirement: A foreign-asset commission is valued in the result

When a commission is charged in an asset other than the settlement asset, the
desk SHALL value it in the settlement asset at the charge's own time and
include the valuation in the round's net and the open position's settled
money. The row face SHALL show one settlement-asset number and SHALL NOT
render the foreign-asset quantity as a visible second line; the element's
title SHALL name the charged quantity in its own asset, the valuation, and
the price used. When no price is readable for the charge's time, the desk
SHALL state the fee as not included rather than show a wrong number. A window whose fees were charged partly in the settlement asset and
partly in a foreign asset SHALL sum the settlement-asset fees exactly and
value only the foreign part. Per-asset wallet conservation SHALL remain
intact: the valuation is presentation onto the settlement-asset result, never
a mutation of the per-asset record.

#### Scenario: A round that paid its fees in BNB

- **WHEN** a closed round's fills carry `commissionAsset: "BNB"` on a USDT-settled contract
- **THEN** the round's net includes the BNB commission valued at the BNBUSDT price of the charge's time, and the row's title names the BNB quantity, the USDT valuation, and the price used

#### Scenario: The price for the charge's time is not readable

- **WHEN** a BNB commission's valuation price cannot be read
- **THEN** the fee is stated in BNB with "not included", the net excludes it, and nothing invents a price

#### Scenario: The BNB balance ran out mid-round

- **WHEN** a round's fills paid commission partly in BNB and partly in USDT
- **THEN** the USDT fees are summed exactly, only the BNB part is valued, and the title decomposes both

#### Scenario: The row face stays one number

- **WHEN** a closed round or an open position's settled money includes a BNB-charged commission
- **THEN** the cell renders a single settlement-asset figure with no visible BNB line, and the BNB quantity is readable only in the element's title

### Requirement: The fee reserve states its remaining worth

The desk SHALL show, once and globally rather than per row, the Futures
wallet's remaining fee-asset reserve: the BNB amount and its worth at the
current BNBUSDT price. When that worth falls below the low bound of
50 USDT equivalent, the readout SHALL be marked as low. When the reserve is
absent or its worth unreadable, the readout SHALL say so rather than show
zero as if it were a reading.

#### Scenario: The reserve runs low

- **WHEN** the Futures wallet's BNB balance is worth less than 50 USDT at the current BNBUSDT price
- **THEN** the reserve readout carries a low mark, warning ahead of Binance's silent revert to undiscounted USDT fees

#### Scenario: A healthy reserve

- **WHEN** the BNB balance is worth 50 USDT equivalent or more
- **THEN** the readout states the amount and worth unmarked, and no per-row surface repeats it

### Requirement: An announced charge awaiting its record is a wait, not a failure

When a settled read answers every request and the resource is incomplete only
because a charge the exchange announced has not yet appeared in the income
record, the desk SHALL NOT announce a failure and SHALL NOT ask the operator
to retry. The money the wait qualifies SHALL state on its own element that the
announced charge is still posting and when the confirming pass runs, in place
of the generic not-ready qualification — not as a popup or an inline banner,
which every close and every funding settlement would raise. "Failed", and the
kept-confirmed-reading stamp, SHALL be reserved for a pass whose outcome is
failed or whose requests went unanswered; a failure standing anywhere in the
resource SHALL keep the failure announcement even while a debt also stands.
The settled journal line SHALL state which of the two states an incomplete
pass was in, and how many lanes owe a confirmation. A count rather than the
lane names: that record writes only the fields its kind declares and admits no
list, so the names could not reach the file at all.

#### Scenario: The two minutes after a close

- **WHEN** the operator closes a position and a refresh-class settled pass runs before the confirming pass has proven the announced charge's income row
- **THEN** no failure popup and no banner fire, the round's money element states the charge is still posting and the time it is confirmed at, and the figures land without any operator action

#### Scenario: A real failure still announces

- **WHEN** a settled pass fails — a request refused, unanswered, or the walk's outcome is failed
- **THEN** the failure is announced once in the popup channel with the kept confirmed reading's stamp, and ↻ retries it

### Requirement: The chart's own labels keep off the edge prices are worked at

Labels the chart draws on its plotting area — the order handles and what they
are worth, and the open position's entry and liquidation annotations — SHALL be
drawn against the edge holding the oldest candles, not against the edge holding
the newest, because the newest candles are what the operator reads while
placing and moving an order. Their coloured edge SHALL face the line they name,
so a mirrored plate still reads as belonging to its price.

A handle the operator can drag, edit or cancel SHALL NOT be hidden behind an
ambient box the desk writes in the same corner. Where the two land on the same
pixels, the handle SHALL be the one drawn on top.

A label that is only read MAY sit flush against that edge. One the operator
reaches for SHALL be held off it by the same gutter the desk writes its own
corner notices at, and SHALL be shortened by that gutter so that insetting it
cannot push its far end past the opposite edge of the plot.

#### Scenario: The operator reaches for a handle at the plot's edge

- **WHEN** an order handle and a position annotation are drawn against the oldest-candle edge
- **THEN** the handle is inset by the desk's own corner gutter while the annotation stays flush, and the handle's width is reduced by that same gutter

#### Scenario: A working order and an open position are on screen

- **WHEN** the chart draws a working order's handle and the position's entry and liquidation annotations
- **THEN** each is drawn against the plot's oldest-candle edge, leaving the newest candles and the price scale unobstructed

#### Scenario: A handle lands on a corner the desk is writing in

- **WHEN** an order's price places its handle over the reading notice, the older-candles line, the order-sync line or the gesture hint
- **THEN** the handle is drawn over that box rather than behind it, and stays draggable and cancellable

### Requirement: A position row states which price it is read at, and what the exchange holds it at

Every surface that states an open position's unrealized PnL SHALL make both
figures available on the element that carries the reading: the figure at the
price the row is read at, and the exchange's own figure on its mark.

The reading SHALL be the headline. The mark's figure SHALL be stated under a
name of its own — never as a second unlabelled number, never merged into the
headline, and never with the same visual weight. On a surface with room for a
line of its own it SHALL be drawn quieter than the headline in size, emphasis
and colour, and SHALL be omitted while the row is already read at the mark,
because there is then nothing to state twice.

Where a surface names a price, it SHALL name which price it is. A column or row
labelled as the mark SHALL show the mark.

A live close estimate SHALL be computed at the price the position is read at
rather than at the mark: an exit fills near what the contract is printing.

#### Scenario: The contract prints between two marks

- **WHEN** an open position's contract trades after its latest mark
- **THEN** the row's headline PnL, its return on margin and the dock total move to the printed price, and the mark's own figure remains stated beside them

#### Scenario: A position is open on a contract that is not on screen

- **WHEN** the operator is watching one contract while holding positions in others
- **THEN** every open position is read on its own contract's prices, at the same freshness, whether or not it is the one being watched

#### Scenario: The row is already read at the mark

- **WHEN** a contract has not printed recently enough for its trade to be the newer price
- **THEN** the row is read at the mark and states no separate mark figure beside it

#### Scenario: The mark moves under a contract that is still trading

- **WHEN** a new mark arrives while the row is read at a recent print
- **THEN** the headline is unchanged, and the mark's stated figure, the position's notional and its margin are recomputed

### Requirement: Position rows are valued at the live price, and say which one

Between account snapshots, position rows SHALL be re-valued only from the live
position price feed. Unrealized PnL and return on margin SHALL follow whichever
of the contract's two prices the exchange stated more recently, as
`futures-order-visibility` fixes; the mark price column and USDT size SHALL
follow the mark. The dock total SHALL be derived from the same re-valued rows.
Unrealized PnL SHALL be derived as `(reading price − entry price) × signed
quantity`.

A position whose entry price, quantity, or live price is unusable SHALL retain
a confirmed account-snapshot unrealized PnL as a qualified fallback when one
exists. It SHALL NOT be partially re-valued from a mixture of current and stale
inputs. Where neither a complete live valuation nor a confirmed fallback exists,
the row and dock aggregate SHALL state that they are incomplete rather than
silently summing the known subset.

The mark column SHALL state the same confirmed mark the row's mark-derived
figures use. Source and freshness SHALL remain available so that a snapshot
fallback cannot be mistaken for a live price, and so that a row states which of
the two prices its own reading is on.

Return on margin SHALL use a denominator coherent with the displayed valuation.
When the same surface displays that denominator as position Margin, the amount
SHALL be the one used by the adjacent ROE rather than an older snapshot amount.
Position-only initial margin SHALL be preferred over an account figure that
includes working-order reserve. A live CROSS reading SHALL be unknown unless its
denominator can be derived for the current mark from a confirmed leverage; a
stale snapshot margin SHALL NOT be presented as current live ROE.

#### Scenario: The market moves with no account event

- **WHEN** a mark of `0.03600` arrives for a `-446082` contract position entered at `0.03140` and the contract has not printed since
- **THEN** the row's mark, USDT size, unrealized PnL and return on margin all change from that mark, and the dock total changes with them

#### Scenario: The price feed is not connected

- **WHEN** the feed reports no price for a symbol and the account snapshot has a confirmed unrealized PnL
- **THEN** the row and Ticket retain the snapshot reading with its source and age, and no aged price is presented as live

#### Scenario: A price arrives for a symbol with no open position

- **WHEN** a mark or a trade arrives for a symbol that is not in the position list
- **THEN** no row is created or changed

#### Scenario: One position cannot be valued

- **WHEN** at least one open position has neither a complete live valuation nor a confirmed snapshot fallback
- **THEN** the dock total is marked incomplete and states the missing-row count instead of presenting the sum of known rows as complete

#### Scenario: The account is not yet known

- **WHEN** the expanded positions resource has not produced its first confirmed reading
- **THEN** the expanded and collapsed dock both show an unknown aggregate rather than `+0.00`

#### Scenario: A live CROSS mark has no current denominator

- **WHEN** the mark advances but the position has no confirmed leverage from which current position margin can be derived
- **THEN** uPnL and notional remain complete while ROE is shown as unavailable rather than dividing by stale snapshot margin or working-order reserve

### Requirement: A control that reaches past its own panel says so

When an operator control governs anything outside the panel it sits in, that
panel SHALL state what else it governs, in the panel, beside the control — not
only in a specification or a commit message. It SHALL also state what it does
not govern where a reader could reasonably assume otherwise.

The reason is that the effect is invisible at the point of use. An operator
turning a dial down to make one panel quieter, months later and for an unrelated
reason, has no way to know what else they slowed unless the dial tells them.

That statement SHALL be drawn quieter than the control's own reading: it is
standing text that does not change when a value is applied, and the value is
what the operator opened the panel to see.

#### Scenario: The tape throttle also bounds position repricing

- **WHEN** the operator opens the Aggregate trades settings
- **THEN** the panel states that its throttle and timeout also bound how often open positions are repriced, and that marks keep their own once-a-second cadence

### Requirement: A live listing outside the execution path names itself
When the selected contract is catalogued, trading and perpetual, and the desk
still will not trade it — the execution path's alphabet excludes its ticker —
the order ticket SHALL state that as its own readiness gate, distinct from the
gate that means no active contract is selected. The refusal is deliberate and
SHALL read as one: the operator standing on a live chart is owed the reason the
ticket is dark, not an instruction to select what is already selected.

#### Scenario: The operator opens a CJK-ticker perpetual
- **WHEN** the catalogue delivers the contract as trading, perpetual and not tradable
- **THEN** the ticket's readiness gate reads LISTING with a reason naming the execution path, and order entry stays disabled

#### Scenario: No contract is selected at all
- **WHEN** the selected symbol has no catalogued contract behind it
- **THEN** the CONTRACT gate reads exactly as before this change

### Requirement: A fault of the book costs the book, not the session

When reading a stream frame raises the order book's own refusal — a crossed
book, an update the book's rules reject — the workstation SHALL rebuild the
book and nothing else, under the refusal's own code, whatever stream the frame
arrived on and however its name is spelled. A depth-stream frame the desk
cannot read SHALL likewise cost only the book, and the stream's name SHALL be
read in the exchange's own spelling, so a unicode listing's depth frames are
depth frames. Only an unreadable frame from the traded streams — price,
candles, tape — is worth the whole session.

Classified by an ASCII name instead, a unicode listing's every crossed book
became a full resynchronization: on 2026-08-28 the workspace on 龙虾USDT left
`live` every 20 to 60 seconds while the pair pumped, ~90 weight a round, for a
fault the book had already contained.

#### Scenario: The book crosses on a unicode listing

- **WHEN** a depth diff leaves the book crossed on a contract whose ticker the exchange spells outside ASCII
- **THEN** the book recovers under `CROSSED_ORDER_BOOK`, and the session neither resynchronizes nor leaves `live`

#### Scenario: A depth frame for a unicode listing cannot be read

- **WHEN** a frame from the listing's depth stream is refused by the parser
- **THEN** the book recovers under `MALFORMED_DEPTH_FRAME`, exactly as it would for an ASCII contract

#### Scenario: A traded stream's frame cannot be read

- **WHEN** a frame that is not from the depth stream cannot be read
- **THEN** the session resynchronizes under `MALFORMED_STREAM_FRAME`, exactly as before this change

### Requirement: The desk trades every contract it catalogues

A contract the catalogue admits — its symbol spelled in the exchange's
identity alphabet — that is `TRADING` and `PERPETUAL` SHALL be tradable from
the desk: the order ticket's readiness SHALL treat it exactly as any ASCII
major, with no separate execution alphabet. The desk maintains one spelling of
what a contract is; a second, narrower spelling held the operator's own
listing dark on 2026-08-28 while the account already carried 23 working
orders and two positions beside it.

The LISTING readiness gate remains defined for a contract delivered
catalogued, trading and perpetual yet not tradable — after this change a
divergence guard that is expected never to fire, and owed its honest reason
if it ever does.

#### Scenario: The operator opens a unicode perpetual

- **WHEN** the catalogue delivers a CJK-ticker contract as `TRADING` and `PERPETUAL`
- **THEN** the contract is tradable, the ticket shows no LISTING gate, and order entry follows the same readiness ladder as any contract

#### Scenario: A delivery-dated or non-trading contract

- **WHEN** the catalogue delivers a contract that is not `TRADING` or not `PERPETUAL`
- **THEN** it is not tradable, exactly as before this change

#### Scenario: Client order ids stay in the exchange's id charset

- **WHEN** an order on a unicode listing is placed, modified, or cancelled
- **THEN** every client order id the desk sends satisfies the exchange's ASCII id rule, because ids are never derived from the symbol

### Requirement: A handle rests on the line it prices

An order handle SHALL be drawn with its vertical centre on the y-coordinate of
the line it prices, at every count and density of working orders; a handle
SHALL NOT be displaced vertically to clear another handle. Only the plot's own
edges MAY displace a handle, and only by up to the half-plate that keeps the
whole handle on the pane and reachable.

Handles whose lines sit closer than one plate's height SHALL resolve the
collision sideways: the later handle steps into the next free column, cleared
past the widest plate of every column between it and the gutter by the desk's
column gap, with widths measured from the drawn plates rather than assumed. A
handle clear of any collision SHALL rest in the first column at the gutter.

A drag begun on a handle SHALL read the pointer's travel, not its position: at
the grab the pending price SHALL equal the order's resting price exactly,
wherever on the plate the pointer landed, and every move SHALL displace the
aimed price by the pointer's displacement since the grab. A drag begun where
no line coordinate is known MAY fall back to reading the pointer's position.

#### Scenario: A dense stack of orders

- **WHEN** several working orders rest within a few plate-heights of one another
- **THEN** every handle is drawn centred on its own order's line, and no handle
  is displaced vertically by a neighbour

#### Scenario: Two orders at one price

- **WHEN** two working orders rest at prices whose lines sit within one plate
  height of each other
- **THEN** both handles are drawn at their lines, the later one stepped
  sideways past the widest plate of the column before it, and both stay
  readable, draggable and cancellable

#### Scenario: The grab lands off the plate's centre

- **WHEN** the operator grabs a handle a few pixels off its centre and moves
  the pointer
- **THEN** the pending price starts at the order's resting price and moves by
  exactly the pointer's travel — the order does not jump by the landing offset

#### Scenario: An order's line reaches the pane's edge

- **WHEN** an order's line sits within half a plate of the plot's top or
  bottom edge
- **THEN** the handle is clamped only far enough to stay whole and reachable,
  and this is the one vertical displacement the chart may draw

### Requirement: The plate's face spends one letter on the leg and no unit on the value

An order handle's face SHALL name the position leg by a single letter — `L`
for LONG, `S` for SHORT — and SHALL state the order's notional as a bare
number with no unit word, because every character of plate is a candle
covered and colliding plates pay for their widest column in full. The full
leg word and the unit-qualified value SHALL stay readable under the cursor on
the elements' titles, and the accessible names SHALL keep their full wording.
The `ALGO` marker, the `exit` badge and the transient states (`lifting…`,
`triggered`, `placing…`) keep their words. The dragged mark SHALL wear the
same face as the resting plate it lifts.

#### Scenario: A resting order's plate

- **WHEN** the chart draws a working SELL SHORT order worth 22967 USDT
- **THEN** the plate reads `S` and `22967`, its titles carry `SHORT` and
  `22967 USDT`, and the accessible name still says the full
  `SELL SHORT … order at …`

#### Scenario: The unit survives where it is asked for

- **WHEN** the operator hovers a plate's value
- **THEN** the title states the exact notional with its unit

### Requirement: The plate's digits burn in the side's bright pair

The value on an order handle — and the price and value on the dragged mark —
SHALL be coloured by the order's side in the desk's bright digit pair: the
bright green the book's bids and the tape's buys write their numbers in for
BUY, the bright red of the asks and sells for SELL — lightened one step
toward white for the plate's small face, the step the operator asked for
after reading the pair at the plate's own size. The lightening SHALL be
declared as a mix over the book's own colour, taken from those rules rather
than restated, so the base cannot drift apart. The plate's frame,
leg letter and cancel control SHALL keep the plate's own dimmer side colour,
and the `exit` badge its quiet grey, so the digits outshine everything else
on the plate.

The digits SHALL carry enough stroke for the pair to reach full strength on
the screen: at a hairline size the antialiasing caps every pixel short of the
declared colour and the brightness never arrives — the operator's screenshot
sampled grey where the rule said bright red. Bold, at a size near the book's
own rows, is the floor.

#### Scenario: A wall of plates at a glance

- **WHEN** several buy and sell orders rest on the chart
- **THEN** each plate's value reads as a bright green or bright red number
  against its dimmer frame, a step lighter than the colours the book and the
  tape give those sides' numbers and unmistakably of the same tone

#### Scenario: The book's digit pair is retuned

- **WHEN** the desk changes the colour the book writes bid or ask numbers in
- **THEN** the plates' digits follow, because they are declared as that pair,
  not as a copy of it

#### Scenario: The declared colour reaches the screen

- **WHEN** a plate's digits are rendered at the plate's own size
- **THEN** the brightest pixels of the digits carry the pair's full colour,
  not an antialiased fraction of it — judged on the rendered frame, because
  the computed style states the declaration either way

### Requirement: A background contract loads in a free minute
A held session that is not being shown SHALL NOT open a socket or issue a
REST read on its own account. When it loses its stream, fails its freshness
rule, or needs its book rebuilt, it SHALL be parked: its sockets closed,
its timers cleared, its last state kept with the reason, and no reconnect
scheduled. A parked session SHALL be rebuilt at once when the operator
selects it, taking the screen. Otherwise it SHALL be rebuilt only by the
desk's warmer, one parked session at a time, most recently shown first, and
only while the shown session is bootstrapped and live, the public read
budget has a stated amount of room, and a stated floor has passed since
the last such rebuild. A wake that fails SHALL park the session again and
hold it for the floor doubled per failed wake, to a stated ceiling, behind
every parked session not yet tried; a wake that brings the contract up with
a bridged book SHALL clear the count. A contract that leaves the screen on
its ladder, on its candle ladder or inside a recovery round SHALL be parked
under the reason it was stating. The operator's ruling, 2026-09-03: the
shown contract is always current; the rest load in a free minute; a
background contract never reconnects on its own.

#### Scenario: A proxy storm with eight contracts held
- **WHEN** the streams of every held contract close within a few seconds
- **THEN** the shown contract reconnects on its ladder, every other held contract is parked with the close's reason, and no read or socket is issued for them until the shown contract is live again

#### Scenario: A free minute after the storm
- **WHEN** the shown session is live, the public budget has room, and the floor has passed
- **THEN** one parked contract is rebuilt, and the next one no sooner than the floor after it

#### Scenario: The operator selects a parked contract
- **WHEN** a parked contract is selected
- **THEN** it is rebuilt at once, takes the screen, and states its reason and `loading` meanwhile

#### Scenario: A background book gaps
- **WHEN** a held session that is not shown proves a sequence gap or a crossed book
- **THEN** the session is parked and no depth page is read for it

#### Scenario: The shown contract is reconnecting
- **WHEN** the shown session is on its reconnect ladder, on its candle ladder, bootstrapping an interval or recovering its book
- **THEN** no parked contract is rebuilt, whatever room the budget has

#### Scenario: The shown contract leaves the screen mid-recovery
- **WHEN** the operator selects another contract while the shown one is on its ladder, on its candle ladder or inside a recovery round
- **THEN** the contract that left the screen is parked under the reason it was stating, its rung never fires, and no page and no bootstrap is read for it

#### Scenario: A wake keeps failing
- **WHEN** a parked contract's wake fails
- **THEN** it is parked again and held twice the floor before its next wake, doubling per failed wake to the ceiling, and every parked contract not yet tried is woken before it

#### Scenario: A woken contract is no longer listed
- **WHEN** the warmer wakes a parked contract the exchange no longer lists
- **THEN** it stands unavailable in the pool, neither parked nor loading, and the next parked contract still gets its minute

### Requirement: A reload rebuilds the shown contract only
Subscribing to a contract the desk already holds SHALL deliver the held
session without a bootstrap, or rebuild it at once if it is parked, and
SHALL touch no other held session. Starting the desk SHALL open the shown
contract only.

#### Scenario: The window is reloaded during an outage
- **WHEN** the renderer subscribes again to the contract it was showing while the route is down
- **THEN** that contract alone is rebuilt or resumed, and the other held contracts stay as they were

#### Scenario: The window is reloaded on a live desk
- **WHEN** the renderer subscribes again to a contract whose session is live
- **THEN** its state is delivered from what the session holds, with no read and no socket

### Requirement: The chart draws what it is handed on a selection change
When the chart's series generation changes — a new contract or a new
interval — the chart SHALL clear its series and then draw the rows it is
handed for the new generation in full, whether or not the rows' reference
changed. A held series drawn through an interval switch SHALL reach the
canvas by this rule and not by an intermediate render.

#### Scenario: An interval switch hands the chart the same rows
- **WHEN** the interval changes and the rows handed to the chart are the same array as before
- **THEN** the chart clears and redraws those rows, and the canvas is not empty until the new series lands

#### Scenario: The new series lands
- **WHEN** the new interval's rows replace the held ones
- **THEN** the chart replaces the series in full without refitting the viewport
