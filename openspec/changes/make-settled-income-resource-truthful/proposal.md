## Why

A failed Binance income read can advance coverage and publish old or empty data with a fresh `readAt`, and a verification correction with unchanged row count/bounds may never be broadcast. The renderer therefore cannot reliably distinguish last confirmed income from a failed attempt.

## What Changes

- Model settled income as an explicit resource with `loading`, `ready`, `stale`, and `failed` states plus separate attempted and last-successful times.
- Advance and persist coverage only after successful logical pages; a failed verification retains the previous data, coverage, and successful timestamp unchanged.
- Reject expired or internally invalid cached coverage instead of emitting inverted or apparently current spans.
- Carry `coveredFrom`, `coveredTo`, `targetTo`, completeness, and failure end-to-end through store, IPC, hook, and UI.
- Use a canonical content revision or monotonic generation so same-shape row corrections always reach the renderer while identical frames remain deduplicated.
- Make manual Refresh await the settled-income result or explicitly report it as an independently pending resource; a successful account refresh must not hide an income failure.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: carry bidirectional settled-income coverage and content changes to every consumer.
- `futures-live-readiness`: expose settled income as an independently truthful, retryable account resource.

## Impact

Affected areas include the settled-income store/walk, `readFuturesSettledMoney`, scheduling/broadcast, IPC frames, `useFuturesTrading`, refresh outcomes, open positions, and Closed Positions. GitNexus rates `readFuturesSettledMoney` CRITICAL (5 upstream symbols and 7 execution-flow groups) and `store.load` HIGH, so implementation must be staged behind seam tests.
