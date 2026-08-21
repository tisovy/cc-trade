## ADDED Requirements

### Requirement: An open position's unrealized PnL is mark-authoritative
Every primary surface that states Futures unrealized PnL, return on margin, position value, or an aggregate of those readings SHALL use the current exchange mark for that position. A last trade or any price extrapolated from trades SHALL NOT change those primary readings. When no current mark is available, a confirmed account-snapshot unrealized PnL MAY remain as a visibly qualified fallback; otherwise the reading SHALL be unknown rather than zero.

The last traded price MAY explain why the chart and the mark-based position disagree, or MAY support a separately named what-if reading, but that value SHALL NOT be labelled uPnL, included in the dock total, or used by margin, liquidation, or risk decisions.

#### Scenario: A trade prints between marks
- **WHEN** aggregate trades print after the latest mark and no new mark has arrived
- **THEN** primary uPnL, return on margin, position value, and aggregate uPnL do not change

#### Scenario: A mark changes
- **WHEN** a new valid mark arrives for an open position
- **THEN** every primary position valuation changes from that mark in one consistent direction and the aggregate is recomputed from the same readings

#### Scenario: The tape and mark straddle entry
- **WHEN** a short entered at `3.3450` has a mark of `3.36` and last trade of `3.30`
- **THEN** primary uPnL reports the loss implied by the mark, while any tape-based profit is explicitly secondary and non-additive

#### Scenario: No current mark exists
- **WHEN** an account snapshot contains a confirmed unrealized PnL but the live mark feed is unavailable
- **THEN** the snapshot value is retained with its snapshot age/source, and no aged mark is described as live

#### Scenario: Neither mark nor snapshot can value the position
- **WHEN** an open position lacks both a usable current mark and a confirmed snapshot uPnL
- **THEN** its primary valuation and any aggregate that requires it are reported as incomplete rather than zero

## REMOVED Requirements

### Requirement: An open position's value moves with the market between marks
**Reason**: Carrying a mark forward with independent tape movement creates a synthetic third price that is neither Binance mark nor last trade and contradicts the later mark-authoritative requirement.
**Migration**: Primary uPnL moves only on mark updates; optional tape what-if output is separately named and excluded from totals and risk.

### Requirement: An estimated reading says that it is estimated
**Reason**: The requirement legitimizes a tape-derived primary PnL estimate, which can reverse the sign of the exchange's mark-based uPnL.
**Migration**: Preserve tape/mark disagreement as explanatory secondary detail under the new mark-authoritative requirement.
