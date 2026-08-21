## Why

The income walker assumes timestamp ordering that Binance does not guarantee, always requests page 1, and can skip rows when more than one page shares a millisecond. It also re-reads all six income types for narrow funding or rebate triggers, consuming up to 180 request weight per logical page while still allowing some late credits to remain stale.

## What Changes

- Page fixed inclusive time windows with an explicit page counter per income type; never advance a millisecond cursor merely to paginate rows sharing a timestamp.
- Maintain independent coverage, cursor, freshness, and completeness for each required income lane.
- Invalidate only relevant lanes: funding events refresh funding, fills refresh underivable rebate lanes with a coalesced confirmation, and full verification reconciles all lanes.
- Treat response ordering as untrusted; normalize, sort, deduplicate, and prove coverage from request/page completion rather than observed row order.
- Preserve the official three-month retention and 1000-row/page limits as explicit coverage bounds.
- Add measurable request-weight budgets for cold start, event refresh, confirmation, and verification.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: make income pagination and per-type completeness lossless.
- `futures-live-readiness`: bound and expose the request cost of settled-income acquisition.

## Impact

Affected areas include `futures-settled-income-walk`, store format, Binance adapter calls, scheduling/invalidation, diagnostics, probes, and tests. The official Income History endpoint has IP weight 30, inclusive bounds, page/limit controls, and no documented ordering guarantee; the design must not depend on implicit ordering.
