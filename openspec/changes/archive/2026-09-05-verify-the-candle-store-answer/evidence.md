# F07 implementation evidence — 2026-09-05

Later ordinary-use operator acceptance is recorded in [tasks](tasks.md).
Pending-live wording below describes the implementation checkpoint; no
unobserved edge case becomes live-confirmed through archival.

The store boundary now proves the exact canonical symbol, market, interval and echoed half-open request bounds. Timestamp metadata must name a timezone. Raw bars are checked before sorting: safe integer seconds/milliseconds, bucket alignment (including Monday weeks), strict order/uniqueness, request containment, numeric finite OHLCV and raw OHLC inequalities before eight-place conversion. Full pages additionally require exact actual coverage and every expected bucket; partial windows must contain every whole bucket after edge trimming. Short pages remain misses, not listing proof.

The HTTP handler still makes one bounded loopback GET with topup=false, existing deadline/body limit and cooldown. Bad identity/geometry returns null with fixed safe codes, never a hit/body log. Existing workstation service falls back from null/short/failed store reads through its own admitted exchange path. No Hunter/database/services/credentials touched. Upstream API/schema/repository source was inspected read-only and confirms the echoed fields and minute-normalized bounds; no live response is asserted.

Production first, then 24 new test cases (42 total candle-store tests), many parameterized over both modes. Real ephemeral HTTP loopback fixtures cover foreign/missing identity, earlier/later/null/missing bounds, duplicate/reversed/off-grid/skipped/outside buckets, contradictory actual coverage, missing window head/tail/interior, invalid numeric coercions and raw precision-hidden OHLC contradiction, valid Unicode and Monday-week pages, cooldown and no hit on rejection. Existing partial-window, short-page, deadline, abort, disabled-store and request-shape cases pass. The fixture server now echoes actual requested metadata by default; explicit wrong/missing fields override those defaults and are never repaired.

The first targeted command named a nonexistent service test file and Vitest ran only the one matching store suite (42 passed). This is not evidence of two suites. Full verification includes the actual futures-workstation-service.test.js with its existing exchange fallback/short-page tests. Final totals and graph review follow below.

## Graph and limitations

Baseline 0e3785d, main. parseAnswer/servePage/serveWindow/tupleOf each reach six upstream nodes; readCandles has direct emitStoreWindow/readStorePage callers (0.9), then history/interval/generation paths (0.95). Name-based decimalOf resolved the unrelated wallet helper and reported HIGH; disclosed, no wallet edit. Exact candle-store graph confirms its own decimalOf → tupleOf path. Graph shows no processes for readCandles itself despite known callers: not proof of no runtime impact. Existing 20-node-per-file detect_changes cap requires exact-path supplementation. Only the production store module changes; service/trading implementation is untouched.

## Decisions and outstanding acceptance

Final full local checks: **140 files / 3,354 tests passed**, lint, production build and all dependency/architecture gates. Staged MCP all and compare/main each report 8 files / 53 changed nodes / zero reported processes, LOW, no partial/truncated flag. This is not an all-clear: exact path contains 23 production nodes (above its internal cap) and seven test nodes; known readCandles → generation/history callers are separately documented above and covered in futures-workstation-service.test.js. Source diff is confined to the store boundary and test fixtures. OpenSpec strict validation passed.

Chose rejection plus existing exchange fallback rather than accepting mismatched cached data. New-listing short-page acceptance remains in let-the-store-vouch-for-a-listing; cache-hit telemetry remains in count-the-pages-the-cache-serves. Float precision stays the upstream/legacy eight-place policy, not claimed solved. Operator live confirmation of normal store hits and chart history remains outstanding; no artificial quota exhaustion, no archive.
