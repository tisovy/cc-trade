## Context

See `proposal.md` for motivation. The shared limiter originally reserved before entering retry logic, and the first implementation moved that reservation into the limiter's outer retry loop. That still leaves physical retries hidden inside the Futures adapter: pooled-connection fallback, initial clock synchronization, the signed send, and `-1021` resynchronization/retry. The limiter serves many account, history, stream, and command flows; GitNexus reports a CRITICAL blast radius of 42 total dependants across 19 execution flows for `execute`, plus 11 process families through `reserve`.

## Goals / Non-Goals

**Goals:**

- Make admission and accounting correspond one-to-one with physical Binance attempts.
- Preserve cancellation, replay-safe read retry eligibility, and command priority.
- Use observed Binance weight/backpressure conservatively when available.
- Preserve payload/error shapes and the legacy Spot limiter's admission behavior.

**Non-Goals:**

- Changing retry eligibility beyond refusing transport replay for non-idempotent mutations.
- Increasing retry counts.
- Replacing the shared scheduler or changing endpoint-declared weights.

## Decisions

### 1. Put Futures reservation at the physical HTTP boundary

Represent a logical Futures operation as an async-local context containing its default declared weight, urgency, AbortSignal, reservation callback, response-observation callback, and bounded accounting counters. `RateLimiter.execute` installs that context only when the limiter is constructed in Futures physical-attempt mode. Immediately before each low-level `https.request`, the adapter awaits the context's reservation callback. Pooled and fresh sends therefore cannot share a reservation, while one physical send cannot be charged twice.

The adapter may override the logical default only for a helper endpoint it invokes internally. `/fapi/v1/time` uses its documented IP weight 1 and uncached `/fapi/v1/positionSide/dual` uses its documented IP weight 30. The surrounding endpoint continues to use the declared weight supplied by its existing caller. This is preferred to multiplying the initial reservation by maximum attempts because unused retries would unnecessarily block work and a compound signed operation can contain endpoints with different weights.

Admission now precedes signed request materialization as well as transport creation. The adapter captures the semantic endpoint parameters when the logical call is made, but defers the timestamp, query/body encoding, and HMAC until the physical reservation has completed; it then creates `https.request` synchronously from that material. This keeps a capacity or Retry-After wait from spending the signed request's `recvWindow`. The same materializer runs again only for an independently admitted replay-safe GET fallback or eligible retry, giving that send a current timestamp and signature without changing its semantic parameters. Signing material remains private to the adapter and is never placed in async-local accounting or diagnostics.

The legacy Spot limiter does not install this context and keeps its existing pre-function reservation and retry behavior. Futures code executed outside a limiter context, principally isolated adapter tests, retains direct transport behavior rather than acquiring a hidden global limiter.

Every production adapter send therefore enters the limiter explicitly. Account,
history, income, configuration, and listen-key reads already do so. The direct
placement/amend/cancel/cancel-all/position-margin handlers are wrapped as urgent
physical-mode operations with `maxRetries=0`. Pooled-socket fallback is limited
to replay-safe GET requests: `ECONNRESET` or `EPIPE` before a response does not
prove that a POST/PUT/DELETE was not applied, and position-margin transfer has no
idempotency key at all. Such a mutation remains one charged indeterminate attempt
and enters the existing reconciliation/account-refresh path rather than being
sent twice. Adapter-internal `-1021` recovery remains independently admitted
because Binance rejected that signed request before matching. The safe identity
lookup used to reconcile an ambiguous order remains a separately admitted
bounded GET.

### 2. Carry one AbortSignal through the entire Futures operation

The async-local context exposes the operation's signal to the adapter. The same signal guards queued admission, limiter backoff, pooled/fresh fallback admission, clock synchronization, signed sends, outer retries, and Node's in-flight `https.request`. A signal cancelled before a physical reservation sends nothing and charges nothing for that attempt. Once reservation succeeds, cancellation aborts the request but does not refund the weight because delivery to Binance is unknowable.

Lifecycle ownership that is already expressed as a generation predicate (listen-key creation/renewal and settled-income activation) is checked before entering reservation and again while holding the admission slot immediately before booking weight. Work already retired, or retired while waiting for spacing/capacity, therefore creates neither a reservation nor transport. The predicate is rechecked once more immediately after physical admission and before transport creation for the narrow post-booking race; losing ownership only after that atomic booking prevents the stale send but does not refund a completed reservation. Account snapshot reconciliation also takes its `issuedAt` from a bounded `onAttemptAdmitted` hook, updated at every physical admission; after time synchronization or `-1021` recovery, the final signed attempt is therefore the authority, not the earlier logical callback start.

### 3. Return structured attempt accounting

The logical operation maintains attempt count, declared weight charged, maximum recognized observed used weight, bounded Retry-After, retry-category counters (`network`, `timestamp`, `connection-fallback`, `rate-limit`), and final outcome. A constructor callback and an optional per-call callback receive a frozen bounded summary; callbacks are observational and cannot change request success. Ordinary callers still receive exactly the adapter payload or final error they received before.

The persistent record projects only integer counts, a small status, and closed category/outcome values. It never accepts an endpoint path, URL, query, body, headers, exchange message, credential, signature, or monetary value.

### 4. Reconcile observed exchange usage conservatively

The adapter recognizes only the minute used-weight headers and numeric/HTTP-date Retry-After data needed for admission. Every physical reservation receives a monotonic token which its eventual response observation carries back to the limiter. The limiter retains a bounded ledger of raw reservations that have not yet produced a response observation. A header replaces its own reservation with a conservative baseline stamped at observation time, but every other still-windowed unresolved reservation remains additive regardless of whether its token was admitted before or after the responding attempt. Admission order is not exchange processing order: pooled sockets and transport delay can let a newer local attempt answer before an older send is counted. Once a token is observed it leaves the unresolved ledger, while lower, malformed, missing, stale, or repeated observations never reduce the current floor. This prevents either response ordering from refunding concurrent work without repeatedly adding already-observed reservations to later baselines.

HTTP `429` and `418` Retry-After postpones later admission until the observed deadline. The wait is abortable and capped at three days, matching the documented maximum automatic IP-ban horizon while preventing an unbounded/malformed header from parking the process forever. A rate-limit response without usable guidance remains a charged refusal and does not invent a delay.

Every physical response is also bounded before the adapter retains chunks, concatenates a buffer, preserves identifier tokens, or parses JSON. The global ceiling is deliberately above every documented bounded endpoint page and the complete exchange-info response, but finite so a malformed/upstream response cannot grow Electron main-process memory without limit. A `Content-Length` above the ceiling is refused immediately; chunked responses are counted as they arrive and destroyed on the first excess byte. The attempt remains charged. Because a non-GET may already have been applied when its oversized response arrives, that refusal is indeterminate and follows reconciliation rather than transport replay.

### 5. Cover global call classes before rollout

Build seam fixtures for: first-try success, timeout then success, three failures, replay-safe GET pooled fallback, non-replayed position-margin mutation after pooled reset/write failure, initial time sync, `-1021` resync/retry, cancellation during admission/backoff/in-flight transport, lifecycle invalidation after admission, latest-attempt account snapshot issuance, 429/418, high/lower/missing observed weight, stream listen-key priority, direct mutating command admission without logical replay, ambiguity reconciliation, and long history/income fan-outs. No income-specific scheduling policy changes land in this change.

### 6. Treat admission fairness and reconciliation completion as drain-wide facts

Capacity waits may remove an ordinary admission and append it again with its accumulated pass count. Urgent selection therefore inspects every ordinary entry before the urgent candidate; any entry already at the ceiling forces ordinary admission first. Ambiguity reconciliation similarly belongs to the whole single-flight drain: a caller that requires terminal proof awaits the shared completion promise, each pass returns per-resource `ready`/`failed`/`superseded` outcomes, and later passes replace earlier outcomes for the same resource. Ordinary accepted refresh/background callers retain their non-blocking queued semantics. Cancel-all requires both order books; position-margin requires positions and balances. Failure leaves the already-emitted unknown outcome unresolved rather than manufacturing exchange truth.

## Risks / Trade-offs

- **[Retries take longer under honest admission]** → This is required to avoid bans; keep priority/fairness and surface queued state.
- **[A timeout that never reached Binance is still charged]** → Conservative charging is safer because delivery is unknowable; later headers may only raise, not lower, the window.
- **[A reused socket resets before a mutation answers]** → Treat it as indeterminate and reconcile; never infer from the local socket failure that Binance did not apply a margin transfer or order mutation.
- **[Admission can outlive a signed request's recvWindow]** → Capture semantic parameters early but materialize timestamp/query/body/signature only after each physical admission, immediately before transport creation.
- **[Adapters do not expose headers consistently]** → Declared per-attempt charging is sufficient; header reconciliation is additive.
- **[Responses arrive out of physical-admission order]** → Reconcile each header against its admission token and add every other unresolved reservation on either side of it; take only a higher conservative floor, independent of response order.
- **[Global regression]** → Land separately, run all account/command/history suites, and compare diagnostics before enabling income budget assumptions.
- **[Malformed response grows without bound]** → Enforce one global byte ceiling before buffer concatenation/JSON parsing and retain mutation indeterminacy on refusal.

## Migration Plan

1. Add structured attempt metadata without changing reservation placement.
2. Enable Futures-only physical-attempt context and move production reservation to the low-level HTTP-send boundary.
3. Update diagnostics/metrics consumers.
4. Only after production code lands, add deterministic limiter tests and rerun every GitNexus-identified flow suite.
5. Observe request latency, charged weight, 429s, and command priority in live operation before archive. Rollback restores one logical reservation; no persisted data migration is involved.
