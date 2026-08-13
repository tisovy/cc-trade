## MODIFIED Requirements

### Requirement: The book states the band it can prove
A snapshot proves a band of prices: within it every level is either from the
snapshot or from a diff applied since, and outside it only the levels a diff has
touched are known. The book SHALL record that band and SHALL deliver only levels
within it, so that no row aggregates a range the book cannot account for. When
the market leaves the band, the band SHALL be re-established by a fresh snapshot
rather than by extending the book past what it can prove.

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
unusable for seeding a price — permanently, on a contract the exchange does not
publish deep enough for the step it is read at.

#### Scenario: A diff touches a level outside the band
- **WHEN** a depth diff carries a level beyond the range the snapshot covered
- **THEN** the delivered book does not present it, because the levels beside it are unknown

#### Scenario: The market moves past the band
- **WHEN** trading moves the best price far enough that the proven band no longer covers the rows on screen
- **THEN** a fresh snapshot is taken and bridged, and the rows are drawn from the new band

#### Scenario: The band was wide enough and the market simply moved
- **WHEN** the band no longer covers the rows but its span is wider than they need
- **THEN** the page already held is read again rather than a deeper one bought, so a drifting market cannot climb the desk to the deepest page

#### Scenario: The market moves past a band bought at the deepest page
- **WHEN** the best price leaves a band read at the deepest page the exchange publishes
- **THEN** that page is read again, centred where the market is now, rather than the book going on dropping the levels it can no longer prove

#### Scenario: A grouped row would span unproven ground
- **WHEN** the rows on screen would need more range than the band proves
- **THEN** the panel shows the rows it can prove until the deeper snapshot lands, rather than rows built on partial levels

#### Scenario: One side of the band falls short of the rows
- **WHEN** the band reaches past the rows on one side and falls short of them on the other
- **THEN** the shortfall is measured on the side that falls short, and a page deep enough for that side is bought, rather than the wide side being taken as proof that the reading is covered

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
