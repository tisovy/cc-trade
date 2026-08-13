## Why

The futures workstation currently uses the same saturated red accent for shell
borders, selected controls, and genuinely negative trading states, so urgency is
hard to distinguish from ordinary structure. Its always-open portfolio dock
also claims a large fixed share of short windows even when the operator is
focused on the chart and market rails.

## What Changes

- Preview a calmer neutral-slate shell with a blue interaction accent, reserving
  red for sell, loss, liquidation, destructive, unavailable, and error states.
- Add an accessible control that collapses the entire portfolio dock into one
  compact summary bar and expands it again without changing positions, orders,
  the selected order-history tab, or account data.
- Default the experiment to the current expanded dock so it is opt-in during a
  session, and keep it in an isolated commit that can be reverted without
  removing the confirmed scrollbar and toolbar fixes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Add semantic color hierarchy and a
  session-local collapsed presentation for the lower portfolio dock.

## Impact

- Futures workstation palette variables and dock presentation styles.
- `FuturesPortfolioDock` local presentation state and summary markup.
- Focused portfolio-dock tests. No account mutation, order execution, market
  data, storage schema, Electron, or exchange protocol changes.
