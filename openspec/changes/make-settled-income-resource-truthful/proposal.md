## Why

A failed Binance income read can advance coverage and publish old or empty data with a fresh `readAt`, and a verification correction with unchanged row count/bounds may never be broadcast. The renderer therefore cannot reliably distinguish last confirmed income from a failed attempt.

## What Changes

- Model settled income as an explicit resource with `loading`, `ready`, `stale`, and `error` states plus separate attempted and last-successful times.
- Advance and persist coverage only after successful logical pages; a failed verification retains the previous data, coverage, and successful timestamp unchanged.
- Reject expired or internally invalid cached coverage instead of emitting inverted or apparently current spans.
- Carry `coveredFrom`, `coveredTo`, `targetTo`, completeness, and failure end-to-end through store, IPC, hook, and UI.
- Use a canonical content revision or monotonic generation so same-shape row corrections always reach the renderer while identical frames remain deduplicated.
- Reject canonical income entries without a settlement asset so downstream wallet reconciliation cannot silently relabel unknown money as USDT.
- Enforce the exact canonical exchange-token alphabet for income type, symbol, asset, and optional identifiers without lossy adapter/Unicode normalization, and sanitize diagnostic messages, codes, and logs before persistence or IPC.
- Make manual Refresh await the settled-income result or explicitly report it as an independently pending resource; a successful account refresh must not hide an income failure.
- Keep a newer manual-loading intent authoritative when an older background income walk finishes, so an obsolete completion cannot flash the resource back to ready before the requested pass runs.
- Keep manual-loading intent process-local even when a funding/fill/insurance event must persist confirmation debt during the refresh: durable writes merge the new debt onto last exchange-backed lane state and never serialize provisional loading lanes.
- Make a failed lane serialize as incomplete while retaining its last successful rows and bounds; `stale/error` SHALL never coexist with `complete=true`.
- Establish the active futures account fingerprint on each joining renderer before publishing its current settled-income snapshot, so strict account isolation does not discard a valid snapshot.
- Treat only an actual execution fill as trade-history activity; zero-fill order lifecycle reports must not invalidate confirmed history or schedule a repair read.
- Make renderer ingestion of v2 settled-income frames atomic: reject duplicate lanes, lossy row normalization, wrong-lane rows, and lane/aggregate contradictions, and derive accepted aggregate money only from validated lane authority.
- Require every v2 renderer frame to contain exactly the complete canonical settled-income lane set; reject empty, partial, or extra lane sets before a newer frame can replace held authority.
- Enforce ready/success/pending temporal invariants at persistence and IPC boundaries, derive all aggregate state from lanes, and require actual canonical content equality for same-generation observation updates.
- Keep IPC evidence bounded and single-copy: lanes carry the rows, the renderer derives their union, and oversized lane/compatibility arrays fail before canonicalization.
- Reuse the already-canonical per-lane row snapshot across observation-only publications so a newer clock does not re-normalize and re-sort the unchanged retained ledger.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: carry bidirectional settled-income coverage and content changes to every consumer.
- `futures-live-readiness`: expose settled income as an independently truthful, retryable account resource.

## Impact

Affected areas include the settled-income store/walk, `readFuturesSettledMoney`, scheduling/broadcast, IPC frames, `useFuturesTrading`, refresh outcomes, open positions, and Closed Positions. GitNexus rates `readFuturesSettledMoney` CRITICAL (5 upstream symbols and 7 execution-flow groups) and `store.load` HIGH, so implementation must be staged behind seam tests.
