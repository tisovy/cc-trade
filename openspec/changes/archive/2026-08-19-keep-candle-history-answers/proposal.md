## Why

A successfully returned candle-history page can be lost when an error status rewrites the resource snapshot before React applies it, and an ownership refusal can leave the renderer waiting because it is only logged. Both cases make a recoverable history read appear stuck or failed despite the command path having enough information to answer it.

## What Changes

- Apply a completed candle-history response from the event that carried it, independent of a later resource-state rewrite in the same cycle.
- Convert `CANDLE_HISTORY_OWNER_UNAVAILABLE` into a bounded, typed workstation history outcome that names the rejected request without borrowing a resource generation from another session.
- Release the renderer's in-flight history lock on either failure so the next scroll may retry, without treating a failure as exhaustion.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Preserve served history pages across same-cycle status changes and explicitly answer history ownership refusals.

## Impact

- `src/hooks/useFuturesProductionWorkstation.js`
- `src/utils/futuresProductionWorkstationProtocol.js` and the workstation branch of the shared desk-frame router
- `electron/services/futures-production-workstation-service.js`
- `electron/services/binance-connection.js`
- Workstation protocol consumption and focused service/hook tests; no public exchange API change
