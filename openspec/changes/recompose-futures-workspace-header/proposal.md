## Why

The Futures workspace currently spends the top of the window on a red background before the workstation begins, which separates the market-mode controls and local clock from the interface they control. Recompose this chrome so the blue Futures identity strip establishes the workspace immediately and the controls read as part of the same surface.

## What Changes

- Place the blue `USDⓈ-M FUTURES` identity strip at the top edge of the active Futures workspace with no red backdrop above it.
- Overlay the centered Spot/Futures switch on the identity strip so the buttons hang down from that strip while remaining fully usable and legible.
- Place the centered local clock in the workstation surface immediately below the identity strip, reserving layout space so it does not cover the market header or other controls.
- Preserve the existing live/sync status, market switching behavior, local-time format, one-second updates, and responsive workstation behavior.
- Add automated layout-contract coverage for the new header composition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Change the active Futures workspace chrome contract so its identity strip is first, the mode switch overlays it, and the local clock occupies the next in-interface row.

## Impact

- React composition in `src/App.jsx` around `WorkspaceGateway`, `MarketModeSwitch`, and `MarketClock`.
- Futures workstation identity/header markup in `src/components/features/futures/FuturesWorkstationView.jsx` if a dedicated clock slot is needed.
- Layout styling in `src/styles/app-layout.css` and `src/components/features/futures/FuturesWorkstation.css`.
- Focused renderer tests for the active workspace header and clock; no backend, protocol, data-flow, API, or dependency changes.
