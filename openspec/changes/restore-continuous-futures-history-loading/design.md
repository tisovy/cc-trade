## Context

See `proposal.md` for the runtime symptom. The chart object deliberately survives ordinary React renders, and its viewport is held stable when history is prepended. Today its reset identity is only `symbol`, while the data selection is `symbol + interval`; its history effect also samples the current logical range before an asynchronously bootstrapped candle window necessarily exists.

The service and transport are not the failing boundary: live diagnostics show successful `candle-history` reads and committed history frames, and Binance exposes history older than the page window for both reported contracts. Existing single-flight, cache, ownership, and exhaustion semantics must remain unchanged.

## Goals / Non-Goals

**Goals:**

- Give every contract/interval selection one fresh chart-session lifecycle without recreating the chart instance.
- Evaluate history prefetch when the first usable oldest candle becomes available and after that oldest candle changes.
- Preserve current viewport anchoring, request bounds, cache behavior, and trading overlays.

**Non-Goals:**

- Raising the 5,000-row renderer/cache ceiling.
- Changing exchange request size, service pagination, protocol events, or failure recovery.
- Remounting the entire chart or changing Spot history behavior.

## Decisions

### Pass interval as part of the chart's selection identity

`FuturesWorkstationView` will pass the selected interval to the chart. The chart's existing selection-reset effect and interaction generation will depend on both `symbol` and `interval`, clearing drawn-row bookkeeping and rearming the first authoritative `fitContent` for the replacement series.

This is preferred to adding a React `key`, because remounting would destroy and rebuild the chart, all series, resize observation, and event subscriptions. It is also preferred to inferring an interval from adjacent timestamps because short or sparse windows do not provide a reliable identity.

### Re-evaluate the existing edge handler from the oldest candle identity

The history subscription will include the oldest usable candle time in its effect dependencies. When an empty chart receives its live window, the effect resubscribes and immediately samples the already-settled logical range. When a page is prepended, the data-drawing effect runs first and restores the held viewport; the history effect then samples that restored range, so it does not chain pages unless the viewport is genuinely still at the new edge.

This keeps one request path and the hook's existing single-flight guard. A timer, polling loop, or synthetic range event would add a second state machine and could create duplicate exchange reads.

### Prove lifecycle sequences at the chart boundary

Regression tests will render the chart empty before delivering candles, replace an interval without remounting, and exercise a second edge after a prepend. These tests target the missed lifecycle ordering rather than duplicating backend paging tests that already pass.

## Risks / Trade-offs

- [An oldest-candle change resubscribes the range listener] → The change happens only on initial delivery, prepend, or an unhistoried sliding window; cleanup precedes subscription and the current range is sampled immediately.
- [Resetting on interval can clear an in-progress chart gesture] → A gesture belongs to the candle scale it began on and must not survive an interval replacement; this matches existing symbol-change behavior.
- [The immediate sample could call while a request is already active] → `loadCandleHistory` remains the authoritative single-flight gate and returns without a duplicate request.

## Migration Plan

Ship as a renderer-only change. Rollback restores the previous two component files; no stored data or protocol migration is required. Live operator confirmation remains required before archival.
