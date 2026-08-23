## ADDED Requirements

### Requirement: Settled-income coverage advances only on successful reads
The settled-income resource SHALL distinguish the latest attempt from the last successful reading. Coverage bounds and the last-successful time SHALL advance only for logical pages that completed successfully. A failed initial read SHALL NOT create a ready empty reading; a failed verification SHALL retain the prior rows, bounds, and successful time while exposing the new failure and clearing current completeness.

The resource SHALL carry `coveredFrom`, `coveredTo`, `targetTo`, and completeness for the required income lanes. A consumer SHALL consider an interval covered only when both ends fall within successful contiguous coverage for every component it requires.

A lane whose latest requested enumeration is pending or failed SHALL be incomplete in the published resource even when it retains older successful rows and bounds. Every row time, coverage bound, target, attempt time, and success time SHALL be a non-negative safe integer. Only `ready` status with safe latest-attempt and last-success times and no pending checkpoint MAY be paired with `complete=true`; `idle`, `loading`, `stale`, `error`, or pending state SHALL force current completeness to false. Durable and renderer trust boundaries SHALL reject blank/absent ready timestamps, a latest attempt older than its stated last success, and ready/complete state paired with a pending checkpoint.

#### Scenario: The first page is refused
- **WHEN** Binance refuses or times out before any logical income page succeeds and no cache exists
- **THEN** no ready/complete empty frame is stored or published, and the resource reports a retryable failure

#### Scenario: Verification fails after success
- **WHEN** a verified reading exists and its next verification fails before a page succeeds
- **THEN** the rows, coverage, and last-successful time remain unchanged while the resource becomes stale with the failure and its current completeness becomes false

#### Scenario: A previously complete lane fails
- **WHEN** one lane had complete confirmed coverage and its next requested enumeration fails
- **THEN** its confirmed rows, bounds, and successful time remain available, but its current completeness becomes false and the aggregate cannot claim exact wallet Net

#### Scenario: A previously complete lane starts another read
- **WHEN** one lane retains complete confirmed rows while its next requested enumeration is loading
- **THEN** the retained evidence remains visible, but current completeness is false until the new enumeration succeeds

#### Scenario: Cached coverage is outside retention
- **WHEN** persisted coverage ends before the current retention window begins or has inverted bounds after clamping
- **THEN** the cache is rejected as usable coverage and is not published as current

#### Scenario: Old edge is covered but newest edge is not
- **WHEN** `coveredFrom` precedes a round but `coveredTo` precedes that round's close
- **THEN** the round's income and wallet result remain incomplete

### Requirement: Settled-income publication follows canonical content
Every income entry SHALL preserve exchange identifiers as exact strings at the HTTP boundary, name a non-empty settlement asset, and use one canonical identity/normalization rule in storage, reconciliation, IPC, and renderer folds. Canonicalization SHALL bound identifier, symbol, type, asset, and decimal text before identity construction, exact-number parsing, hashing, persistence, or IPC. Non-empty canonical income types and symbols SHALL already contain only uppercase ASCII letters, digits, and underscores; canonical settlement assets SHALL already contain only uppercase ASCII letters and digits. A malformed, padded, lowercase, or Unicode-case-foldable token SHALL be rejected rather than trimmed or uppercased into a durable identity. A present non-empty optional identifier that is not an exact bounded integer token SHALL reject the row rather than become an absent identifier and fallback identity. Every valid signed amount SHALL be reduced exactly to one plain-decimal representation before content-derived identity and digest construction, including removal of redundant leading/trailing zeroes, an optional plus sign, and negative zero. Resource publication SHALL use a monotonic content generation or digest covering canonical entry identities, signed amounts, assets, times, coverage, and state. A content correction SHALL publish even when row count and bounds are unchanged; an identical frame SHALL not publish again. Durable serialization MAY reuse the authoritative digest already computed for an unchanged canonical resource, but SHALL validate that digest before replacing the stored snapshot.

Persisted or published settled-income failures SHALL expose only a bounded safe machine code and sanitized message. Arbitrary error codes SHALL fall back to `READ_FAILED`; any bounded source message containing an authorization, API-key, signature, secret, or authentication-scheme marker SHALL become a generic credential-redacted diagnostic rather than attempting syntax-specific partial redaction. Main-process logging of the failure SHALL emit only the sanitized machine code.

Content generation and digest SHALL remain unchanged when a successful verification changes only observation timestamps. Publication SHALL nevertheless deliver one frame when a canonical lane's attempt or success time advances. The renderer SHALL accept such a same-generation frame only when its digest agrees with the held frame, all canonical lane content/state is byte-equivalent, and its `readAt` and lane observation times are monotonic; it SHALL reject a same-generation content or digest conflict or a non-newer replay.

Contract-scoped `FUNDING_FEE` and `INSURANCE_CLEAR` entries SHALL name a non-empty canonical symbol. A page containing either type without that contract identity SHALL fail transactionally and SHALL NOT advance lane rows, coverage, successful time, or exact completeness. Account-level commission-credit types MAY omit a symbol and SHALL remain eligible for the account-shared ledger rather than being rejected solely for that omission.

The renderer SHALL admit a v2 resource frame atomically. After canonical case normalization, lane names SHALL be unique and SHALL equal exactly the complete `FUTURES_UNDERIVABLE_INCOME_TYPES` set; an empty, partial, or extra lane set SHALL NOT be authoritative. Every lane row SHALL be individually canonicalizable, belong to that lane, and have an identity not repeated by another row in the same frame. Each lane and any supplied compatibility aggregate list SHALL be bounded by the shared retained-row ceiling before its rows are canonicalized or sorted. Validation SHALL NOT silently drop malformed, duplicate, conflicting, wrong-lane, oversized, omitted-lane, or extra-lane evidence while preserving exact completeness. Accepted aggregate rows, status, coverage, target, attempt/success times, and completeness SHALL be derived from the validated lanes. Main-process publication SHALL carry authoritative rows once under those lanes rather than duplicating the full union at top level, and SHALL reuse its sorted canonical lane-row snapshot when only observation clocks change under the same activation, account fingerprint, generation, and digest. If supplied aggregate rows or metadata disagree with lane authority, the whole candidate frame SHALL be rejected so the prior confirmed renderer state remains authoritative.

#### Scenario: Verification corrects an amount in place
- **WHEN** verification replaces one row's amount while row count and coverage remain unchanged
- **THEN** the resource generation changes and the corrected frame reaches the renderer

#### Scenario: Verification changes one identity in place
- **WHEN** one canonical row is replaced by another while collection size and bounds remain unchanged
- **THEN** the replacement is published and the removed row no longer contributes

#### Scenario: Identical verification repeats
- **WHEN** a frame repeats byte-equivalent canonical content, coverage, state, and observation timestamps
- **THEN** no redundant renderer publication occurs

#### Scenario: Verification confirms unchanged money later
- **WHEN** verification returns byte-equivalent canonical content, coverage, and state after a later successful attempt
- **THEN** content generation and digest stay unchanged, one newer frame updates attempt and success times, and a same-generation digest conflict cannot replace the held resource

#### Scenario: Same-generation frame changes money behind the same digest label
- **WHEN** a candidate claims the held generation and digest but changes any canonical lane row or non-observation state
- **THEN** the renderer rejects it instead of treating the candidate as an observation-only update

#### Scenario: A contradictory resource frame reaches the renderer
- **WHEN** an IPC frame has absent or blank required temporal metadata, or marks a non-ready lane complete
- **THEN** the renderer rejects the invalid time and cannot restore `complete=true` outside the canonical ready state

#### Scenario: Ready lane has no successful observation
- **WHEN** persisted or IPC lane state says `ready` without safe attempt/success times, places the latest attempt before its last success, or carries a pending checkpoint
- **THEN** the whole candidate is rejected and cannot provide complete coverage or exact NET

#### Scenario: A transaction id exceeds safe integer range
- **WHEN** Binance supplies an identifier that cannot be represented exactly as a JavaScript number
- **THEN** its original string identity survives storage, deduplication, and IPC without collision

#### Scenario: One income field exceeds its protocol bound
- **WHEN** an income decimal, identifier, symbol, asset, or type contains an oversized string
- **THEN** canonical validation rejects the row before expanding, hashing, storing, or broadcasting the oversized evidence

#### Scenario: An income token contains non-canonical characters
- **WHEN** an income type, symbol, or settlement asset contains whitespace, punctuation, or another character outside its canonical exchange-token alphabet
- **THEN** canonical validation rejects the row instead of creating a durable identity from the malformed token

#### Scenario: A token can be Unicode-case-folded into ASCII
- **WHEN** a padded, lowercase, long-s, dotless-I, or ligature-bearing token would become apparently canonical after trim or uppercase conversion
- **THEN** adapter, persistence, and renderer boundaries reject its original form and never create money or identity from the converted spelling

#### Scenario: A present optional identifier is malformed
- **WHEN** an income row supplies a non-empty `tranId` or `tradeId` that is not one exact bounded integer token
- **THEN** the adapter preserves that invalidity and the canonical boundary rejects the row instead of treating the identifier as absent

#### Scenario: Equivalent decimal spellings are delivered
- **WHEN** repeated income evidence spells the same exact amount as `.5`, `+0.500`, or `000.50`
- **THEN** every spelling becomes the same canonical amount and content-derived identity and can contribute at most once

#### Scenario: Income money arrives as a JSON number
- **WHEN** the adapter, persisted store, direct constructor, or IPC frame supplies `income` as a JavaScript number rather than the exchange's exact decimal string
- **THEN** the evidence is rejected before identity or digest construction because any already-parsed digits may have been rounded

#### Scenario: One lane advances beyond the other lane targets
- **WHEN** a funding-only refresh advances the funding lane target while confirmed credit and insurance lanes retain their earlier independent targets
- **THEN** each retained lane remains complete through its own target so older covered intervals stay eligible for exact NET, while resource-wide completeness remains false until every required lane covers the aggregate maximum edge

#### Scenario: A read failure embeds credentials in diagnostics
- **WHEN** an HTTP error carries an arbitrary code or an authorization value containing a scheme and secret token
- **THEN** persistence and IPC use `READ_FAILED` for an unsafe code and redact the entire authorization value without retaining the token

#### Scenario: Credentials use a quoted or JSON diagnostic form
- **WHEN** an error message contains quoted `Authorization`, `Proxy-Authorization`, `X-MBX-APIKEY`, signature, secret, Bearer, or Basic credential markers
- **THEN** store, IPC, renderer, and main-process logs retain no part of the credential-bearing source message

#### Scenario: Adapter returns a malformed page container
- **WHEN** a settled-income adapter answer carries a non-array `rows` value
- **THEN** the lane fails transactionally and retained evidence cannot be replaced by a successful empty-complete reading

#### Scenario: An income row omits its settlement asset
- **WHEN** an HTTP or persisted income row has a blank or absent asset
- **THEN** canonical validation rejects it and no wallet layer may default that row to USDT or count it toward exact Net

#### Scenario: Contract-scoped income omits its contract
- **WHEN** a funding-fee or insurance-clear row has a blank or absent symbol
- **THEN** canonical validation rejects the row, its lane remains incomplete without advancing confirmed coverage, and no unrelated round can claim its amount by timestamp

#### Scenario: An account-level credit omits a contract
- **WHEN** an allowed commission-credit row has complete canonical identity, amount, asset, and time evidence but no symbol
- **THEN** canonical validation retains it as account-level evidence and does not invent a contract owner

#### Scenario: A persisted lane contains rejected evidence
- **WHEN** a persisted v2 lane or its pending checkpoint contains a malformed row, a row for another lane, or a duplicate canonical identity
- **THEN** restoration rejects the whole stored snapshot rather than silently shortening the row set while retaining ready or complete state

#### Scenario: A complete lane contains rejected row evidence
- **WHEN** a v2 frame marks a lane complete but that lane contains a malformed row, a duplicate identity, conflicting values for one identity, or a row naming another income type
- **THEN** the renderer rejects the candidate atomically and cannot publish an exact NET from the shortened canonical row list

#### Scenario: Aggregate rows contradict their lanes
- **WHEN** a v2 frame's aggregate rows add, omit, duplicate, or conflict with any row in the validated lane union
- **THEN** the candidate frame is rejected and no aggregate-only money can enter wallet reconciliation

#### Scenario: Aggregate resource state contradicts its lanes
- **WHEN** supplied aggregate status, coverage, target, attempt/success times, or completeness disagrees with the state derived from validated lanes
- **THEN** the candidate frame is rejected and the prior renderer resource remains authoritative

#### Scenario: Canonical lane and aggregate evidence agree
- **WHEN** every lane is unique and valid and the supplied aggregate rows equal the canonical lane union
- **THEN** the renderer admits the frame with its fingerprint and generation unchanged and derives its accepted aggregate rows from the lanes

#### Scenario: A newer frame omits or invents a lane
- **WHEN** a newer v2 frame carries an empty, partial, or extra lane set instead of exactly every canonical settled-income lane
- **THEN** the renderer rejects the whole candidate and retains the previously held authoritative snapshot

#### Scenario: Observation frame carries a bounded single copy of evidence
- **WHEN** main publishes unchanged money with newer observation times
- **THEN** each canonical row appears only in its authoritative lane, the renderer derives the union, and an over-ceiling lane or compatibility aggregate list is rejected before canonicalization

#### Scenario: Observation-only publication reuses canonical lane rows
- **WHEN** main publishes newer observation clocks with the same activation, account fingerprint, content generation, and digest
- **THEN** it reuses the previously sorted canonical row arrays and does not normalize, clone, or sort the unchanged retained ledger again

### Requirement: Manual refresh reports settled-income outcome independently
An operator refresh SHALL make the settled-income refresh outcome observable independently of balances, positions, and orders. It MAY await all resource outcomes or return an accepted compound operation, but it SHALL NOT report settled income as successfully refreshed before that resource succeeds. The renderer SHALL mark only an operator-originated refresh with explicit validated manual intent. An accepted compound receipt SHALL identify that manual refresh request and server-side request time, SHALL let account resources reach their own terminal outcome, and SHALL refer consumers to the authoritative settled-income resource rather than copying a provisional income result. Startup, periodic, and trading-mutation refreshes SHALL NOT emit a manual receipt and SHALL remain non-blocking.

Manual lane loading SHALL remain process-local coordination state and SHALL NOT become durable exchange evidence. If a funding, fill, or insurance witness must persist confirmation debt while manual loading is active, the durable snapshot SHALL apply that debt to the last exchange-backed lane state and SHALL NOT serialize unrelated provisional loading status, provisional targets, or cleared transient errors. A restart SHALL therefore recover the event debt without restoring an interrupted UI loading intent as canonical account history.

#### Scenario: Account succeeds and income fails
- **WHEN** balances/positions refresh successfully but the income read fails
- **THEN** the operator sees account success and settled-income failure as separate outcomes and the old income remains qualified stale

#### Scenario: Income is still pending
- **WHEN** manual refresh has completed other resources while income remains in flight
- **THEN** settled income remains visibly loading rather than appearing refreshed

#### Scenario: A compound refresh is accepted
- **WHEN** the backend admits a Futures account refresh carrying validated explicit manual intent
- **THEN** the renderer receives a request-correlated accepted receipt, derives account completion only from account-resource attempts at or after that request, and reads income status only from the independent settled-income resource

#### Scenario: Background account work is not a manual refresh
- **WHEN** startup, periodic reconciliation, or a trading mutation asks for a Futures account refresh without explicit manual intent
- **THEN** no manual compound receipt is emitted and each affected resource continues to report through its own authoritative state

#### Scenario: A queued account refresh has not attempted its pass
- **WHEN** a second manual refresh is accepted while an earlier account pass is still running
- **THEN** the second receipt remains account-loading until account resources expose an attempt at or after that receipt's server request time

#### Scenario: Older income walk finishes after manual loading begins
- **WHEN** a background settled-income walk is in flight and the operator's newer Refresh marks one or more lanes loading before that older walk completes
- **THEN** the older completion cannot replace those lanes with ready, stale, or error; retained evidence stays visibly loading until the pass authorized for the newest manual intent reaches its own terminal outcome

#### Scenario: Settlement arrives while manual loading is active
- **WHEN** one or more lanes are visibly loading for a manual refresh and a funding, fill, or insurance witness requires durable confirmation debt
- **THEN** the live resource keeps current loading/debt authority, while persistence writes the new debt over last exchange-backed lanes and stores no unrelated manual-loading state

#### Scenario: A trading mutation schedules income
- **WHEN** an execution schedules a settled-income tail read
- **THEN** the trading command outcome is not delayed, and the independent income resource later reports ready or failed

### Requirement: A joining renderer receives account authority before settled income
The system SHALL preserve strict account-fingerprint isolation for settled income. After a renderer activates Futures, the main process SHALL acknowledge that activation, send that renderer an account-state frame naming the active credential fingerprint, and only then send its current settled-income snapshot with the same fingerprint. A current shared snapshot SHALL remain usable even when its scheduled bootstrap REST read is not yet due, and joining one renderer SHALL NOT rebroadcast an account snapshot to existing renderers.

#### Scenario: A later renderer joins a current shared resource
- **WHEN** one renderer has already made settled income current and another renderer activates Futures for the same credential fingerprint
- **THEN** the later renderer receives activation acknowledgement, matching account authority, and the current settled snapshot in that order without requiring another income REST read

#### Scenario: Settled income belongs to another fingerprint
- **WHEN** a settled-income frame does not exactly match the fingerprint established by the renderer's latest account-state frame
- **THEN** the renderer rejects that frame and does not weaken admission for startup convenience

### Requirement: Trade-history activity requires fill evidence
The system SHALL mark a symbol's trade history dirty and schedule its bounded repair read only when an execution report contains actual fill evidence. A zero-fill order lifecycle report SHALL remain an order-state event and SHALL NOT invalidate confirmed history coverage.

#### Scenario: An order changes lifecycle without a fill
- **WHEN** the user-data stream reports `NEW`, `CANCELED`, or `EXPIRED` with zero last-filled and cumulative-filled quantities
- **THEN** confirmed trade-history coverage remains valid and no trade-history repair read is scheduled

#### Scenario: An execution contains a fill
- **WHEN** the user-data stream reports a `TRADE` execution or positive fill evidence
- **THEN** that symbol's fill-history activity advances, its prior frozen proof no longer suppresses reconciliation, and one bounded trade repair is scheduled for the fill burst
