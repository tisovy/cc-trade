## MODIFIED Requirements

### Requirement: The book is bought at the page the reading needs
The depth snapshot SHALL be requested at the smallest page the exchange prices
that covers the range the book is being read at — the rows on screen multiplied
by the grouping step. The range SHALL be stated by the panel that draws the rows,
and SHALL travel with the request that selects the contract, so that the page
covering it is bought against the first band a snapshot proves rather than after
a second message and whichever diff happens to arrive next. A page is a count of
levels and a range is a distance in price, and no reading translates one into the
other before a band has been read; what the carried range removes is the wait,
not the first read. A contract selected without a stated range SHALL be opened at
the largest page the exchange charges its lowest weight for, and a reading that
needs a wider range SHALL take the page that covers it in one read rather than
climbing to it. A range stated for one contract SHALL NOT be carried to another —
it is a distance in the contract's own quote currency, and means nothing in
another's.

Buying a deeper page SHALL NOT be held behind the backoff that governs a failed
recovery. The ladder of pages is finite and ratchets in one direction only, so it
cannot loop; a recovery that failed SHALL still back off, and the read budget
SHALL remain the ceiling on what deepening may spend.

#### Scenario: A contract is opened at the default step
- **WHEN** the operator selects a contract and reads its book at the finest step
- **THEN** the snapshot is taken at the cheapest page that covers the rows on screen, not at the deepest page the exchange offers

#### Scenario: The operator coarsens the step
- **WHEN** the operator selects a grouping step whose rows span a wider range than the current snapshot proved
- **THEN** a deeper snapshot is taken and bridged, and the rows are drawn from it

#### Scenario: Another contract is opened
- **WHEN** the operator switches to a contract priced differently from the one being left
- **THEN** its book is bought at the cheapest page, and only the range its own rows need deepens it

#### Scenario: A contract is opened at the step it was last read at
- **WHEN** the operator selects a contract whose grouping step was stored from an earlier reading of it
- **THEN** the reading stated for that contract is the one its own step needs, from the first frame it is drawn in, rather than the reading of the contract being left

#### Scenario: The panel states its reading before the book exists
- **WHEN** the panel states the range its rows need before the subscription that will carry the book has been established
- **THEN** the range reaches that subscription once it exists, rather than being lost with the one it was stated against

#### Scenario: A contract is opened at a step that needs a deep page
- **WHEN** the operator selects a contract whose stored grouping step needs a page several rungs deeper than the cheapest
- **THEN** the reading travels with the request that opens it, and the covering page is bought in one further read against the band the first snapshot proved, rather than the book climbing rung by rung across cooldowns

#### Scenario: The panel has drawn nothing for the contract being opened
- **WHEN** the first contract of a session is selected, before any book has been drawn to state a reading for it
- **THEN** the request states no range and the book opens at the cheapest page, and the reading is stated once the panel has one

#### Scenario: The book is short by several rungs
- **WHEN** the band falls short of the rows by more than one rung of the ladder
- **THEN** the page that covers the reading is bought in one read, without waiting out a recovery backoff between rungs

#### Scenario: Recovery keeps failing
- **WHEN** a snapshot read fails repeatedly while a shortfall persists
- **THEN** the recovery still backs off between attempts, and the persistent shortfall does not turn it into a hot loop

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
