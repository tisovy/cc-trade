## MODIFIED Requirements

### Requirement: A held session is a whole session, shown or not
A held session SHALL carry every stream it would carry while shown, including
the depth diff, and SHALL keep its order book, tape and candles current whether
or not it is the one being shown. Being shown SHALL decide only whether the
session delivers to the renderer.

Keeping the book current means applying every diff the exchange sends it. It
SHALL NOT mean buying pages of the book from the exchange: the depth of page a
book is held at answers how far the rows drawn from it reach past the best
price, and a session that is not shown draws no rows. A session that is not
shown SHALL NOT issue a depth read to cover a reading, and the reading SHALL be
answered when the contract is selected.

#### Scenario: A held contract is selected
- **WHEN** the operator selects a contract whose session is held but not shown
- **THEN** its book, tape and candles are delivered as the session already holds them, with no snapshot read and no stream opened

#### Scenario: A held contract is not shown
- **WHEN** a held session is not the one being shown
- **THEN** it keeps parsing its streams and updating its state, and delivers nothing to the renderer

#### Scenario: The band of a held contract stops covering its reading
- **WHEN** a session that is not being shown holds a book whose band no longer covers the reading last stated for that contract, or no longer holds the market
- **THEN** no depth read is issued for it, and the page is bought when the contract is selected

#### Scenario: The shown contract's band stops covering its reading
- **WHEN** the band of the contract being shown stops covering the rows on screen
- **THEN** a page is bought for it exactly as before

### Requirement: The book states the band it can prove
A snapshot proves a band of prices: within it every level is either from the
snapshot or from a diff applied since, and outside it only the levels a diff has
touched are known. The book SHALL record that band and SHALL deliver only levels
within it, so that no row aggregates a range the book cannot account for. When
the market leaves the band, the band SHALL be re-established by a fresh snapshot
rather than by extending the book past what it can prove — for the contract
being shown. For a contract that is held and not shown, the band SHALL be
re-established when the contract is selected.

A book that no longer holds the market SHALL be delivered as stale whether or
not a reading has been stated for it. With no reading stated there is no
shortfall to measure, so a book the market had walked out of was being stated as
live on the ground that nothing had been asked of it.

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

#### Scenario: The market walks out of the band of a contract nobody is showing
- **WHEN** the best price leaves the proven band of a held session that is not being shown
- **THEN** no snapshot is taken for it, and the band is re-established when the contract is selected

#### Scenario: The market has walked out of the band, and no reading is stated
- **WHEN** a book whose reading is unstated no longer holds the market
- **THEN** it is delivered as stale rather than live
