## Why

Two reachability defects from the audit: one that hides a panel, one that makes
an action mouse-only.

- **The narrow layout drops the portfolio dock.** The desktop grid template
  places the dock, but the `max-width: 760px` template in
  `src/components/features/futures/FuturesWorkstation.css:967` has no area for
  it, so positions and orders disappear entirely on a narrow window. The range
  just above the breakpoint — roughly 761–797 px — is already narrower than the
  minimum widths of the desktop columns while still using the desktop template.
- **An order can be cancelled from the keyboard but not edited.** The order row
  is a `div` with `role="row"` and an `onClick`
  (`src/components/features/futures/FuturesPortfolioDock.jsx:285`) with no
  `tabIndex` and no key handler; the ticket and the chart open the same editor
  on double-click. A keyboard operator can cancel an order but cannot reprice
  it.

## What Changes

- The narrow template keeps the portfolio dock, and the desktop template stops
  applying below the width its columns require.
- Rows that open an editor are focusable and operable with Enter and Space, and
  say what they do.

## Impact

- `src/components/features/futures/FuturesWorkstation.css`,
  `FuturesPortfolioDock.jsx`, and the editor-opening rows in
  `FuturesTradingTicket.jsx`.
- Adds requirements to `futures-workstation-presentation`.
- Layout is measured in Chromium, not jsdom.
