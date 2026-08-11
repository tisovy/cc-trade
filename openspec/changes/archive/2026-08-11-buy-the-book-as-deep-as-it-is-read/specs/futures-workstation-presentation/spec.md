## ADDED Requirements

### Requirement: The book is bought at the page the reading needs
The depth snapshot SHALL be requested at the smallest page the exchange prices
that covers the range the book is being read at — the rows on screen multiplied
by the grouping step. Every contract SHALL be opened at the largest page the
exchange charges its lowest weight for, and a reading that needs a wider range
SHALL take the page that covers it in one read rather than climbing to it. The
range SHALL be stated by the panel that draws the rows, and a range stated for
one contract SHALL NOT be carried to another — it is a distance in the
contract's own quote currency, and means nothing in another's.

#### Scenario: A contract is opened at the default step
- **WHEN** the operator selects a contract and reads its book at the finest step
- **THEN** the snapshot is taken at the cheapest page that covers the rows on screen, not at the deepest page the exchange offers

#### Scenario: The operator coarsens the step
- **WHEN** the operator selects a grouping step whose rows span a wider range than the current snapshot proved
- **THEN** a deeper snapshot is taken and bridged, and the rows are drawn from it

#### Scenario: Another contract is opened
- **WHEN** the operator switches to a contract priced differently from the one being left
- **THEN** its book is bought at the cheapest page, and only the range its own rows need deepens it

#### Scenario: The panel states its reading before the book exists
- **WHEN** the panel states the range its rows need before the subscription that will carry the book has been established
- **THEN** the range reaches that subscription once it exists, rather than being lost with the one it was stated against

### Requirement: The book states the band it can prove
A snapshot proves a band of prices: within it every level is either from the
snapshot or from a diff applied since, and outside it only the levels a diff has
touched are known. The book SHALL record that band and SHALL deliver only levels
within it, so that no row aggregates a range the book cannot account for. When
the market leaves the band, the band SHALL be re-established by a fresh snapshot
rather than by extending the book past what it can prove.

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
