## Context

See `proposal.md` for the runtime symptom. The chart object deliberately survives ordinary React renders, and its viewport is held stable when history is prepended. Today its reset identity is only `symbol`, while the data selection is `symbol + interval`; its history effect also samples the current logical range before an asynchronously bootstrapped candle window necessarily exists.

React can commit a new selected interval one render before the workstation
effect replaces the state that belonged to the old interval. The view currently
accepts resources by symbol alone, and the chart writes its imperative series in
a passive effect, so the old canvas can survive a browser paint under the new
selection label.

The service and transport are not the failing boundary: live diagnostics show successful `candle-history` reads and committed history frames, and Binance exposes history older than the page window for both reported contracts. Existing single-flight, cache, ownership, and exhaustion semantics must remain unchanged.

## Goals / Non-Goals

**Goals:**

- Give every contract/interval selection one fresh chart-session lifecycle without recreating the chart instance.
- Evaluate history prefetch when the first usable oldest candle becomes available and after that oldest candle changes.
- Preserve current viewport anchoring, request bounds, cache behavior, and trading overlays.
- Never paint candle rows whose contract-and-interval owner differs from the current selection.

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

### Isolate the rendered series at the selection boundary

`FuturesWorkstationView` will expose live candle rows to the chart only when the
workstation state owns both the selected symbol and selected interval. Symbol-
owned resources that do not vary by interval remain available during the short
transition.

The chart will clear its existing candle and volume data in a layout effect when
the `symbol + interval` session changes. A passive data effect is too late for
this boundary because the retained canvas can already have been painted. This
keeps the chart instance and subscriptions alive while making the replacement
atomic from the operator's point of view.

### Prove lifecycle sequences at the chart boundary

Regression tests will render the chart empty before delivering candles, replace an interval without remounting, and exercise a second edge after a prepend. These tests target the missed lifecycle ordering rather than duplicating backend paging tests that already pass.

## Risks / Trade-offs

- [An oldest-candle change resubscribes the range listener] → The change happens only on initial delivery, prepend, or an unhistoried sliding window; cleanup precedes subscription and the current range is sampled immediately.
- [Resetting on interval can clear an in-progress chart gesture] → A gesture belongs to the candle scale it began on and must not survive an interval replacement; this matches existing symbol-change behavior.
- [The immediate sample could call while a request is already active] → `loadCandleHistory` remains the authoritative single-flight gate and returns without a duplicate request.
- [Clearing before the next window arrives briefly leaves an empty plot] → An empty plot truthfully states that the new selection has no owned candle frame yet; retaining the previous selection would show false market data under the new label.

## Migration Plan

Ship as a renderer-only change. Rollback restores the previous two component files; no stored data or protocol migration is required. Live operator confirmation remains required before archival.
