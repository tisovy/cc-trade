## Why

The income walker assumes timestamp ordering that Binance does not guarantee, always requests page 1, and can skip rows when more than one page shares a millisecond. It also re-reads all six income types for narrow funding or rebate triggers, consuming up to 180 request weight per logical page while still allowing some late credits to remain stale.

## What Changes

- Page fixed inclusive time windows with an explicit page counter per income type; never advance a millisecond cursor merely to paginate rows sharing a timestamp.
- Maintain independent coverage, cursor, freshness, and completeness for each required income lane.
- Invalidate only relevant lanes: funding events refresh funding, fills refresh underivable rebate lanes with a coalesced confirmation, and full verification reconciles all lanes.
- Treat response ordering as untrusted; normalize, sort, deduplicate, and prove coverage from request/page completion rather than observed row order.
- Preserve the official three-month retention and 1000-row/page limits as explicit coverage bounds.
- Enforce a cumulative retained-row ceiling per income lane across continuation passes; preserve bounded evidence but terminate the continuation as explicitly incomplete when the ceiling is reached.
- Enforce a cumulative page/request ceiling per frozen lane target so a malformed endpoint that repeats full duplicate pages cannot continue forever across admission passes.
- Reject malformed, cross-lane, out-of-window, or assetless income rows transactionally instead of dropping them and claiming an exact but short lane.
- Reject a non-array page container or any page larger than the requested limit before row normalization, both at the HTTP adapter and walker defense boundary.
- Add measurable request-weight budgets for cold start, event refresh, confirmation, and verification.
- Apply terminal automatic retry cooldown per income lane so one refused rebate type cannot freeze funding or insurance; retain an account-wide stop only for an explicitly account/IP-wide refusal.
- Let activation bootstrap own the all-lane cold-start income read so a later private-stream handshake cannot enqueue the same 180-weight pass again.
- Persist each lane's delayed-confirmation debt and not-before deadline so a process restart cannot make pre-confirmation income look exact or silently cancel the required post-deadline read.
- Record that confirmation debt before cooldown, backoff, or ordinary due checks can decline the immediate REST read, and re-arm the confirmation when admission is deferred.
- Keep ordinary account ticks away from lanes whose only incompleteness is an unexpired confirmation debt; ticks may extend only genuinely incomplete, non-loading lanes while the dedicated confirmation timer owns debt lanes.
- Anchor each durable confirmation deadline to its rounded event witness rather than to an acquisition target, so bootstrap or restart cannot postpone the same debt indefinitely.
- Re-evaluate current per-lane debt when a confirmation timer fires or leaves the single-flight queue; drop already-repaid lanes before REST admission so an obsolete confirmation cannot spend weight or degrade newly exact evidence.
- Repeat that debt check when the scheduling debounce actually fires, preserving confirmation-only versus new-event lane provenance through debounce and single-flight follow-up queues so a reason upgrade cannot revive repaid debt.
- Make same-bucket event invalidation a scalar no-op before canonical lane construction, so a fill burst does not clone the retained credit ledgers merely to discover that no durable bucket moved.
- Retain an account-wide HTTP 418 automatic floor until a deliberate full pass proves recovery with successful lane answers; a timeout or unrelated refusal is not evidence that the ban ended.
- Bind every queued settled-income page admission to the Futures activation that scheduled it, so deactivation or an account switch retires the old page before transport creation.
- Make the maintained live probe acquire income through the same fixed-window per-lane walker as production, so the comparison tool cannot reintroduce timestamp-cursor loss that the runtime removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: make income pagination and per-type completeness lossless.
- `futures-live-readiness`: bound and expose the request cost of settled-income acquisition.

## Impact

Affected areas include `futures-settled-income-walk`, store format, Binance adapter calls, scheduling/invalidation, diagnostics, probes, and tests. The official Income History endpoint has IP weight 30, inclusive bounds, page/limit controls, and no documented ordering guarantee; the design must not depend on implicit ordering.
