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

Mark admission is monotonic per symbol. A frame with an older exchange timestamp, or no timestamp after a timed frame, cannot replace the accepted mark. The funding schedule carries its own accepted event time across reconnects: a delayed frame cannot rewind its baseline and make the next current frame look like a new settlement, while a newer frame may legitimately reschedule funding earlier without being reported as a settlement.

Each full publication carries a monotonic feed-instance epoch and a revision scoped to that epoch. The renderer admits the whole frame before applying per-symbol changes, because symbol timestamps alone cannot distinguish “this contract closed” from “this older frame predates that contract.” Renderer transport loss clears admission and every live mark when the old source can no longer speak. A renderer market-generation change only clears visible readings while preserving admission: the shared backend feed normally survives that activation and must continue with the next revision in the same epoch. An actual newer feed epoch opens a fresh revision namespace and then excludes late frames from older epochs.

Feed health is per tracked contract. Only a strictly newer, timed exchange event proves progress for that symbol; duplicates, equal-time conflicts, older frames, and untimed frames after a timed baseline do not touch value, funding, or liveness. Missing progress for any symbol withdraws the full map before reconnect, because a combined stream cannot truthfully keep one stale contract labelled live merely because another contract is moving.

Funding schedule movement is not itself proof that funding settled. A newer frame may reschedule the baseline in either direction without reconciliation before the held boundary; an advance is reported only once exchange event time has reached the boundary that was being observed.

### 3. Make aggregate completeness explicit

The total selector returns `{value, complete, missingCount, sourceAt}`. `value` may support a qualified partial tooltip, but the headline is not formatted as a complete number when `complete` is false. Known-empty and not-yet-read remain distinct.

### 4. Subscribe React consumers at the smallest useful boundary

Keep mark data in a small external store with per-symbol snapshots and `useSyncExternalStore` subscriptions at memoized position rows. The dock aggregate subscribes to the set of currently open position keys. Held history props use stable identities and a memoized review component; marks are not a history dependency.

The store separates primary mark notifications from optional tape-detail notifications. A row may repaint its explanation on a tape-only change; the aggregate is subscribed only to primary mark revisions and therefore does not recompute.

This avoids moving every market tick through the monolithic hook state. A plain top-level `useState` plus `React.memo` was considered, but it still invalidates parent render work and is fragile when aggregate objects are recreated.

### 5. Derive rounds once and window review output

When fills/income change, derive one immutable round index shared by open-settlement selectors and Closed Positions. Render a bounded page/window with overscan and an accessible “older/newer” control. Date headings participate in the window model so accessibility order remains correct. No extra exchange read is caused by moving inside held rows.

### 6. Bound shared delivery by real Futures consumers

The mark feed publishes complete, revisioned frames through a Futures-only broadcaster using the superseding market lane. A slow renderer therefore retains the newest full truth rather than a FIFO of obsolete snapshots, and a Spot renderer receives none of this work. The same idempotent shared Futures teardown is used when the last Futures renderer leaves and during service shutdown; it stops mark/reconnect/watchdog work, cancels settlement debounce/confirmation, and advances the settled-read activation guard before pending work can continue.

Private-stream callbacks and rate-limited keep-alive jobs prove socket identity, generation, and active consumers immediately before every side effect and again before a late failure can change resource state. Teardown nulls that identity before closing the socket, so a frame already buffered by a graceful WebSocket close or a keep-alive already queued behind the limiter cannot recreate work or fault a replacement activation. A renderer leaving Futures also loses any queued position-mark frame from that activation; Futures-only broadcast membership prevents new traffic, while the outbox boundary prevents already queued traffic from crossing the market activation.

### 7. Keep presentation DTOs out of financial actions

Rows may merge a live valuation for display, but callbacks pass raw account identity/position. The workstation resolves that identity only against the current positions resource and dismisses action state once a successful reading confirms absence. Margin actions use the coherent raw account risk snapshot, not a mark-enriched presentation object; ADD and REMOVE each require their own known bound. Ticket entry intent remains semantic and lets the adapter resolve the account's position mode, while Ticket exits resolve the current raw account leg so one-way positions retain `BOTH` and hedge positions retain `LONG` or `SHORT`. Exit confirmation is bounded by the named leg rather than net exposure, so a balanced hedge book is not mistaken for an empty one. A staged order is synchronously withdrawn when the selected contract changes and carries its frozen symbol defensively through submission instead of relying on passive-effect timing. The main process independently proves any claimed reduction against the current leg before allowing it to bypass exposure controls.

That backend proof is activation-scoped and fail-closed: only a READY positions snapshot admitted for the current Futures activation may authorize the exemption. A held row while the next snapshot is loading, or a successful row retained from a retired activation, is presentation history rather than command authority.

For live ROE, isolated wallet is a stable committed denominator. CROSS position margin moves with notional, so it is derived from the current live notional and confirmed leverage when possible; otherwise ROE is unknown. The valuation DTO carries that denominator so a row showing Margin cannot retain a snapshot dollar amount beside a percentage derived from the current one. Snapshot ROE prefers `positionInitialMargin`, excluding working-order reserve.

## Risks / Trade-offs

- **[Snapshot and live formula differ briefly]** → Prefer live mark as soon as all row inputs share a coherent generation; retain source labels and seam tests around transition.
- **[Fine-grained subscriptions complicate lifecycle]** → Key subscriptions by activation generation and clear the store on market/account teardown.
- **[Windowed history can disrupt focus]** → Keep stable round keys, explicit focus restoration, and keyboard tests for moving between windows.
- **[Removing aggTrade valuation reduces apparent update frequency]** → This is intentional; explanatory tape data may remain, while financial state follows the exchange mark cadence.
- **[Per-symbol watchdog reconnects the combined socket for one silent contract]** → Clearing all readings is safer than retaining a stale live label; the reconnect is bounded by the existing delay and happens only after the liveness window.
- **[Fail-closed actions may temporarily disable a control]** → State why the bound or current-position proof is unavailable; never replace missing financial authority with zero or a stale presentation value.

## Migration Plan

1. Add the mark-authoritative valuation object and switch production row/total consumers to it while preserving the old fields temporarily for comparison diagnostics.
2. Remove carried-price writes and aggregate-trade-triggered valuation publications.
3. Split/memoize row and history consumers, then add the bounded held-review window.
4. After production behavior exists, update unit, component, render-count, and out-of-order frame tests.
5. Compare probe values with Binance position mark/uPnL on live data before archiving. Rollback is the previous valuation selector; no persisted schema changes are required.
