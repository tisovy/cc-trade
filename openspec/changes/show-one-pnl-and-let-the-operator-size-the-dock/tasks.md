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

## 2a. The week's contracts (second wave, same day)

- [x] 2a.1 Measured offline against the operator's own store (LevelDB log +
  Snappy + SSV parsed in scratchpad): the v2 re-key **deleted** the old object
  store outright (`deleteObjectStore`, futuresHistoryStore.js:435), so the
  legacy records naming the week's contracts are unreachable by the app; the
  bounded 4-page income walk re-found only the last ~2 days (8 contracts of
  16); the fold over the v2 store yields 8 resolved closed rounds + 7 honest
  oldest-chain unresolved — the operator's "3 закрытые позиции вместо ~20".
- [x] 2a.2 A Full read's older-half income walk now takes up to 12 pages
  (`FUTURES_INCOME_MAX_PAGES_FULL`), and the fan-out cap rose 12 → 16 so the
  contracts the deep walk finds are not dropped by the slice behind it.
  Bite-tested: the ordinary read stops at four pages and says incomplete; the
  Full read reaches the early-week contract and completes.
- [ ] 2a.3 Not taken: teaching the fold to prove a chain's left boundary by
  anchoring backward from the terminal snapshot (would resolve most of the 7
  suppressed oldest chains). Recorded in the ledger for the round-fold owner.
- [ ] 2a.4 Not taken: a store-version bump that migrates contract names
  instead of deleting the store. Matters only at the next re-key.

## 3. Verification

- [x] 3.1 Suites: FuturesHistoryPanel (43), FuturesPortfolioDock (69),
  futuresHeldHistory (+basis-read test), useFuturesTrading (+reconcile-symbol
  test) — green; the one red in the tree is a peer session's in-flight
  shared-adjustments formatting test, recorded in the ledger.
- [ ] 3.2 Operator: stretch the dock on the live desk; open Closed Positions
  and confirm the account's contracts return after one re-read press (the
  control runs full discovery while the review says discovery did not finish).
