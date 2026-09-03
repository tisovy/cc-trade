## Why

The interval-switch spinner states that replacement candles are loading, but
the fully bright chart behind it still looks current. A temporary dark veil
will make the held-series state apparent without hiding the chart.

## What Changes

- Darken the chart with a translucent dark-grey veil while an interval
  replacement is pending.
- Keep the retained candles and progress spinner visible through the veil.
- Keep the veil pointer-through and remove it with the existing switching
  state, so chart gestures remain available and no other chart state is dimmed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: the interval-switch presentation gains a
  temporary dark veil over the held chart.

## Impact

- Presentation CSS for the Futures chart interval progress layer.
- Focused presentation tests and the existing interval-switch OpenSpec
  requirement.
- No protocol, exchange, persistence, or dependency changes.
