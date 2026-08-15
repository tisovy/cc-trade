## 1. Impact and Regression Contract

- [x] 1.1 Run upstream GitNexus impact analysis for `FuturesWorkstationView` and `FuturesPortfolioDock`, report their callers, affected processes, and risk before changing the shared presentation rules.
- [x] 1.2 Add focused stylesheet-contract tests that fail unless the desktop rail uses zero-minimum 65/35 tracks and only the aggregate tape plus portfolio tables receive the complete compact-scrollbar treatment.

## 2. Workstation Presentation

- [x] 2.1 Replace the desktop order-book/tape track pair with `minmax(0, 65fr)` and `minmax(0, 35fr)` while leaving the mobile stack and total workspace height unchanged.
- [x] 2.2 Theme the aggregate-trade and portfolio-table scroll owners with 6px axes, transparent track/corner, rounded visible and hover-emphasized thumbs, suppressed native buttons, and standards-based fallback properties without changing overflow behavior.

## 3. Verification and Immediate Audit

- [x] 3.1 Run the focused Futures workstation and portfolio-dock Vitest suites, then run lint and the production build.
- [x] 3.2 Inspect representative 1920×1080 and 1366×768 Chromium/Electron layouts, confirming the computed 65/35 panel ratio, compact vertical and horizontal chrome, preserved scrolling, and no panel overlap.
- [x] 3.3 Run GitNexus `detect_changes` against `master`, review the complete diff for unexpected symbols or execution flows, and report audit findings separately from pre-existing working-tree changes.
- [x] 3.4 Leave the validated change unarchived until the operator confirms the presentation on live market data.
