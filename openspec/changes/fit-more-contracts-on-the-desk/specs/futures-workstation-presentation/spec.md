## MODIFIED Requirements

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

### Requirement: The rail marks the contracts recently worked with
The instrument rail SHALL present contracts the operator has recently selected
as a stable three-column group of compact pills rather than as full-width
contract rows or rows carrying a `recent` suffix. The group SHALL preserve
most-recent-first order across an app restart, and each row SHALL hold three
equal-width pill slots at the instrument rail's supported workstation width.
Long symbols SHALL remain within their slot and expose their full value without
changing the grid tracks.

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
- **THEN** it is visually truncated within that slot while its selection control still exposes the full symbol

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
