## ADDED Requirements

### Requirement: Income pagination does not skip timestamp peers
Each income type SHALL be read over a fixed inclusive `[startTime, endTime]` target window using the exchange page parameter until the window is complete or an explicit cumulative per-target page/request bound is reached. Pagination SHALL NOT advance a millisecond cursor to escape a full page. Response order SHALL be treated as unspecified: rows SHALL be normalized, canonically deduplicated, and sorted after acquisition, while coverage SHALL derive from successfully completed requested pages rather than observed first/last row order.

Each lane SHALL also enforce a cumulative canonical-row ceiling across all continuation passes for one frozen target, not only a per-pass page limit. When another page or the retained union would exceed that ceiling, the lane SHALL preserve no more than the bounded real rows already acquired, clear any unproven completeness/coverage claim, expose an explicit resource-limit error, and remove its continuation checkpoint so the same oversized target is not paged indefinitely.

The walker aggregate failure signal SHALL be true whenever any requested lane refuses a page or reaches its row/page resource ceiling. A resource-limited lane SHALL NOT be diagnosed as an ordinary healthy partial continuation merely because its bounded rows remain useful evidence.

Every answered page SHALL be validated as one response to the requested lane and frozen window before it can advance a checkpoint or coverage. Its `rows` SHALL be an array no larger than the exact requested page limit. The HTTP adapter SHALL reject an over-requested array before mapping/normalizing its rows, and the walker SHALL independently enforce the same bound before iteration. A malformed container, over-requested page, row that cannot be canonicalized, missing settlement asset, foreign income type, out-of-window time, or conflict with an already acquired row carrying the same reliable canonical identity SHALL fail that lane transactionally with a sanitized diagnostic; the last confirmed rows and coverage MAY remain visible, but the invalid page SHALL NOT be treated as silence or exact coverage. Byte-equivalent delivery overlap MAY be deduplicated.

A transport or adapter result of `null` or `undefined` SHALL remain a transient `EMPTY_ANSWER`, preserve confirmed lane evidence, and remain eligible for the declared bounded confirmation retry. An answered value whose `rows` is not an array SHALL instead fail as `INVALID_INCOME_PAGE`; these outcomes SHALL NOT be conflated even though neither can advance coverage.

Caller-injected page, per-pass page, cumulative target-page, retained-row, and tail-overlap limits MAY narrow deterministic work but SHALL NOT exceed their declared production ceilings. Each limit SHALL default independently when omitted or malformed, so a partial injected limits object SHALL NOT disable the page loop, erase overlap through non-finite arithmetic, or widen resource/request budgets.

Endpoint normalization SHALL preserve an omitted, `null`, or blank income timestamp as missing evidence. It SHALL NOT coerce such input to epoch, because a manufactured timestamp can enter a broad frozen target as a genuine settlement row.

#### Scenario: More than one page shares a millisecond
- **WHEN** over 1000 relevant income rows have the same event time within the fixed target window
- **THEN** subsequent page numbers retrieve the remaining peers and no row is skipped by adding one millisecond

#### Scenario: Binance returns descending rows
- **WHEN** a page arrives newest-first instead of oldest-first
- **THEN** the same canonical ledger and coverage are produced as for ascending delivery

#### Scenario: Page budget ends mid-window
- **WHEN** the allowed page count is exhausted before a target window is complete
- **THEN** the lane remains partial with its successful coverage and target stated, rather than being marked complete

#### Scenario: Full duplicate pages repeat forever
- **WHEN** the exchange or a malformed adapter keeps returning limit-sized pages for one frozen target without adding canonical identities
- **THEN** the cumulative per-target page ceiling stops further continuation, retains only previously confirmed coverage, and reports an explicit incomplete resource-limit error

#### Scenario: An answered page contains an invalid row
- **WHEN** one row is malformed, has no settlement asset, belongs to another income type, or falls outside the requested inclusive window
- **THEN** that page fails transactionally and the lane cannot advance its checkpoint, coverage, or exact-completeness claim

#### Scenario: An answered page exceeds its request
- **WHEN** the adapter or injected reader returns more rows than the exact page limit requested
- **THEN** the adapter rejects before row normalization and the walker independently fails the lane before iterating or retaining any over-limit row

#### Scenario: An answered page has no row array
- **WHEN** a transport or adapter returns a non-array `rows` value
- **THEN** it is a failed page and cannot be coerced to terminal empty success or replace retained evidence

#### Scenario: A confirmation receives no transport answer
- **WHEN** a bounded confirmation attempt resolves to `null` or `undefined` rather than an answered page object
- **THEN** the lane reports transient `EMPTY_ANSWER`, retains its confirmed rows and debt, and remains eligible only for the existing bounded retry policy

#### Scenario: A caller injects partial or oversized walker limits
- **WHEN** a deterministic caller omits some lane-walker limits or supplies any value above its production ceiling
- **THEN** omitted limits use independent production defaults, supplied limits can only narrow work, and acquisition remains bounded and live

#### Scenario: Income timestamp is omitted or blank
- **WHEN** the income endpoint returns a row whose timestamp is omitted, `null`, or blank
- **THEN** normalization keeps the timestamp missing and page validation rejects the row instead of attributing it to epoch

#### Scenario: One income identity carries conflicting money
- **WHEN** one page or a later page in the same frozen target repeats a reliable canonical identity with different row content
- **THEN** the lane fails transactionally instead of selecting one amount by response order, while byte-equivalent overlap remains deduplicated

#### Scenario: Cumulative lane row ceiling is reached
- **WHEN** full pages across one or more continuation passes fill the declared per-lane row ceiling before a terminal page proves the target complete
- **THEN** acquired rows remain bounded and visible as partial evidence, the lane reports an explicit resource-limit error with `complete=false`, and no continuation is queued

#### Scenario: A retained-row ceiling ends the pass
- **WHEN** any requested lane terminates with `ROW_LIMIT_REACHED`
- **THEN** the aggregate walk reports a failed outcome for diagnostics while preserving the lane's bounded real rows and incomplete state

#### Scenario: Retention cuts the request
- **WHEN** requested history predates Binance's available retention
- **THEN** the retention edge is stated as an external coverage bound and no older completeness is claimed

### Requirement: Settled-income completeness is maintained per income lane
Funding, insurance clear, and each required underivable commission-credit type SHALL have independent cursor, coverage, freshness, completeness, and failure state. An aggregate SHALL be complete only for the lanes it requires and only where all of those lanes cover the interval. A failure or delayed refresh in one lane SHALL not erase confirmed rows from another lane.

Delayed confirmation SHALL be persisted as per-lane debt with an explicit not-before deadline. A lane carrying that debt SHALL remain stale and incomplete across process restart. A successful endpoint pass that starts before the applicable not-before instant SHALL NOT clear the debt; in an uninterrupted process that instant comes from the exact newest-event marker, while after restore it comes from the persisted deadline. Only a successful pass started at or after that applicable instant MAY clear it. Restoring the resource SHALL restore the stale state and re-arm any remaining confirmation delay.

The durable confirmation deadline SHALL derive only from the rounded event witness plus the confirmation delay. Acquisition `targetTo` MAY advance independently during bootstrap, continuation, manual refresh, or a pre-deadline walk, but that advancement SHALL NOT extend the deadline for already-held debt. Reapplying or restoring the same debt SHALL preserve the event-derived deadline unless a genuinely newer event witness moves it later.

The durable target and deadline MAY be rounded upward to a fixed one-second bucket so executions inside one bucket share one persisted invalidation. The rounded deadline SHALL be no earlier than `newestEventAt + confirmationDelay`; the live in-memory marker and timer SHALL still use the exact newest event and SHALL NOT confirm before that exact delay. The first event covered by a bucket SHALL synchronously persist the conservative debt before publication, so a restart after later same-bucket events cannot restore an earlier confirmation deadline. A lane carrying debt SHALL be `stale` even when it has no retained rows or coverage.

An event already covered by the held durable target, deadline, stale status, and incomplete state SHALL be recognized from those scalar fields before canonical lane construction. Such a same-bucket witness SHALL retain the existing lane reference and SHALL NOT clone, canonicalize, sort, hash, or persist its unchanged retained rows; only a real bucket transition may pay that full-ledger cost.

When an endpoint pass completes after one or more newer invalidations arrived in flight, the commit SHALL reconcile its walked evidence with the current global resource and finalize against the current generation/content, not the resource captured at walk start. Generation SHALL remain monotonic, and two different debt digests SHALL NOT be emitted under the same generation.

If the process restarts after a bounded backward wall-clock step, restore MAY retain a debt lane whose target is ahead of the new clock only when the displacement is no greater than that lane's persisted confirmation interval. The persisted digest SHALL be verified before any clock-relative degradation. Future rows, coverage, continuation work, and observation clocks SHALL NOT be accepted as current evidence: they SHALL be removed, clipped, or cleared while the target, deadline, stale state, and incomplete confirmation obligation remain. A future claim without that bounded debt relationship, including a ready lane, SHALL be rejected atomically.

#### Scenario: Funding is fresh and rebate is stale
- **WHEN** a funding-only tail succeeds while an underivable rebate lane has not yet been confirmed
- **THEN** funding may be shown as current, but a wallet result requiring the rebate lane remains incomplete

#### Scenario: One lane fails verification
- **WHEN** verification succeeds for five required types and fails for one
- **THEN** the five confirmed lanes retain their coverage, the failed lane is stale/error, and the aggregate is not marked fully complete

#### Scenario: All required lanes complete
- **WHEN** every required lane covers the requested interval successfully
- **THEN** their union is eligible to be reported as a complete settled-income reading

#### Scenario: One lane enters terminal cooldown
- **WHEN** one filtered rebate lane receives a terminal response while funding and insurance remain due
- **THEN** automatic reads pause only that rebate lane, funding and insurance continue, and manual/full verification may probe recovery deliberately

#### Scenario: Application restarts before delayed confirmation
- **WHEN** an affected lane is persisted with confirmation debt and the process restarts before its not-before deadline
- **THEN** the restored lane remains stale, its remaining confirmation delay is re-armed, and an earlier bootstrap success cannot claim it complete

#### Scenario: One hundred executions span distinct milliseconds in one bucket
- **WHEN** one hundred fill witnesses arrive at distinct millisecond timestamps covered by one or two adjacent durable buckets
- **THEN** the full settled-income ledger is cloned/canonicalized and synchronously persisted only at the bounded bucket transitions, while same-bucket witnesses reuse the held lane and the in-memory confirmation timer is replaced to run no earlier than two minutes after the exact newest witness

#### Scenario: Process exits after a later event in the same bucket
- **WHEN** the first event persisted an upward-rounded target/deadline and a newer same-bucket event arrives before the process exits
- **THEN** restart restores a deadline no earlier than the newer event's required confirmation time without requiring another full-ledger write for that event

#### Scenario: Walk completes after newer debt generations
- **WHEN** a pass that started from generation 7 completes after event invalidations have advanced the current resource through generations 8 and 9
- **THEN** completion commits against generation 9/current content, preserves the newest debt, and cannot publish generation 8 with a digest different from the already-published generation-8 frame

#### Scenario: Empty lane receives confirmation debt
- **WHEN** a settlement witness invalidates a lane with no retained rows, coverage, or successful observation
- **THEN** the lane is stale and incomplete rather than loading or ready, because the known confirmation obligation itself is stale resource truth

#### Scenario: Clock moves backward across persisted invalidation
- **WHEN** a valid debt snapshot is restored under a wall clock slightly earlier than its event target, with the displacement inside the snapshot's own confirmation interval
- **THEN** the digest is checked first, future rows/coverage/checkpoint/observation evidence is degraded rather than trusted, and the stale incomplete debt plus its target and deadline survive for post-deadline confirmation

#### Scenario: Future ready snapshot has no confirmation debt
- **WHEN** a restored ready lane claims future target, coverage, rows, continuation, or observation evidence without bounded confirmation debt
- **THEN** the persisted resource is rejected rather than treating future evidence as exact settled money

#### Scenario: Post-deadline confirmation succeeds
- **WHEN** a confirmation pass starts at or after the applicable live or restored not-before instant and completes the affected lane successfully
- **THEN** both persisted and in-memory confirmation debt are cleared and the lane may become ready from its proven coverage

#### Scenario: Stream invalidation precedes the first cache read
- **WHEN** a private-stream event arrives before the account-scoped settled resource has been restored
- **THEN** the existing resource is restored before invalidation is persisted, so confirmed rows are not replaced by an empty initial snapshot

#### Scenario: Pre-deadline bootstrap advances the acquisition target
- **WHEN** a restart or bootstrap walk advances a debt lane's `targetTo` before its persisted confirmation deadline
- **THEN** completion and another restart preserve the original event-derived deadline and remaining delay instead of starting a fresh confirmation interval from the newer acquisition target
