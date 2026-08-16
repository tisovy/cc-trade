## Why

The positions dock re-prices an open position continuously from the live account
position stream, but the close panel keeps the position object captured when it
was opened. As a result, a market-close preview can show a stale value and
estimated PnL while the position row behind it is already showing the current
market-derived reading.

## What Changes

- Resolve an open close panel against the latest matching position in the live
  execution state instead of continuing to render its opening snapshot.
- Recompute the market-close value and estimated PnL whenever that live position
  receives a new valuation, using the same price source already used by the
  positions dock.
- Preserve an operator-entered limit price as the authority for a limit-close
  preview while still accepting live changes to the position itself.
- Keep the operator's in-progress close-size draft stable across valuation-only
  updates, while validating it against any live change in open quantity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: require the close panel's market preview to stay
  synchronized with the same live position valuation shown in the portfolio
  dock while the panel remains open.

## Impact

- `src/components/features/futures/FuturesProductionWorkstation.jsx`: derive the
  close panel's current position from `executionState.positions` by stable
  position identity.
- `src/components/features/futures/FuturesPositionCloser.jsx`: continue deriving
  market value and estimated PnL from its current position prop without resetting
  operator-owned draft state on valuation updates.
- Focused React tests for the production workstation/close-panel boundary and
  close-preview recalculation.
- No protocol, Electron service, exchange API, or dependency changes.
