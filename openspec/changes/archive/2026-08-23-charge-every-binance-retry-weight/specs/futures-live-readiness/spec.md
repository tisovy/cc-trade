## ADDED Requirements

### Requirement: Every physical Binance attempt is admitted and charged
Before each physical Binance Futures REST attempt, including a replay-safe fresh-connection fallback after pooled `ECONNRESET`/`EPIPE`, clock synchronization, a signed request, resynchronization after `-1021`, and every eligible outer retry after a timeout, reset, or retryable exchange response, the system SHALL reserve that physical endpoint's declared request weight through the shared admission policy exactly once. Internal helper endpoints SHALL use their own declared weight rather than inheriting the surrounding logical operation's weight. A non-GET mutation SHALL NOT be replayed solely because a reused socket reset or broke under its write before a response; that outcome SHALL remain indeterminate because local transport state cannot prove the exchange did not apply it. The legacy Spot limiter SHALL retain its existing logical-operation admission semantics.

For a signed Futures attempt, the system SHALL materialize its timestamp, query or body, and signature only after that attempt's admission and immediately before creating the underlying HTTP request. Time spent waiting for admission SHALL NOT age a signed payload against `recvWindow`; each independently admitted replay-safe GET fallback or eligible retry SHALL materialize a fresh signing envelope from the same semantic request parameters.

A logical Futures operation SHALL expose bounded attempt count, total charged weight, recognized observed used weight, bounded rate-limit backpressure, retry-category counts, and final outcome to diagnostics without exposing endpoint URLs, query strings, request bodies, credentials, signatures, signed parameters, exchange messages, or monetary values. One AbortSignal SHALL govern admission, backoff, and every in-flight physical request belonging to that logical operation. Cancellation before a retry SHALL prevent both the reservation and the physical request for that retry; cancellation after admission SHALL abort the in-flight request without refunding weight that may already have reached Binance.

When Binance response-weight headers are available, the limiter SHALL reconcile conservative local accounting with those observations and SHALL treat `429`/ban guidance as authoritative backpressure. Each observation SHALL remain associated with the physical reservation that produced it. Replacing one local charge with an observed baseline SHALL preserve and add every other still-windowed reservation that has not produced its own response observation, whether it was admitted before or after the responding attempt. Missing, lower, repeated, or stale headers SHALL NOT reduce the locally charged declared weight or erase concurrent unresolved reservations.

Every Futures REST response body SHALL be bounded by one declared global byte ceiling before chunk retention, buffer concatenation, identifier-token preservation, or JSON parsing. An oversized declared `Content-Length` SHALL be refused immediately, and a chunked body SHALL be stopped at the first excess byte. The physical attempt SHALL remain charged. An oversized non-GET response SHALL be classified indeterminate and SHALL NOT make that mutation eligible for automatic transport replay.

Urgent admission MAY pass ordinary work, but every ordinary entry it would pass SHALL enforce the same bounded overtake ceiling even after capacity backpressure removes and requeues that entry behind newer work. A carried pass count SHALL NOT be ignored merely because the affected entry is no longer at the queue head.

An account read used to settle an ambiguous non-idempotent mutation SHALL return the terminal outcome of the complete refresh drain, including any follow-up pass queued behind an in-flight read. The system SHALL emit a reconciled/resynced outcome only after every resource required to answer that mutation reaches `ready` in that drain. A failed, retired, missing, or merely queued read SHALL leave the original unresolved outcome in force and SHALL NOT claim Binance authority.

#### Scenario: A request succeeds first try
- **WHEN** a weight-30 operation succeeds on its first physical attempt
- **THEN** the limiter charges 30 and records one attempt

#### Scenario: Two retries follow transient failures
- **WHEN** a weight-30 operation performs three physical attempts before succeeding or failing
- **THEN** the limiter charges 90 and each attempt waits for admission as if it were an independent request

#### Scenario: A pooled connection is replaced
- **WHEN** a replay-safe weight-5 Futures GET loses a reused socket before an answer and is sent again on a fresh connection
- **THEN** both physical sends are independently admitted and the logical operation reports two attempts and 10 charged weight

#### Scenario: A position-margin mutation loses its reused socket
- **WHEN** a position-margin POST receives `ECONNRESET` or `EPIPE` before any response begins on a reused socket
- **THEN** the one admitted attempt is reported as indeterminate, no fresh-connection replay is sent, and account reconciliation determines the resulting margin

#### Scenario: A signed request synchronizes and retries its timestamp
- **WHEN** a signed weight-30 request first synchronizes time, receives `-1021`, synchronizes again, and retries successfully
- **THEN** the two `/time` sends are charged at weight 1, the two signed sends are charged at weight 30, and the logical total is 62 without any double charge

#### Scenario: A signed request waits longer than recvWindow
- **WHEN** a signed Futures request or its replay-safe GET fallback waits in physical admission longer than the configured `recvWindow`
- **THEN** its timestamp and signature are materialized after that admission, the queued duration does not make the payload stale, and each physical send is charged exactly once

#### Scenario: Position mode is fetched inside a command
- **WHEN** a command needs the uncached `/fapi/v1/positionSide/dual` reading before sending its own request
- **THEN** that internal physical request is charged at its declared weight 30 independently of the command request

#### Scenario: A mutating Futures command sends directly through the adapter
- **WHEN** placement, amendment, cancellation, cancel-all, or position-margin handling sends a Futures request
- **THEN** the command enters urgent Futures physical-attempt admission before any HTTP send, while neither the logical limiter nor pooled-connection fallback replays an ambiguous mutation and existing reconciliation semantics remain unchanged

#### Scenario: An ambiguous command is reconciled by a read
- **WHEN** a mutating command has an indeterminate outcome and the desk queries its exchange identity
- **THEN** the reconciliation read enters Futures physical-attempt admission independently and may use the existing bounded safe-read retry policy without resending the mutation

#### Scenario: Ambiguous account reconciliation is queued or fails
- **WHEN** cancel-all or position-margin reconciliation queues behind another account pass, or one of its required resource reads fails
- **THEN** the command remains unresolved until the queued drain actually makes all required resources ready, and no false `FUTURES_OUTCOME_RESYNCED` event is emitted

#### Scenario: A requeued request already reached its pass ceiling
- **WHEN** capacity backpressure requeues an ordinary request behind newer work after it has already been overtaken the maximum number of times
- **THEN** a later urgent entry cannot pass that request again even though another ordinary request is now at the head

#### Scenario: Retry is aborted before admission
- **WHEN** cancellation occurs after one failed attempt and before its retry is admitted
- **THEN** only the first attempt is charged and no retry request is sent

#### Scenario: Lifecycle ownership changes while admission is queued
- **WHEN** a listen-key create or renewal loses its generation/renderer ownership while its physical admission is queued
- **THEN** ownership is rejected before booking weight, so the stale operation creates neither reservation nor HTTP send; a change that occurs only after atomic booking is still stopped by the post-admission guard while that completed reservation remains conservatively charged

#### Scenario: Account snapshot issuance follows physical admission
- **WHEN** an account read waits for admission or resynchronizes before its final signed send while newer stream state arrives
- **THEN** reconciliation uses the latest physical-attempt admission time as snapshot issuance authority and cannot let the older snapshot overwrite that stream state

#### Scenario: An admitted request is aborted in flight
- **WHEN** the logical operation's signal is cancelled after a physical Futures request is admitted
- **THEN** the same signal aborts the underlying HTTP request, the attempt remains charged, and no nested or outer retry is sent

#### Scenario: Exchange reports a higher used weight
- **WHEN** a response header shows the exchange has counted more weight than the local window expected
- **THEN** subsequent admission honors at least the observed higher usage for a conservative local window and does not continue from the lower estimate

#### Scenario: Exchange reports lower used weight
- **WHEN** a recognized response header reports usage below the limiter's current conservative accounting
- **THEN** the local accounting is not reduced or refunded

#### Scenario: Older response reports weight after a newer admission
- **WHEN** physical attempt A is admitted, attempt B is admitted later, and A's response then reports a higher exchange-used-weight baseline
- **THEN** reconciliation applies that baseline only through A, adds B's reservation on top, and any out-of-order B or repeated A response can only retain or raise the resulting conservative floor

#### Scenario: Newer response arrives before an older unresolved attempt
- **WHEN** attempt A is admitted, attempt B is admitted later, and B's response arrives before A has produced any response observation
- **THEN** B's observed baseline replaces only B's raw reservation, A remains additively charged until its own observation or window expiry, and another attempt cannot enter capacity that only exists by assuming Binance already counted A

#### Scenario: Response headers are absent
- **WHEN** a physical attempt returns without usable weight headers
- **THEN** its declared local weight remains charged

#### Scenario: Binance rate-limits an attempt
- **WHEN** Binance returns `429` with retry guidance
- **THEN** the limiter applies the recognized guidance, capped by the declared safety bound, before admitting another physical attempt

#### Scenario: Attempt diagnostics receive hostile request material
- **WHEN** a signed request fails after its URL, query, body, signature, exchange message, or credential-bearing headers existed in the transport layer
- **THEN** the structured diagnostic contains only bounded counts, closed retry/outcome categories, recognized status/weight/backpressure observations, and no request material

#### Scenario: Futures REST response exceeds its byte budget
- **WHEN** response headers or accumulated chunks exceed the declared body ceiling
- **THEN** the adapter stops retaining the body before JSON parsing, returns a bounded `RESPONSE_TOO_LARGE` refusal, keeps the attempt charged, and treats a mutation outcome as indeterminate without replay
