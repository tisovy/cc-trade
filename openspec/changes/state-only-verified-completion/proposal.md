## Why

The audit's last section is about the record rather than the code, and the
record is what the next change is planned from.

- **Ten archived task marks across eight changes claim operator confirmation
  beside text saying the live check was left for later.** The count is ten, not
  eight, because `adjust-isolated-position-margin` contains three separate
  operator checks. The other affected changes are
  `deepen-futures-chart-history`, `deepen-spot-chart-history`,
  `keep-position-value-live`, `price-the-exit-and-the-liquidation`,
  `read-the-desk-at-a-glance`, `review-the-account-not-the-contract`, and
  `state-and-set-the-leverage`. There is no single ledger that keeps these live
  checks visible after their implementation changes were archived.
- **Runtime reproducibility is only partly recorded.** Earlier commit
  `ef05d9e` already aligned `package.json` and the README on Node.js
  `^20.19.0 || >=22.12.0`, and the archived
  `2026-08-12-stabilize-vitest-web-storage` change made Vitest storage
  deterministic and exercised the then-installed Node.js versions. The
  repository still has no `.nvmrc`, so it does not select one exact verified
  runtime for the ordinary repository workflow.
- **The aggregate verification command already exists, but one guard boundary
  is incomplete.** Earlier commit `ef05d9e` made `test:all` run Vitest, lint,
  the build, the circular-import check, and all three production guards, and
  documented the command. `scripts/check-runtime-mock-layer.mjs` still begins
  its source walk only at `electron/main.js` and `src/main.jsx`, leaving
  `electron/preload.cjs` outside the directly checked production entry points.
- **Two capability specs have `TBD` purposes** —
  `openspec/specs/spot-chart-history/spec.md` and
  `openspec/specs/futures-contract-leverage/spec.md`.

## What Changes

- Record the ten unverified behaviours in one dated live-verification ledger,
  and correct only their false archived checkmarks without reopening or moving
  the archived changes.
- Retain the existing Node support range and aggregate command as prior work.
  Re-run the repository verification on every supported Node version currently
  installed, then add `.nvmrc` with one exact version that actually passed.
- Add the preload bridge to the runtime-mock guard's production boundary and
  retain a regression that proves a preload violation fails the guard.
- Replace both `TBD` purposes with capability descriptions.

## Impact

- Historical task metadata in eight archived changes, one live-verification
  ledger under `openspec/`, `.nvmrc`, the runtime-mock guard and its focused
  regression, and two capability-spec Purpose sections.
- `package.json.engines` and `test:all` are verified as inherited work and are
  not rewritten merely to create a diff.
- No application runtime behaviour changes; this change corrects claims,
  selects a verified development runtime, and tightens static verification.
- Adds `project-verification` requirements for truthful completion records,
  reproducible checks, complete guard coverage, and meaningful spec purposes.
