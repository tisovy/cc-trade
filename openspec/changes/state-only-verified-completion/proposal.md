## Why

The audit's last section is about the record rather than the code, and the
record is what the next change is planned from.

- **Eight archived changes are marked "Operator confirms" beside text saying the
  live check was not performed** — for example
  `openspec/changes/archive/2026-08-10-deepen-spot-chart-history/tasks.md:35`,
  `.../2026-08-10-deepen-futures-chart-history/tasks.md:35`,
  `.../2026-08-10-adjust-isolated-position-margin/tasks.md:69`. `AGENTS.md`
  permits archiving only after the operator confirms on live data, so these are
  completion marks for work that was not verified.
- **The suite is not reproducible.** `npm test` on the documented Node 26 fails
  with 78 errors from a global `localStorage` collision, and the repository
  pins nothing: no `engines`, no `.nvmrc`, no `.node-version`. Whether the
  suite passes depends on which Node the operator happens to run.
- **The guards are not part of the ordinary run.** `check:runtime-mock`,
  `check:futures-production` and `check:command-path` are separate scripts that
  neither `npm test` nor `npm run build` invokes, and the runtime-mock source
  guard does not scan `electron/preload.cjs`
  (`scripts/check-runtime-mock-layer.mjs:19`) — the one file that bridges the
  mock layer into the renderer.
- **Two capability specs have `TBD` purposes** —
  `openspec/specs/spot-chart-history/spec.md:1` and
  `openspec/specs/futures-contract-leverage/spec.md:1`.

## What Changes

- A completion mark states only what was actually done: the unverified operator
  confirmations are reopened as outstanding live verification, carried in one
  place rather than silently inside archived changes.
- The Node version the suite requires is declared and enforced, so a passing run
  is reproducible.
- The production guards run as part of the ordinary verification command, and
  the runtime-mock guard covers the preload bridge.
- The two `TBD` purposes are written.

## Impact

- `package.json` (engines, verification script), `.nvmrc`,
  `scripts/check-runtime-mock-layer.mjs`, `openspec/specs/*/spec.md` purposes,
  and a live-verification ledger under `openspec/`.
- No runtime behaviour changes; what changes is what the repository claims and
  what it checks.
- Adds the `project-verification` capability requirements about completion
  marks and reproducible checks.
