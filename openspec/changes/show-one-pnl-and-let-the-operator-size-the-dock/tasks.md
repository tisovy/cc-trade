# Tasks

## 1. Presentation

- [x] 1.1 Dock resize handle: pointer drag, arrow keys, double-click reset,
  clamped floor/ceiling, `futuresDockPanelHeight` persisted; both panels take
  one height through `--fx-dock-panel-height`, split and stacked layouts alike.
- [x] 1.2 Header compacted: panel/header/tab paddings trimmed, refresh control
  a glyph (`futures-workstation-dock-refresh`), Full button removed.
- [x] 1.3 Closed rows: one PnL column at cents (string rounding, half away from
  zero on the third decimal; sub-cent keeps exact text; past-2^53 stays exact),
  exact figure and Wallet Net / qualified visible net on the element; NET
  column, measure label, badges and the scope banner removed; empty-state
  claim discipline retained.
- [x] 1.4 Open-position PnL cell: amounts only, Partial badge removed.
- [x] 1.5 Layout measured in headless Chromium against a fixture: both panels
  pin to the operator height, the 7-track rounds row fits its panel with no
  sideways scroll, default cap 260px stands when no height is chosen.

## 2. The account-wide read

- [x] 2.1 `basisOnly` responses no longer stamp `readViews` (regression of
  2026-08-23: one-contract basis read suppressed the tab's account-wide read).
- [x] 2.2 Reconcile gap-read names a held position when no contract is chosen,
  or waits; the journal's per-start `INVALID_TYPED_HISTORY_SYMBOL` class ends.
- [x] 2.3 Re-read control escalates to `full: true` while the held reading says
  discovery did not finish, so a review narrowed by a coverage wipe can heal
  without the removed Full button.

## 3. Verification

- [x] 3.1 Suites: FuturesHistoryPanel (43), FuturesPortfolioDock (69),
  futuresHeldHistory (+basis-read test), useFuturesTrading (+reconcile-symbol
  test) — green; the one red in the tree is a peer session's in-flight
  shared-adjustments formatting test, recorded in the ledger.
- [ ] 3.2 Operator: stretch the dock on the live desk; open Closed Positions
  and confirm the account's contracts return after one re-read press (the
  control runs full discovery while the review says discovery did not finish).
