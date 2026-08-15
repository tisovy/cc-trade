## Why

Two workstation surfaces still fall back to bright native Chromium scrollbars,
and the chart toolbar becomes horizontally scrollable because four descriptive
labels consume more width than the chart column provides. Both problems add
visual noise to an otherwise dense trading surface and hide controls at the
window size operators actually use.

## What Changes

- Reuse the existing six-pixel workstation scrollbar treatment for every
  deliberate local scroll owner in the instrument rail, execution-ticket body,
  aggregate-trade tape, and portfolio tables.
- Replace the four display-only chart-tool labels with compact inline SVG icons
  while retaining complete accessible names, native titles, pressed state, and
  disabled state.
- Remove horizontal scrolling from the supported desktop chart toolbar and keep
  its interval and drawing/alert groups visible in one row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-workstation-presentation`: Define the execution-ticket body as a
  bounded local scroll owner, extend the compact scrollbar contract to all
  deliberate workstation scroll owners, and require a non-scrolling compact
  chart toolbar at supported desktop widths.

## Impact

- Futures workstation toolbar markup and accessible presentation.
- Futures workstation CSS for toolbar sizing and scrollbar chrome.
- Focused workstation and portfolio presentation tests. No chart-data,
  execution, account, persistence, Electron, or exchange protocol changes.
