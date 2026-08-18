## Why

When a pre-window position is partially closed at break-even, then increased, then closed, the history fold commits too early to an invented opposite position. The real close and realized profit disappear from the review even though later fills disprove that interpretation.

## What Changes

- Reconsider an ambiguous break-even window-edge round when a subsequent opposite-side fill reports zero realized PnL inconsistent with the invented position.
- Restart the round as a pre-window close, then apply the add and final close to the real position sequence.
- Preserve ordinary reversals, genuine in-window opens and position-leg boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-order-visibility`: Reconstruct break-even partial-close/add/close sequences as the position that actually closed, with complete realized PnL and no invented opposite round.

## Impact

- `src/utils/futuresTradeRounds.js`
- Futures trade-round characterization tests and closed-position history presentation
- No exchange read, execution or order behavior changes
