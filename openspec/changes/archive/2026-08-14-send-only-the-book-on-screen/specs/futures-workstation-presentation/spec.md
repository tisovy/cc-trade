## MODIFIED Requirements

### Requirement: The order book is denominated in USDT and groupable
The order book SHALL express each level's size and cumulative size in USDT,
SHALL let the operator group levels by a price step derived from the contract's
tick size, and SHALL show the levels reached by that grouping rather than a
fixed ten per side. The `Spread` and raw update-id readouts SHALL be replaced by
the last traded price.

Because grouping is applied after delivery, the number of raw levels delivered
to the renderer SHALL be at least the deepest view the grouping control can ask
for and fully fill. That depth is the range the panel has stated it reads — the
rows on screen times the step they are grouped by — and delivery SHALL be bounded
by it rather than carrying the whole retained book: a level further from the mid
than the panel can draw is paid for on both sides of the transport and then
discarded. A session that has not been told a range SHALL be delivered at the
protocol ceiling, so a book is never short because the panel has not spoken yet,
and delivery SHALL NOT exceed the depth the exchange publishes. The bound the
payload validator enforces SHALL be the same value the book is built to, so a
book that is legal to build is never rejected on arrival.

Delivery SHALL keep a floor of levels under the stated range, and that floor
SHALL be the same value as the most rows the panel will draw. A range is rows
times step, which assumes a level resting on every step; ungrouped a row is one
raw level and the distance those rows span is wherever the market happens to
rest, so on a sparse book the range names a distance the rows overflow. The
floor is what makes the bound safe at every grouping step rather than only at the
coarse ones.

A reading the panel states SHALL be answered from the book already held rather
than at the next delivery the market happens to produce. The trim is on delivery
and never on what is retained, so a coarsened step needs no read and no wait; a
book left trimmed to the previous reading until the next diff arrives would
answer a quiet contract — the one most likely to be read at a coarse step — not
at all.

A delivered level SHALL carry its price and its resting quantity. It SHALL NOT
carry a running total: a total accumulated over raw levels is not a total over
grouped rows, so the panel computes the only cumulative column it can display,
and a second one costs a decimal addition per level, a third of every frame's
bytes, and a validation pass — to be discarded on arrival.

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

#### Scenario: The panel reads a narrow range
- **WHEN** the panel has stated a range that a fraction of the retained book covers
- **THEN** the delivered book carries the levels within that range on each side, and the levels beyond it are retained in the main process rather than sent

#### Scenario: The panel widens its reading
- **WHEN** the operator coarsens the step so the rows span further than the last delivery carried
- **THEN** the deeper levels are delivered from the book already held, without a fresh snapshot and without waiting for the next diff, because the trim was on delivery and never on what was retained

#### Scenario: The book is read ungrouped on a sparse contract
- **WHEN** the panel draws each raw level as its own row and the levels resting on the contract span further than the stated range
- **THEN** the delivery keeps the floor of levels under that range, so no row the panel can draw is missing

#### Scenario: A book is delivered before the panel has stated its reading
- **WHEN** the first book of a session is delivered and no range has been stated for the contract
- **THEN** it is delivered at the protocol ceiling, so no row the panel is about to ask for is missing

#### Scenario: A delivered level is read
- **WHEN** the renderer reads a level out of a delivered book
- **THEN** it finds the level's price and resting quantity, and computes the cumulative column itself from the rows it has grouped
