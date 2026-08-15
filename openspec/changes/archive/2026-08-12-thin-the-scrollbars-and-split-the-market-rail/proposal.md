## Why

The aggregate-trade tape and portfolio tables currently expose the browser's
wide native scrollbars, which consume scarce data width and look disconnected
from the compact dark workstation. The shared market rail also gives the tape
almost half of its height even though the order book is the denser primary
market view.

## What Changes

- Allocate 65% of the desktop market rail's shared data height to the order
  book and 35% to the aggregate-trade tape.
- Give the aggregate-trade tape and portfolio dock tables compact,
  workstation-themed vertical and horizontal scrollbars while preserving their
  scroll behavior and usable thumb contrast.
- Add focused regression coverage for the split and scrollbar styling, and
  verify the result at representative Electron viewport sizes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: define the 65/35 shared market-rail split
  and the compact visual treatment of the tape and portfolio-table scrollbars.

## Impact

- Presentation rules in
  `src/components/features/futures/FuturesWorkstation.css`.
- Focused workstation and portfolio-dock presentation tests.
- No protocol, market-data, trading-command, dependency, or persistence
  changes.
