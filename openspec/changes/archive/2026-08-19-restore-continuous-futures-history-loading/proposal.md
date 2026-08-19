## Why

The Futures chart can mount before its first live candle window arrives, while its left-edge history subscription evaluates only at mount or when the callback changes. The initial history read is therefore timing-dependent, and an interval switch can retain the previous interval's logical viewport instead of fitting and paging the newly selected series; on live 1m BEATUSDT and BTWUSDT this presents as history loading once or not at all even though the exchange history reads succeed.

## What Changes

- Make the chart session identity include both contract and interval so a newly selected interval resets its drawn-row bookkeeping, initial fit, and interaction generation.
- Keep candle rows behind the exact contract-and-interval owner that delivered them, and clear the imperative chart series before the browser can paint a replacement selection.
- Re-evaluate the history prefetch condition when the oldest loaded candle first appears or moves, while retaining the existing single-flight and exhaustion guards.
- Preserve viewport anchoring after a prepend and prove that a later trip to the new left edge requests the next page.
- Add renderer regression coverage for an empty-at-mount chart, interval replacement without a stale-selection frame, and consecutive left-edge pages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: make opening and scrolling history deterministic when candles arrive after mount and when the selected interval changes.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx`
- `src/components/features/futures/FuturesWorkstationView.jsx`
- Focused chart and view tests
- No backend, protocol, exchange route, credential, cache schema, or trading-action change

After rebuilding the corrupt local index, GitNexus reports LOW upstream risk for `FuturesWorkstationChart` (one direct caller, 3 upstream symbols, 2 affected process groups) and LOW for `FuturesWorkstationView` (one direct caller, 2 upstream symbols, one affected process group).
