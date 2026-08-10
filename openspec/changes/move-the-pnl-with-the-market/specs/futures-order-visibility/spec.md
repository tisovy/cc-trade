## ADDED Requirements

### Requirement: An open position's value moves with the market between marks
Between two mark-price updates, an open position's unrealized PnL and its
percentage SHALL be re-priced against the most recent traded price for that
contract, at a bounded repaint rate. When a mark arrives, the confirmed
mark-based figure SHALL replace the estimate.

#### Scenario: The market moves between two marks
- **WHEN** trades print for a contract holding an open position and no new mark has arrived
- **THEN** the position's value and PnL follow those prints rather than standing still

#### Scenario: A mark arrives
- **WHEN** a mark price arrives for that contract
- **THEN** the position's PnL is the exchange's own arithmetic on that mark

### Requirement: An estimated reading says that it is estimated
A PnL re-priced from the last traded price SHALL be presented as an estimate,
distinguishably from one computed on a confirmed mark. Liquidation price and
liquidation distance SHALL NOT be estimated this way.

#### Scenario: The operator reads an interpolated PnL
- **WHEN** the value shown was computed from the last trade rather than from a mark
- **THEN** the surface shows it as an estimate, and the liquidation reading remains the mark's
