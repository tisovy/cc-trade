## MODIFIED Requirements

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

#### Scenario: A delivered row is read
- **WHEN** the renderer reads a row out of a delivered book
- **THEN** it finds the bucket's price, its resting quantity, its value and its key, and computes the cumulative column itself from the rows on screen

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
