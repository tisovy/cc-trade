## ADDED Requirements

### Requirement: Settled-income coverage advances only on successful reads
The settled-income resource SHALL distinguish the latest attempt from the last successful reading. Coverage bounds and the last-successful time SHALL advance only for logical pages that completed successfully. A failed initial read SHALL NOT create a ready empty reading; a failed verification SHALL retain the prior rows, bounds, completeness, and successful time unchanged while exposing the new failure.

The resource SHALL carry `coveredFrom`, `coveredTo`, `targetTo`, and completeness for the required income lanes. A consumer SHALL consider an interval covered only when both ends fall within successful contiguous coverage for every component it requires.

#### Scenario: The first page is refused
- **WHEN** Binance refuses or times out before any logical income page succeeds and no cache exists
- **THEN** no ready/complete empty frame is stored or published, and the resource reports a retryable failure

#### Scenario: Verification fails after success
- **WHEN** a verified reading exists and its next verification fails before a page succeeds
- **THEN** the rows, coverage, completeness, and last-successful time remain unchanged while the resource becomes stale with the failure

#### Scenario: Cached coverage is outside retention
- **WHEN** persisted coverage ends before the current retention window begins or has inverted bounds after clamping
- **THEN** the cache is rejected as usable coverage and is not published as current

#### Scenario: Old edge is covered but newest edge is not
- **WHEN** `coveredFrom` precedes a round but `coveredTo` precedes that round's close
- **THEN** the round's income and wallet result remain incomplete

### Requirement: Settled-income publication follows canonical content
Every income entry SHALL preserve exchange identifiers as exact strings at the HTTP boundary and use one canonical identity/normalization rule in storage, reconciliation, IPC, and renderer folds. Resource publication SHALL use a monotonic content generation or digest covering canonical entry identities, signed amounts, assets, times, coverage, and state. A content correction SHALL publish even when row count and bounds are unchanged; an identical frame SHALL not publish again.

#### Scenario: Verification corrects an amount in place
- **WHEN** verification replaces one row's amount while row count and coverage remain unchanged
- **THEN** the resource generation changes and the corrected frame reaches the renderer

#### Scenario: Verification changes one identity in place
- **WHEN** one canonical row is replaced by another while collection size and bounds remain unchanged
- **THEN** the replacement is published and the removed row no longer contributes

#### Scenario: Identical verification repeats
- **WHEN** verification returns byte-equivalent canonical content, coverage, and state
- **THEN** no redundant renderer publication occurs

#### Scenario: A transaction id exceeds safe integer range
- **WHEN** Binance supplies an identifier that cannot be represented exactly as a JavaScript number
- **THEN** its original string identity survives storage, deduplication, and IPC without collision

### Requirement: Manual refresh reports settled-income outcome independently
An operator refresh SHALL make the settled-income refresh outcome observable independently of balances, positions, and orders. It MAY await all resource outcomes or return an accepted compound operation, but it SHALL NOT report settled income as successfully refreshed before that resource succeeds. Background refreshes caused by trading mutations SHALL remain non-blocking to the command that caused them.

#### Scenario: Account succeeds and income fails
- **WHEN** balances/positions refresh successfully but the income read fails
- **THEN** the operator sees account success and settled-income failure as separate outcomes and the old income remains qualified stale

#### Scenario: Income is still pending
- **WHEN** manual refresh has completed other resources while income remains in flight
- **THEN** settled income remains visibly loading rather than appearing refreshed

#### Scenario: A trading mutation schedules income
- **WHEN** an execution schedules a settled-income tail read
- **THEN** the trading command outcome is not delayed, and the independent income resource later reports ready or failed
