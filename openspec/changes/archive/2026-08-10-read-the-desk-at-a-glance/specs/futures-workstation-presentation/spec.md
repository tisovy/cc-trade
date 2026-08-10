## ADDED Requirements

### Requirement: An amount too large to read is abbreviated by magnitude
An amount whose magnitude is what it is read for SHALL be shown abbreviated —
thousands, millions and billions — rather than as its full digit string, and the
exact figure SHALL remain available on the element. No abbreviation SHALL leave a
suffix that abbreviates nothing, such as thousands of millions.

#### Scenario: A daily volume is displayed
- **WHEN** the market header shows a 24-hour volume of tens of millions
- **THEN** it is shown as a magnitude with one decimal and its unit, and the exact figure is on the element's title

#### Scenario: An amount reaches the billions
- **WHEN** an abbreviated amount is a billion or more
- **THEN** it carries a billions suffix rather than being printed as a four-digit millions figure

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

#### Scenario: A uPnL and its ROE together outgrow the column
- **WHEN** an unrealized PnL and the ROE beside it are wider than the column allows
- **THEN** the percentage is shown whole, the amount gives way with an ellipsis, and both figures are stated exactly in the cell's title

### Requirement: The rail marks the contracts recently worked with
The instrument rail SHALL mark a contract the operator has recently selected as
recent, whether the row came from the catalogue or from stored history, and SHALL
keep the recency list across a restart of the app.

#### Scenario: A recent contract is confirmed by the catalogue
- **WHEN** the catalogue delivers a contract that is in the recency list
- **THEN** the row is marked as recent rather than carrying only its contract type, and it is not listed twice

#### Scenario: The app is restarted
- **WHEN** the operator selects a contract, closes the app and reopens it
- **THEN** the rail lists that contract first, marked as recent, before the catalogue arrives

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
