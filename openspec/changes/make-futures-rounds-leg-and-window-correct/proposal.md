## Why

The round builder keeps one exposure state per symbol, so hedge-mode LONG and SHORT fills can close each other and create phantom Closed Positions. A bounded 1000-fill window is also treated as sufficient even when the opening boundary is absent, causing guessed reversals, missing break-even closes, and stale open-position settlement.

## What Changes

- Fold hedge fills independently by `{symbol, positionSide}` while preserving a separate signed `BOTH` fold for one-way mode.
- Persist one bounded fill-acquisition proof per contract, project that proof to each same-generation position leg, and distinguish resolved, unresolved, open, and closed round state without duplicating durable REST checkpoints per leg.
- Progressively read older fills only for legs whose current position or requested Closed Positions review lacks a proven flat boundary.
- Reconcile reconstructed terminal exposure with the current position snapshot before declaring a round complete.
- Replace the 1%-of-notional reversal tolerance with precision-derived decimal comparison; incomplete data never becomes an exact round through tolerance.
- Keep open-position realized PnL and commission current from execution reports or a coalesced targeted gap read without requiring the operator to open History.
- Preserve Binance's per-fill `marginAsset`, require one proven settlement asset per round, and reacquire persisted fills that predate that field instead of labelling every USDⓈ-M round as USDT.
- Make one backend-owned, per-renderer transactional acquisition session responsible for cold reads, bounded continuations, reconnect gaps, and atomic replacement.
- Bound the persistent contract cache across the whole active account namespace, removing legacy and previous-fingerprint records so account isolation cannot turn each credential rotation into another unbounded cache.
- Commit shared traded-symbol discovery monotonically so an older concurrent renderer answer cannot replace a newer cache snapshot.
- Evict acquisition checkpoints when their bounded retry budget is exhausted; terminal incomplete evidence remains visible, but session memory does not retain dead work indefinitely.
- Bound the cumulative `/userTrades` pages consumed by one frozen Full/cold acquisition, carrying only the remaining budget into each continuation and ending truthfully incomplete when it is spent.
- Persist each composite history update in one IndexedDB read/write transaction so concurrent renderer instances merge against the latest committed state, prune once, and close their database connection after the transaction settles.
- Treat an unreadable canonical fill as a continuity barrier for its position key instead of silently folding exact later money around the missing execution.
- Keep internally derived exact entry ratios comparable when JavaScript renders their presentation number in scientific notation; the raw-exchange scientific-number rejection does not discard evidence the fold itself already parsed exactly.
- Normalize commission-asset evidence once at the canonical fill boundary and use that same value for coverage, fee allocation, and settlement-asset NET.
- Make `/fapi/v1/userTrades` a bounded transactional evidence boundary: omit truly absent optional request times without inventing epoch, reject malformed present bounds, foreign-contract rows, and non-canonical essential fill evidence before coverage or persistence can advance.
- Compare every present field on an unreadable duplicate with its valid canonical copy; a shared trade ID must not hide contradictory topology or money merely because one copy is incomplete.
- Distinguish an actually absent duplicate field from a present-but-malformed money or asset value; malformed evidence is a continuity conflict and cannot be enriched away by a valid copy.
- Reuse the bounded canonical asset domain inside the round fold itself so retained or internal evidence cannot emit an exact NET denominated in an arbitrary or unbounded string.
- Preserve the user-stream execution's margin asset in the held fill projection so current fills do not discard settlement evidence and buy an avoidable REST repair.
- Cap each leg's proven right edge before its earliest stream-only fill until the coalesced REST gap read confirms it, preserving older exact rounds without promoting a raced fill.
- Preserve contract retention, page-limit, and continuity evidence when a current snapshot names a leg for which no retained fill can be folded, so the missing basis reports the real acquisition limit instead of a generic false-negative coverage record.
- Version canonical trade evidence independently from order-only history refreshes and retain untouched endpoint collections by reference, so an unrelated order response cannot rematerialize/refold thousands of fills or rebuild every Closed NET result.
- Reconcile the Closed presentation contract around two explicit money columns: exchange-reported `Gross` and additive exact-or-qualified `NET`, while keeping fee/funding detail on the row rather than inventing standalone component columns.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: make round identity leg-aware, make history-window quality explicit, and acquire the minimum fill basis needed for current open positions.

## Impact

Affected areas include Futures trade-history acquisition and storage, `futuresTradeRounds`, `futuresSettledMoney`, `useFuturesTrading`, Closed Positions presentation, and execution-report handling. GitNexus reports HIGH risk for `openRound`, `applyFill`, `finishRound`, and history-store restore; their consumers span both open PnL and Closed Positions. The shared history command queue is CRITICAL (29 impacted symbols across seven indexed flows), so ownership changes remain narrow and regression-tested.
