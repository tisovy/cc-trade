## MODIFIED Requirements

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
the recent set.

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

## ADDED Requirements

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
