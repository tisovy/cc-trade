## Context

See [proposal.md](proposal.md). `origin` points to GitHub; development stays on
`main`. `test:all` already owns the non-browser safety gates, and `dist` performs
a fresh production build followed by electron-builder's ASAR inspection hook.
There is no existing hosted workflow in the checkout.

## Goals / Non-Goals

Provide one stable `Linux verification` result and reuse the local gates without
duplicating their lists. Do not launch Electron, add a browser harness, exercise
live trading, publish packages, or claim pre-push protection for direct commits.

## Decisions

1. Use GitHub-hosted `ubuntu-24.04` and the exact Node 24 version in `.nvmrc`,
   matching the existing measured repository runtime contract. A single Linux
   x64 job bounds CI cost; a full OS/Node matrix is deferred. Node/npm versions
   are logged. Updating the repository runtime remains a separately measured
   change, not an unreviewed moving CI version.
2. Trigger on every push to `main` without path filters, and allow manual reruns
   only on `main`. Keep a stable job name. Cancel superseded runs per workflow/ref;
   a cancelled run is not acceptance of that commit. No PR/branch workflow is
   introduced under the repository's main-only policy.
3. Install with `npm ci --no-audit --no-fund`, then `npm run test:all`, then
   `npm run dist -- --linux --x64 --dir --publish never`. Do not disable install
   scripts: Electron/native dependency installation requires them. The additional
   build from `predist` ensures that packaging never uses stale build products.
4. Use only official checkout/setup-node actions pinned to verified full commit
   SHAs. Set `contents: read`, disable credential persistence and dependency
   caching, omit secrets/environments, explicitly clear known account/analytics
   variables, disable signing discovery and keep the normal production build.
   No cache or artifact upload avoids extra stored copies of dependencies/packages.
5. Parse YAML in retained Vitest contract tests using a direct dev dependency on
   the already locked `js-yaml` version. This avoids a home-grown YAML parser and
   an undeclared transitive import; no new dependency versions are introduced.

## Risks / Trade-offs

- Hosted Actions permissions, billing, runner availability and repository rules
  are external state → record the first actual run and commit before closure.
- The job needs internet for public dependencies/tools → no claim of network
  isolation; no explicit automatic npm registry audit is introduced.
- Repository/install code executes on the runner → use an ephemeral hosted runner
  with no account secrets, read-only token and immutable external actions.
- Static workflow tests do not emulate GitHub → retain manual remote acceptance.
- A green job proves automated contracts/package contents, not a running window
  or exchange behavior → keep operator acceptance separate.
- Required status rules can conflict with direct-to-main development → do not
  silently introduce PR-only rules, bypasses or change repository settings.

## Migration Plan

Commit locally after validation. After separately authorized push, inspect the
actual `CI / Linux verification` run, commit SHA, gate and ASAR logs. Record owner
acceptance and an explicit enforcement decision compatible with main-only work.
Only then sync/archive under the normal OpenSpec acceptance rules. Roll back by
reverting the CI change; do not bypass failed gates or alter trading behavior.
