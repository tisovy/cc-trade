## Why

The shared Binance `RateLimiter.execute` reserves request weight once and may then call the request function up to three times. After a timeout or reset the exchange may have processed every attempt, so the local budget can undercount usage by 3× and admit unrelated trading/account calls on a false premise.

## What Changes

- Reserve the declared request weight before every physical retry attempt, not once per logical operation.
- Keep retries independently abortable and preserve existing retry eligibility and bounded backoff semantics.
- Reconcile local accounting with Binance response-weight headers and rate-limit responses when those observations are available.
- Record attempt count and charged weight without exposing signed requests or credentials.
- Add deterministic tests proving that three weight-30 attempts charge 90 and obey the same spacing/cap as three independent requests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-live-readiness`: make request admission account for every physical Binance attempt.

## Impact

Affected code is the shared main-process rate limiter and all Binance callers that use it. GitNexus rates `RateLimiter.execute` CRITICAL: 17 direct and 49 total dependants across 17 execution flows. This must land separately from income-specific scheduling so any latency/regression can be isolated.
