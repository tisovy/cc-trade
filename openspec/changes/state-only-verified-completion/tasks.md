## 1. A Completion Mark States Only What Was Done

- [x] 1.1 Identify and record the exact archived task set whose checked operator confirmation contradicts its own statement that the live check was left for later; record the count, paths, and task ids.
  - Measured 2026-08-13: **10 task marks in 8 archived changes** — `adjust-isolated-position-margin` 11.1, 11.2, 11.3; `deepen-futures-chart-history` 6.4; `deepen-spot-chart-history` 5.4; `keep-position-value-live` 5.6; `price-the-exit-and-the-liquidation` 5.5; `read-the-desk-at-a-glance` 9.4; `review-the-account-not-the-contract` 5.4; `state-and-set-the-leverage` 4.6.
- [x] 1.2 Create one live-verification ledger under `openspec/` with change, unverified behaviour, reason, recorded date, and subsequent status for every item.
  - Added `openspec/live-verification-ledger.md` on 2026-08-13 with 10 `OUTSTANDING` rows; no later full live confirmation for those behaviours was found in the consolidated runbook.
- [x] 1.3 Change only those false archived marks to unchecked and add a dated reference to the ledger beside each one.
  - Corrected exactly the 10 task ids recorded in 1.1; every note links to the ledger and is dated 2026-08-13.
- [x] 1.4 Verify that none of the affected changes was reopened, moved, or re-archived; their implementation remains shipped and only the verification claim changes.
  - Verified 2026-08-13: all 8 directories remain under `openspec/changes/archive/`; `git diff --name-status` reports only in-place `M` entries for their `tasks.md` files.

## 2. A Passing Suite Is Reproducible

*The deterministic Vitest storage contract belongs to archived change
`2026-08-12-stabilize-vitest-web-storage`; this change does not reimplement it.*

- [x] 2.1 Previously completed by commit `ef05d9e`: `package.json.engines.node` and the README already declare `^20.19.0 || >=22.12.0`. Verified in the current tree on 2026-08-13; this change retains the range and claims no implementation credit for it.
- [x] 2.2 Run the current repository checks with every supported Node version installed locally (`v24.11.0` and `v26.4.0`), record both outcomes, and only then add `.nvmrc` with one exact passing version; do not narrow `engines` without measured evidence.
  - `v24.11.0`: the first aggregate run reached 1729/1730 before `App.futures-stress.test.jsx` timed out waiting for the lazy workspace; that test then passed 1/1 alone, and the repeated full `test:all` passed 107 files and 1730/1730 tests, lint, build, circular-import (254 files), runtime-mock (132 modules), Futures production (23 files), and command-path (114 modules / one builder).
  - `v26.4.0`: the independent full `test:all` passed 107 files and 1730/1730 tests with the same lint, build, and guard results.
  - Selected `.nvmrc` `24.11.0` only after both successful runs; `package.json.engines.node` remains `^20.19.0 || >=22.12.0` unchanged.

## 3. The Guards Run With The Tests

- [x] 3.1 Previously completed by commit `ef05d9e`: documented `test:all` already runs Vitest, lint, build, the circular-import check, and `check:runtime-mock`, `check:futures-production`, and `check:command-path`. Verified in `package.json`, README, and `docs/tests.md` on 2026-08-13; no command rewrite belongs to this change.
- [x] 3.2 Extend the production runtime-mock source guard so `electron/preload.cjs` is an explicit checked entry point.
  - Measured 2026-08-13: the clean production graph grew from 132 to 133 modules after adding the preload entry point; CommonJS `require(...)` edges are now traversed as well as ESM imports.
- [x] 3.3 Add retained regression coverage after the production change, and prove it bites by running the changed test in a `git archive <ref>` copy of the pre-fix code with the shared `node_modules` symlink; record the ref and expected failure.
  - Fixed tree on 2026-08-13: `scripts/check-runtime-mock-layer.test.mjs` passed 10/10. Biting copy: `git archive f205709`, shared `node_modules` symlink, changed test only; expected result was 1 failed / 9 passed because the old graph contained only `electron/main.js` and `src/main.jsx`, omitting both preload modules.

## 4. The Specs Say What They Are For

- [x] 4.1 Replace the `spot-chart-history` `TBD` with a substantive description of persisted and paged Spot candle history.
- [x] 4.2 Replace the `futures-contract-leverage` `TBD` with a substantive description of exchange-owned per-contract leverage and margin-mode state.

## 5. Verification

- [x] 5.1 Stage only this change, materialize that staged tree with `git write-tree` plus `git archive`, and run `npm run test:all` there with the exact Node binary named by `.nvmrc`; record the Node version, Vitest file/test counts, build result, and every guard result.
  - Staged tree `0dc6a181725a5fdc398dceb7b62a0554acfee5a5`, archived to `/tmp/state-only-staged.nXGSJf` with a shared `node_modules` symlink; `.nvmrc` selected the matching `v24.11.0` binary.
  - `npm run test:all` passed on 2026-08-13: Vitest 107 files / 1737 tests; lint clean; build passed (546 renderer, 297 Electron main, 5 preload modules) and the Electron artifact boundary passed for 2 files.
  - Guards passed: circular imports (254 source files), runtime mock (132 production modules, floor 100), Futures production (23 isolated implementation files), and renderer command path (114 modules, one builder).
- [x] 5.2 Re-run strict OpenSpec validation, audit the owned diff and staged archive, run `git diff --check`, and run GitNexus change detection on the staged scope before committing directly to `master`.
  - Verified 2026-08-13: strict OpenSpec validation passed; the owned and cached diffs contain exactly 18 intended files and pass `git diff --check`; the staged archive passed 5.1; GitNexus staged detection reported 43 changed symbols, 0 affected processes, and `low` risk.
