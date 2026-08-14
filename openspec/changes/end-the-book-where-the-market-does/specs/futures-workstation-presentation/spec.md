## ADDED Requirements

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

## MODIFIED Requirements

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

#### Scenario: The coarsest step is offered on a contract whose held book ends early
- **WHEN** the book states a reach that the second-coarsest rung fits inside and the coarsest does not
- **THEN** the coarsest rung is not offered, and the step above it is the last one the operator can select

#### Scenario: No reach has been stated yet
- **WHEN** the book has been delivered from a page the exchange offers a deeper one than
- **THEN** every rung of the ladder is offered, so the operator can select the step that buys the deeper page

#### Scenario: One order rests far past the rest of a side
- **WHEN** a side holds a resting order much further from the market than the levels behind it
- **THEN** the stated reach is not stretched to it, and the ladder is cut where the side still has levels to fill rows from

#### Scenario: A side has too few levels to leave any out
- **WHEN** the share to be left outside the reading rounds down to no levels at all
- **THEN** the side is measured to its own furthest level

#### Scenario: The two sides reach differently
- **WHEN** one side of the page proved further than the other
- **THEN** the ladder is cut against the narrower side, so neither half of the panel is asked for rows that cannot be filled

#### Scenario: A remembered step is past the end of the ladder
- **WHEN** a contract is opened at a step stored from a reading whose reach was wider than the current one
- **THEN** the book is drawn at the coarsest step now offered, and the stored step is left as it is

#### Scenario: The operator reads how far the book goes
- **WHEN** the book states a reach
- **THEN** the panel states it as a share of price beside the step control, and states nothing there while no reach has been stated
