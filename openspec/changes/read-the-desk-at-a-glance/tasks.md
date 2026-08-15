## 1. Safety and Scope

- [ ] 1.1 Reconfirm the primary checkout is on `master`, preserve unrelated working-tree changes, and repeat/report upstream GitNexus impact analysis for every existing symbol immediately before editing it.

## 2. Production Implementation

- [ ] 2.1 Add the active-workspace local clock and its centered, fixed-width shell styling, including once-per-second refresh and unmount cleanup.
- [ ] 2.2 Wire workstation symbol selection into the compact Futures trading ticket, turn each open-order symbol into an isolated accessible control, and rebalance the row tracks so `0.000123` remains visible with the other columns and action.
- [ ] 2.3 Raise the shared Futures recent-symbol invariant from eight to nine without changing the storage key, ordering, favorites, or three-column pill layout.
- [ ] 2.4 Replace order-history contract-quantity fill text with reported-or-derived executed USDT presentation, exact secondary detail, and an aligned USDT-labelled history column.

## 3. Regression Coverage After Production Code

- [ ] 3.1 Add shell coverage for exact English local-clock formatting, second/day updates from host time, active-workspace visibility, and timer cleanup.
- [ ] 3.2 Add trading-ticket and workstation coverage for pointer/keyboard symbol selection without edit propagation and for the minimum-width small-price layout contract.
- [ ] 3.3 Update symbol-history coverage to prove nine-entry read/write/restore behavior and least-recent eviction on a tenth selection.
- [ ] 3.4 Add order-history coverage for exchange-reported, fallback-derived, and unavailable Filled USDT readings, including exact contract quantities in secondary detail.

## 4. Automated Verification and Integration

- [ ] 4.1 Run the focused React and utility tests for every touched production area, then run the repository's relevant lint/build or broader UI verification commands.
- [ ] 4.2 Run `OPENSPEC_TELEMETRY=0 openspec validate read-the-desk-at-a-glance` and keep every completed checkbox synchronized with the implementation.
- [ ] 4.3 Run GitNexus `detect_changes` against `master`, review the affected symbols and execution flows, and confirm no unrelated working-tree file is included.
- [ ] 4.4 Stage only this change's artifacts and implementation files and commit them directly to `master` without including pre-existing user changes.

## 5. Operator Verification

- [ ] 5.1 Operator confirms on live data that the clock placement, order-symbol switching, small-price readability, ninth recent symbol, and Filled USDT history match the requested desktop workflow; archive only after this confirmation.
