## ADDED Requirements

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

## MODIFIED Requirements

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
