## Why

Audit A03 found no React error boundary. A render failure in a chart or analytics panel can remove the entire desk and its order controls. Suspense does not handle errors.

## What Changes

- Catch workspace/provider or lazy-load failures beneath the persistent market/gateway shell.
- Catch Spot chart/analytics failures locally, leaving sibling order controls and account state mounted.
- Place workspace-content recovery beneath Spot DataProvider and the Futures trading hook, so a view retry preserves held command/account state.
- Show explicit unavailable/unknown-state guidance, current local connection/activation status and manual recovery. No automatic retry or command replay.

## Capabilities

### New Capabilities
- `workspace-render-recovery`: scoped React render-error isolation and manual view recovery.

### Modified Capabilities
None.

## Impact

App workspace boundary, Spot/Futures content wrappers, reusable fallback components/styles and renderer regressions. Trading handlers, SDK calls and backend lifecycle are unchanged.
