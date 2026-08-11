## ADDED Requirements

### Requirement: The book is bought at the page the reading needs
The depth snapshot SHALL be requested at the smallest page size that covers the
price range the book is being read at — the rows on screen multiplied by the
grouping step, with margin. The default SHALL be the largest page the exchange
charges its lowest weight for. A reading that needs a wider range SHALL cause a
deeper page to be taken, and the page a contract was last read at SHALL be
remembered with the rest of how its book is read.

#### Scenario: A contract is opened at the default step
- **WHEN** the operator selects a contract and reads its book at the finest step
- **THEN** the snapshot is taken at the cheapest page that covers the rows on screen, not at the deepest page the exchange offers

#### Scenario: The operator coarsens the step
- **WHEN** the operator selects a grouping step whose rows span a wider range than the current snapshot proved
- **THEN** a deeper snapshot is taken and bridged, and the rows are drawn from it

#### Scenario: The contract is opened again
- **WHEN** the operator returns to a contract whose book was last read at a coarse step
- **THEN** its snapshot is taken at the page that step needs, without climbing to it

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

#### Scenario: A grouped row would span unproven ground
- **WHEN** the rows on screen would need more range than the band proves
- **THEN** the panel shows the rows it can prove until the deeper snapshot lands, rather than rows built on partial levels
