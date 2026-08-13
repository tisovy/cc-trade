## Why

The futures workstation reaches its current 85% scale floor while still wasting
scarce rail space on two-up recent-contract pills and decorative favorite stars.
Operators need a denser, reversible layout that keeps more of the market and
execution surfaces visible without making contract-history cleanup ambiguous.

## What Changes

- Extend the persisted futures interface-scale control down to 70% in the
  existing five-percentage-point steps, while keeping 100% as the reset value.
- Lay out recent-contract pills in a stable three-column grid at the supported
  workstation width, keeping every symbol fully visible by wrapping long names
  inside their own grid slot rather than shortening them.
- Replace the favorite-star control inside recent pills with an explicit `×`
  action that removes an inactive contract from persisted recency without
  selecting it or changing its favorite state.
- Keep the active contract represented and make its remove action unavailable
  until the operator selects another contract; keep favorite management in the
  searchable catalogue where the star continues to describe that behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Lower the persisted interface-scale floor
  and define the density, overflow, removal, and active-contract behavior of the
  recent-contract pill group.

## Impact

- Futures UI-scale bounds and their persisted normalization.
- Futures symbol-history mutation and persistence.
- The production workstation container/view contract for removing recent
  symbols.
- Recent-contract markup, styling, accessible names, and focused React/unit
  coverage. No exchange protocol, order execution, account state, or market-data
  transport behavior changes.
