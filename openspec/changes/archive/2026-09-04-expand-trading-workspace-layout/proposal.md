## Why

The Futures workstation is capped at 1580 CSS pixels even when the application window is much wider, leaving large unused side gutters while dense labels and table values wrap or truncate inside the desk. The layout should use the width the operator has made available without creating a page-level horizontal scrollbar or drawing beyond the viewport.

## What Changes

- Let the production Futures workstation grow across the available viewport width instead of stopping at a fixed desktop maximum.
- Give the selected-contract identity enough scale-aware header width to keep ordinary long symbols inside their own column.
- Keep a small responsive edge inset so the workstation never touches or crosses the viewport boundary.
- Make the Futures page explicitly contain horizontal overflow while preserving its existing vertical and panel-owned scrolling behavior.
- Add presentation coverage for wide and constrained viewport contracts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Require the desktop workstation to consume available width, contain the selected contract name, remain inside the viewport, and avoid page-level horizontal scrolling.

## Impact

- Affects the Futures page shell in `src/styles/app-layout.css`, the market-header sizing in `src/components/features/futures/FuturesWorkstation.css`, and presentation tests.
- Does not change React component structure, trading behavior, data flows, APIs, dependencies, or the Spot workspace.
