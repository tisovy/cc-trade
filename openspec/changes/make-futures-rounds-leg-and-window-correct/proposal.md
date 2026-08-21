## Why

The round builder keeps one exposure state per symbol, so hedge-mode LONG and SHORT fills can close each other and create phantom Closed Positions. A bounded 1000-fill window is also treated as sufficient even when the opening boundary is absent, causing guessed reversals, missing break-even closes, and stale open-position settlement.

## What Changes

- Fold hedge fills independently by `{symbol, positionSide}` while preserving a separate signed `BOTH` fold for one-way mode.
- Carry per-leg fill coverage and distinguish resolved, unresolved, open, and closed round state.
- Progressively read older fills only for legs whose current position or requested Closed Positions review lacks a proven flat boundary.
- Reconcile reconstructed terminal exposure with the current position snapshot before declaring a round complete.
- Replace the 1%-of-notional reversal tolerance with precision-derived decimal comparison; incomplete data never becomes an exact round through tolerance.
- Keep open-position realized PnL and commission current from execution reports or a coalesced targeted gap read without requiring the operator to open History.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: make round identity leg-aware, make history-window quality explicit, and acquire the minimum fill basis needed for current open positions.

## Impact

Affected areas include Futures trade-history acquisition and storage, `futuresTradeRounds`, `futuresSettledMoney`, `useFuturesTrading`, Closed Positions presentation, and execution-report handling. GitNexus labels the fold helpers LOW because several ESM/JSX edges are absent; their semantic consumers span both open PnL and Closed Positions.
