## 0. Pre-implementation gate

- [x] 0.1 Verify `main`, preserve the existing dirty worktree, run `openspec status` and `openspec instructions apply` for this change, re-read every artifact, and pass strict OpenSpec validation before production edits.
- [x] 0.2 Run upstream GitNexus impact analysis for every existing interval-list, validator, transport, history-cache, container/view, and session symbol that will be edited; report direct callers, affected processes, and risk before changing each symbol.

## 1. Production implementation

- [x] 1.1 Append `1w` after `1d` in the shared ordered Futures interval list so the existing toolbar and keyboard picker expose the same explicit selection; adjust only the interval-group presentation if the seventh control otherwise becomes hidden or scrollable at the supported narrow width.
- [x] 1.2 Extend the existing main-process market-contract, production-transport, and deterministic-transport interval allowlists so `1w` reaches the normal Binance candle stream, bootstrap, interval replacement, and history paths while unsupported values remain rejected.
- [x] 1.3 Add the fixed `604_800_000` millisecond weekly duration to Futures candle-history continuity/cache handling, keeping the existing per-symbol/per-interval key, page bounds, ownership guards, and `15m` default unchanged.

## 2. Proof after implementation

- [x] 2.1 After production code is complete, add protocol, market-contract, production-transport, and deterministic service regressions proving `1w` is accepted and forwarded as the normal weekly interval while an unsupported interval is still refused before network work.
- [x] 2.2 Add renderer regressions proving `1w` appears immediately after `1d`, remains usable in the supported compact toolbar, can be chosen by button and keyboard picker, and sends the ordinary typed interval-selection action without changing the default.
- [x] 2.3 Add hook/service regressions proving a switch to `1w` owns a fresh weekly candle/history series and ignores a late answer from the abandoned interval.
- [x] 2.4 Add history-cache regressions proving consecutive `1w` candles are exactly `604_800_000` milliseconds apart, reuse the `symbol:1w` run, and do not bridge a gap or mix another interval.
- [x] 2.5 Run the focused protocol, cache, view, production-container, hook, market-contract, transport, and workstation-service test files; then run `npm run lint`, `npm run build`, `npm run check:futures-production`, `npm run check:command-path`, and `npm run check:circular` without launching UI, Electron, Chromium, or a dev server.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `add-futures-weekly-interval` after implementation.
- [x] 3.2 Stage only this change's production, test, and OpenSpec files; run GitNexus `detect_changes` with `staged` scope and confirm only the expected interval selection, validation, transport, and history flows are affected.
- [x] 3.3 Commit the completed implementation directly to `main`, preserving unrelated worktree changes.
- [x] 3.4 Leave the change active and unarchived; report that operator confirmation of live weekly candles and weekly history remains the archive gate.
