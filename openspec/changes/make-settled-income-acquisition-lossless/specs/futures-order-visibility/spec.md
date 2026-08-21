## ADDED Requirements

### Requirement: Income pagination does not skip timestamp peers
Each income type SHALL be read over a fixed inclusive `[startTime, endTime]` target window using the exchange page parameter until the window is complete or an explicit page bound is reached. Pagination SHALL NOT advance a millisecond cursor to escape a full page. Response order SHALL be treated as unspecified: rows SHALL be normalized, canonically deduplicated, and sorted after acquisition, while coverage SHALL derive from successfully completed requested pages rather than observed first/last row order.

#### Scenario: More than one page shares a millisecond
- **WHEN** over 1000 relevant income rows have the same event time within the fixed target window
- **THEN** subsequent page numbers retrieve the remaining peers and no row is skipped by adding one millisecond

#### Scenario: Binance returns descending rows
- **WHEN** a page arrives newest-first instead of oldest-first
- **THEN** the same canonical ledger and coverage are produced as for ascending delivery

#### Scenario: Page budget ends mid-window
- **WHEN** the allowed page count is exhausted before a target window is complete
- **THEN** the lane remains partial with its successful coverage and target stated, rather than being marked complete

#### Scenario: Retention cuts the request
- **WHEN** requested history predates Binance's available retention
- **THEN** the retention edge is stated as an external coverage bound and no older completeness is claimed

### Requirement: Settled-income completeness is maintained per income lane
Funding, insurance clear, and each required underivable commission-credit type SHALL have independent cursor, coverage, freshness, completeness, and failure state. An aggregate SHALL be complete only for the lanes it requires and only where all of those lanes cover the interval. A failure or delayed refresh in one lane SHALL not erase confirmed rows from another lane.

#### Scenario: Funding is fresh and rebate is stale
- **WHEN** a funding-only tail succeeds while an underivable rebate lane has not yet been confirmed
- **THEN** funding may be shown as current, but a wallet result requiring the rebate lane remains incomplete

#### Scenario: One lane fails verification
- **WHEN** verification succeeds for five required types and fails for one
- **THEN** the five confirmed lanes retain their coverage, the failed lane is stale/error, and the aggregate is not marked fully complete

#### Scenario: All required lanes complete
- **WHEN** every required lane covers the requested interval successfully
- **THEN** their union is eligible to be reported as a complete settled-income reading
