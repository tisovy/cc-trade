## Context

See `proposal.md` for motivation. Futures styling already centralizes ordinary
selection, panel border, and shell colors in four CSS variables, but a later
futures-specific override currently changes all four to saturated red/burgundy.
Semantic buy, sell, PnL, liquidation, warning, and connection-state colors are
declared separately and can remain unchanged.

`FuturesPortfolioDock` owns only one existing local view state (`ordersTab`) and
receives account data and command callbacks from above. Its section occupies the
workstation grid's auto-sized final row, so reducing the section to one compact
child naturally returns height to the rows above without changing the parent
layout contract.

## Goals / Non-Goals

**Goals:**

- Let routine interaction and structural chrome recede behind live market,
  execution, and risk readings.
- Let the operator reclaim dock height with one reversible session-local action.
- Keep the experiment isolated so it can be accepted or reverted independently
  of the confirmed control polish.

**Non-Goals:**

- Rebranding Spot, changing global application colors, or changing semantic
  buy/sell/PnL state.
- Persisting dock collapse, resizing individual dock panels, or changing their
  table columns.
- Mutating, refetching, or suspending account data while the dock is collapsed.

## Decisions

### Change only the futures structural variables

The futures override will use a neutral slate shell and border with a restrained
blue interaction accent and translucent blue soft accent. Explicit green,
amber, and red semantic rules remain untouched. This is the smallest coherent
color experiment and makes rollback a four-variable diff rather than a broad
selector rewrite.

Changing every hard-coded red was rejected because those declarations mostly
encode real negative or destructive meaning. Keeping a red workspace header but
neutral borders was considered, but it would still make ordinary Futures
identity compete with losses and sells.

### Keep collapse state inside the dock component

A boolean `isCollapsed` state will default to false. Expanded markup keeps both
existing panels and adds one collapse button; collapsed markup keeps the same
section mounted but replaces the panels with a summary row and expand button.
Because `ordersTab` and all received props remain owned by the mounted component,
expansion restores the exact view without a data transition.

Persistence was rejected for this preview because a short-lived layout choice
should not surprise the operator on the next launch, and it would add a storage
contract to an experiment. CSS `resize` was rejected because the workstation
grid cannot give a native resize handle reliable upper/lower bounds across the
stacked and split dock layouts; collapse has two predictable states.

### Summarize only already-derived readings

The compact row will reuse the component's derived positions availability,
orders availability, total unrealized PnL, and tone. It will not initiate a read
or infer zero before account resources have answered. The summary therefore
keeps the same truthfulness contract as the expanded headers.

## Risks / Trade-offs

- [Blue can be read as Spot identity] → Keep the surrounding market switch and
  explicit `USDⓈ-M FUTURES` label unchanged; this experiment changes hierarchy,
  not market naming.
- [Collapsed tables hide actionable rows] → Default expanded, keep counts and
  total uPnL visible, and provide a clearly named one-action expand control.
- [A large data change occurs while collapsed] → Continue receiving props and
  compute the compact summary from current values, so counts and PnL still move.

## Migration Plan

Land this OpenSpec change, palette variables, dock code, CSS, and focused tests in
one commit after the stable control-polish commit. The experiment can be removed
with `git revert <experiment-commit>`; doing so leaves the earlier scrollbar,
icon, and full-symbol fixes in place. No data migration or cleanup is required.
