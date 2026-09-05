## Why

The 2026-09-04 audit reproduced two independently bounded P1 defects (F03 and
F04): an abandoned Spot cache read can replace the current chart/subscription,
and electron-builder's default output directory excludes the renderer build
from the packaged application. This first audit-fix batch closes those two
paths without changing order submission or the exchange transport.

## What Changes

- Give each Spot chart selection a generation; obsolete cache completions may
  not change the chart, loading state, or detail subscription. Failed cache
  reads fall back to the current live subscription.
- Clear the previous chart on selection change, and invalidate outstanding
  cache work when Spot is disabled or its provider is unmounted.
- Separate installer output from Vite output and allow only built runtime
  files into the application, alongside required production dependencies.
- Verify the real packager file selection and the resulting ASAR contents
  without introducing a browser-driving test framework.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spot-chart-history`: only the current selection may commit cached history
  or acquire the detail subscription.
- `project-verification`: the normal distribution contains the built UI and
  excludes repository-only files and secret configuration.

## Impact

`src/context/DataContext.jsx`, packaging configuration, verification scripts,
their tests, and packaging instructions. No exchange API, credential schema,
dependency version, or Futures behaviour changes. F01, F02, F05 and the P2/
architecture findings remain separate work. Existing candle-store changes are
out of scope. Live confirmation remains an operator gate before archive.
