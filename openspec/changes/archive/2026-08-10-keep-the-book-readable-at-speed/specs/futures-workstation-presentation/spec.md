## ADDED Requirements

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

## MODIFIED Requirements

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
