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
- [x] 1.6 PnL column values bold (operator, 2026-08-23 evening).
- [x] 1.7 The settled-income status banner is out of the panel: a failed
  wallet-adjustment refresh is announced once per failure episode in the
  popup (toast) channel, the rows keep the confirmed reading qualified on
  their elements, and the one ↻ control also retries the failed reading
  (the popup says so). Loading/ready/idle states say nothing anywhere.

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
- [x] 2a.3 Taken after all (2026-08-23 evening, on the operator's report "8
  last deals where Binance shows all"): the fold proves a chain's left
  boundary backward from the terminal the account snapshot vouches. A trial
  fold that assumes the chain began flat is adopted only when it conserves
  every fill, reads no round as continuing something older (no partial
  rounds, every round from flat — an opening fill realizing PnL disproves
  the premise on its own), and its terminal lands exactly on the delivered
  account position (absence from a complete snapshot = flat). The sum of
  held fills equals the present position only when the base was zero, so
  the adoption is arithmetic, not faith. Gated on the positions resource
  being delivered (`ready`/`stale`), default-off in the fold's API
  (`snapshotComplete`). Bite-tested at the fold and at the hook seam.
- [ ] 2a.4 Not taken: a store-version bump that migrates contract names
  instead of deleting the store. Matters only at the next re-key.

## 3. Verification

- [x] 3.1 Suites: FuturesHistoryPanel (43), FuturesPortfolioDock (69),
  futuresHeldHistory (+basis-read test), useFuturesTrading (+reconcile-symbol
  test) — green; the one red in the tree is a peer session's in-flight
  shared-adjustments formatting test, recorded in the ledger.
- [x] 3.2 Operator, 2026-08-23 evening: the one control works and the single
  bold-ready PnL column reads as expected. The press left 8 closed rounds on
  screen — the fold's honestly-suppressed left-boundary chains — which is
  what turned task 2a.3 from recorded to implemented.
- [x] 3.3 Second wave suites: futuresTradeRounds 86 (4 anchor tests, the two
  positive ones red against the pre-fix fold), useFuturesTrading 81 (anchor
  wiring test red against the pre-fix hook), FuturesPortfolioDock 72
  (↻-retries-settled test), FuturesHistoryPanel 42 (settled-popup rewrite);
  full suite 2866/2866 in an isolated worktree before landing on the live
  desk, and the four suites re-run green on the landed tree.
- [ ] 3.4 Operator: Closed Positions now lists every closed position the
  Binance app lists over the desk's read window (the anchored chains
  resolve as soon as the account snapshot is on screen — no press needed).
