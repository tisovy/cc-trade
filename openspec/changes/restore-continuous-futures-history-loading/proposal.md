## Why

The Futures chart can mount before its first live candle window arrives, while its left-edge history subscription evaluates only at mount or when the callback changes. The initial history read is therefore timing-dependent, and an interval switch can retain the previous interval's logical viewport instead of fitting and paging the newly selected series; on live 1m BEATUSDT and BTWUSDT this presents as history loading once or not at all even though the exchange history reads succeed.

## What Changes

- Make the chart session identity include both contract and interval so a newly selected interval resets its drawn-row bookkeeping, initial fit, and interaction generation.
- Re-evaluate the history prefetch condition when the oldest loaded candle first appears or moves, while retaining the existing single-flight and exhaustion guards.
- Preserve viewport anchoring after a prepend and prove that a later trip to the new left edge requests the next page.
- Add renderer regression coverage for an empty-at-mount chart, interval replacement, and consecutive left-edge pages.

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

GitNexus reports LOW upstream risk for `FuturesWorkstationChart` (2 direct dependants, 2 affected process groups) and MEDIUM for `FuturesWorkstationView` (one production caller plus test helpers, one affected production flow).
