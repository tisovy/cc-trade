## Why

The shared Binance `RateLimiter.execute` reserves request weight once and may then call the request function up to three times. After a timeout or reset the exchange may have processed every attempt, so the local budget can undercount usage by 3× and admit unrelated trading/account calls on a false premise.

## What Changes

- Reserve the declared request weight before every physical retry attempt, not once per logical operation.
- Put the accounting boundary at the low-level Futures HTTP send so replay-safe pooled-socket fallback, clock synchronization, the signed request, and `-1021` resynchronization/retry are each admitted exactly once. Keep the legacy Spot limiter on its existing logical-operation boundary.
- Materialize every signed Futures timestamp, query/body, and signature only after that physical admission and immediately before `https.request`, so admission waits cannot consume `recvWindow`; a replay-safe GET fallback receives a freshly materialized signing envelope after its own admission.
- Keep retries independently abortable and preserve bounded backoff semantics, while refusing to replay a mutating request merely because its reused socket reset before a response.
- Reconcile local accounting with Binance response-weight headers and rate-limit responses when those observations are available.
- Tie each response observation to its physical-admission token and preserve every other still-unanswered local reservation, regardless of admission order, so neither a slow older response nor a faster newer response can erase concurrent weight that its exchange header may not yet include.
- Carry one cancellation signal through admission and the in-flight Futures request.
- Recheck lifecycle ownership before entering physical admission and again inside the admission slot before booking weight, so work already retired or retired while waiting creates neither a reservation nor a transport; retain the post-booking guard for the final narrow race.
- Record bounded attempt/retry counts, charged weight, observed weight, backpressure, and outcome without exposing endpoint URLs, query/body data, signed requests, credentials, or monetary values.
- Bound every Futures REST response body before concatenation or JSON parsing; an oversized mutation response remains indeterminate and is never replayed automatically.
- Add deterministic tests proving that three weight-30 attempts charge 90 and obey the same spacing/cap as three independent requests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-live-readiness`: make request admission account for every physical Binance attempt.

## Impact

Affected code is the shared main-process rate limiter and the Futures HTTP adapter. GitNexus rates `RateLimiter.execute` CRITICAL: the current index reports 12 direct and 42 total dependants across 19 execution flows; `RateLimiter.reserve` is also CRITICAL across 11 process families. The current indexed `httpsJsonRequest` helper has one direct caller and 14 total upstream dependants at LOW graph risk, but replaying a position-margin POST has CRITICAL monetary semantics because the endpoint has no idempotency key. The physical-attempt mode is enabled only for the Futures limiter, so Spot keeps its established admission semantics. This must land separately from income-specific scheduling so any latency/regression can be isolated.
