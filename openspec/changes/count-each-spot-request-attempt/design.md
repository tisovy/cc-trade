## Decisions

1. Keep all-symbol open orders: changing it to a cheap single-symbol request would silently change the account snapshot. Charge its actual cost 80. Account/trades cost 20 each, so a symbol refresh costs 120; a symbol-less catch-up costs 100.
2. Move legacy reserve into the attempt loop immediately before fn. Failed attempts retain their charges. A retry must wait for its own capacity/spacing and is cancellable; no new retry reason/count is introduced. The installed SDK's zero-retry facade remains in force.
3. Leave Futures physical context unchanged: each real send already reserves at its transport boundary, so it must not receive an extra legacy charge.
4. Correct the two public bootstrap weights discovered while inspecting the same admission path. Do not alter payloads, change account scope, raise the 800-weight budget, remove spacing or weaken tests to hide the higher cost.

## Impact

GitNexus 1.5.3 name resolution selects a test RateLimiter/execute instead of production. That zero is unresolved. File impact on binance-connection points to main (1.0). Exact-path Cypher on production execute finds shared Spot/Futures callers; 15 process-participating direct callers touch 92 flows. HIGH impact was disclosed before edits. The adapter's direct setup/import/main path was checked. Source/test review must prove physical mode unchanged and exercise the exported production limiter, not its copied legacy test implementation.

## Verification and boundaries

Production first, tests second. Prove failed+successful retry costs twice, exhausted retries cost all attempts, no retry before window capacity, cancellation during a retry reservation, unchanged Futures physical charges and unchanged mutation attempt count. Test adapter weights alongside exact outgoing query params. Run all checks and graph review before commit. Operator live acceptance stays pending; no intentional exchange overload. Direct Spot trade/reconciliation calls are a separate admission boundary, not asserted metered by this change.
