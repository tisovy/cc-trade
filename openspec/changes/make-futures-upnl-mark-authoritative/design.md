## Context

See `proposal.md` for motivation. Today the renderer receives mark frames that may be republished from aggregate-trade movement, then derives `mark + (last - anchor)` while displaying the unmodified mark. The top-level trading hook owns that changing map, so a valuation frame can repaint the portfolio dock and its un-memoized history subtree. The exchange account/position payload already carries a snapshot `unRealizedProfit`, and the mark stream supplies the authoritative live price.

## Goals / Non-Goals

**Goals:**

- Make one reproducible valuation object the source for row uPnL, ROE, notional, total, and explanatory detail.
- Keep an honest fallback/unknown state when live mark inputs are incomplete.
- Localize mark-driven React work to open-position rows and the aggregate that consumes them.
- Keep long history reviews reachable while bounding render and round-fold work.

**Non-Goals:**

- Drawing a mark overlay on the chart.
- Changing Binance liquidation or margin formulas.
- Treating last trade as an interchangeable risk price.
- Adding a third-party virtualization package.

## Decisions

### 1. Use a strict valuation-source ladder

For each `{symbol, positionSide}` produce a `PositionValuation` with `source`, `sourceAt`, `markPrice`, `unrealizedPnl`, `notional`, `roe`, and `complete`. Source priority is current live mark plus valid entry/quantity, then a coherent account snapshot, then unknown. Fields from two source generations are not mixed.

This is preferred to retaining the carried-price formula because every displayed primary number can be reproduced from the displayed mark. It is preferred to always trusting snapshot uPnL because snapshots are less frequent than the public mark stream.

### 2. Keep tape disagreement outside the primary valuation

The existing chart-disagreement explanation may calculate a last-trade what-if from the same position inputs, but stores it under a separate optional `tapeScenario`. It is never assigned to `unrealizedPnl`, never enters an aggregate, and never affects margin/risk.

### 3. Make aggregate completeness explicit

The total selector returns `{value, complete, missingCount, sourceAt}`. `value` may support a qualified partial tooltip, but the headline is not formatted as a complete number when `complete` is false. Known-empty and not-yet-read remain distinct.

### 4. Subscribe React consumers at the smallest useful boundary

Keep mark data in a small external store with per-symbol snapshots and `useSyncExternalStore` subscriptions at memoized position rows. The dock aggregate subscribes to the set of currently open position keys. Held history props use stable identities and a memoized review component; marks are not a history dependency.

This avoids moving every market tick through the monolithic hook state. A plain top-level `useState` plus `React.memo` was considered, but it still invalidates parent render work and is fragile when aggregate objects are recreated.

### 5. Derive rounds once and window review output

When fills/income change, derive one immutable round index shared by open-settlement selectors and Closed Positions. Render a bounded page/window with overscan and an accessible “older/newer” control. Date headings participate in the window model so accessibility order remains correct. No extra exchange read is caused by moving inside held rows.

## Risks / Trade-offs

- **[Snapshot and live formula differ briefly]** → Prefer live mark as soon as all row inputs share a coherent generation; retain source labels and seam tests around transition.
- **[Fine-grained subscriptions complicate lifecycle]** → Key subscriptions by activation generation and clear the store on market/account teardown.
- **[Windowed history can disrupt focus]** → Keep stable round keys, explicit focus restoration, and keyboard tests for moving between windows.
- **[Removing aggTrade valuation reduces apparent update frequency]** → This is intentional; explanatory tape data may remain, while financial state follows the exchange mark cadence.

## Migration Plan

1. Add the mark-authoritative valuation object and switch production row/total consumers to it while preserving the old fields temporarily for comparison diagnostics.
2. Remove carried-price writes and aggregate-trade-triggered valuation publications.
3. Split/memoize row and history consumers, then add the bounded held-review window.
4. After production behavior exists, update unit, component, render-count, and out-of-order frame tests.
5. Compare probe values with Binance position mark/uPnL on live data before archiving. Rollback is the previous valuation selector; no persisted schema changes are required.
