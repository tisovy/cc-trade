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

#### Scenario: Chart is rendered for a live contract
- **WHEN** the workstation is live on a contract
- **THEN** no index series, no index price line, and no index header field are present

#### Scenario: Operator picks a price on the chart
- **WHEN** the operator clicks a price to seed the order draft
- **THEN** the draft is reflected in the ticket without adding a coloured label to the price axis

### Requirement: The instrument rail carries no exchange-filter reference panel
The instrument rail SHALL NOT present a contract-filter reference panel. Exchange filters SHALL remain enforced on every order draft and SHALL be reported only when they block a specific action.

#### Scenario: A contract is selected
- **WHEN** the operator selects a contract
- **THEN** no tick-size, step-size, percent-price, max-orders, or minimum-notional reference panel is rendered

#### Scenario: A draft violates a filter
- **WHEN** a draft order violates a symbol filter
- **THEN** the ticket states the violated constraint for that draft

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

#### Scenario: Operator reads a level
- **WHEN** a level rests at a price with a base quantity
- **THEN** the row shows the price, the level's value in USDT, and the cumulative value in USDT from the top of the book

#### Scenario: Operator groups the book
- **WHEN** the operator selects a price step that is a multiple of the contract tick size
- **THEN** levels within one step are aggregated into a single row whose price is the step boundary on that side, and their USDT values are summed

#### Scenario: Contract has no usable tick size
- **WHEN** the contract's filters have not arrived
- **THEN** the book renders ungrouped at exchange precision instead of failing

### Requirement: The order book states which side is leaning on it
The order book SHALL show the split between resting buy and sell value across a
symmetric window of levels — the same number of levels on each side, being the
number the visible side displays — as a two-colour bar with both percentages
stated in text, measured in USDT rather than by level count. The price range
that window covers SHALL be stated beside the split.

#### Scenario: Bids rest more value than asks
- **WHEN** the visible bids hold three times the USDT the visible asks hold
- **THEN** the bar is three quarters positive-coloured and states 75.00% buy against 25.00% sell

#### Scenario: Operator changes the price step
- **WHEN** the grouping step changes the range of prices on screen
- **THEN** the split is recomputed over exactly the levels now displayed

#### Scenario: Operator reads one side only
- **WHEN** only one side is displayed, over twice as many levels
- **THEN** the split is still measured over both sides at that deeper level count, and the stated range says how far it now reaches

#### Scenario: No book is available
- **WHEN** neither side has any resting value
- **THEN** no split is shown at all, rather than an even one

### Requirement: Instrument recency survives a restart independently of the catalogue
The instrument rail SHALL list the persisted recent contracts from the first
frame after a restart, before the contract catalogue has arrived, and SHALL
state that the catalogue is still loading rather than showing an empty list.

#### Scenario: Application restarts
- **WHEN** the workstation mounts with a persisted recency list and no catalogue yet
- **THEN** the recent contracts are listed and selectable, and the list reports that the catalogue is loading

#### Scenario: Catalogue arrives
- **WHEN** the catalogue arrives
- **THEN** each recent entry is replaced by its catalogue row in place, keeping recency ordering

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
direction, and available balance SHALL be shown to cents.

#### Scenario: Funding is negative
- **WHEN** the funding rate is negative
- **THEN** it is rendered in the negative colour, and positive funding in the positive colour

#### Scenario: Operator reaches for a direction
- **WHEN** the long and short controls are displayed
- **THEN** long controls carry the positive colour and short controls the negative colour, so direction is readable without reading the label

#### Scenario: Balance carries exchange precision
- **WHEN** the exchange reports an available balance such as `245228.33961912`
- **THEN** the ticket shows it to two decimals

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
previously shown price, and SHALL carry a directional glyph so the direction is
not conveyed by colour alone. It SHALL NOT be tinted by the buyer-maker flag of
the newest displayed trade, which may belong to a print the tape filter kept on
screen long after the market moved past it.

#### Scenario: Price rises
- **WHEN** the resolved last price is higher than the one previously shown
- **THEN** the row reads as an upward move, in the buy colour and with an upward glyph

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
- **WHEN** the operator selects another contract
- **THEN** the side mode is kept, because it is a way of reading a book rather than a property of one contract

