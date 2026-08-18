## Why

The workstation currently builds and emits a full depth view for every applied 100 ms diff. Socket backpressure can replace already queued books, but a healthy renderer still receives the full exchange cadence, so serialization, parsing and render work remain unbounded by the display's useful update rate.

## What Changes

- Bound routine depth delivery so emissions are separated by at least 200 ms, with an immediate leading delivery when eligible and one newest trailing delivery.
- Keep at most one pending depth state per shown session and always deliver the newest pending book at the trailing edge.
- Let stale/unavailable/resynchronizing depth states and the first live state after recovery bypass the ordinary delivery delay so operational state is not hidden behind market-data throttling.
- Cancel pending delivery on session release or ownership change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Limit routine depth delivery while preserving the newest book and immediate service-state transitions.

## Impact

- `electron/services/futures-production-workstation-service.js`
- Depth delivery timing constants and focused service tests
- Existing renderer outbox remains the transport backpressure layer
