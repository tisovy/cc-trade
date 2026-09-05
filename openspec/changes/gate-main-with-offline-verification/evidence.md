# CI implementation and self-review — 2026-09-05

## Scope and decisions

Base revision: `db6aed2a5e65942421ded2b69357858e79cdf6da`, primary checkout
`/home/me/work/trade_ui_latest`, branch `main`. This is local preparation for A06,
not a hosted-run result. No push, remote dispatch/settings change, release upload,
application launch, account operation or new registry audit was performed.

- Reuse the existing aggregate and real package hook. No runtime source or
  existing tests/gates were changed. No new browser driver or live probe.
- Use the existing measured `.nvmrc` (`24.11.0`) with Ubuntu 24.04 hosted CI.
  Node/npm are logged; host-runtime upgrades and OS matrices are separate work.
- Restrict authority to read-only checkout, no persisted credentials/cache,
  empty known account/analytics inputs, no signing or publication.
- Declare `js-yaml` 4.3.2 directly for parsed workflow contract tests. Comparing
  the entire lockfile with the base shows only the root dev-dependency declaration
  changed; every resolved package node/version/integrity is unchanged.

## External configuration sources

Public primary documentation was checked on 2026-09-05; no project contents were
sent to those sites. Action revisions come from their official release commits:

- [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1):
  [`3d3c42e5aac5ba805825da76410c181273ba90b1`](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1).
- [setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0):
  [`820762786026740c76f36085b0efc47a31fe5020`](https://github.com/actions/setup-node/commit/820762786026740c76f36085b0efc47a31fe5020).
- Both selected action manifests use Node 24 and support the configured inputs:
  [checkout manifest](https://raw.githubusercontent.com/actions/checkout/v7.0.1/action.yml),
  [setup-node manifest](https://raw.githubusercontent.com/actions/setup-node/v7.0.0/action.yml).
- [GitHub security guidance](https://docs.github.com/en/actions/reference/security/secure-use)
  supports full-SHA action pinning and least authority.
- [npm ci documentation](https://docs.npmjs.com/cli/v11/commands/npm-ci/)
  describes frozen install validation and dry-run behavior.

## Performed checks

Host: Linux x64 (kernel `6.18.39-1-lts`), Node `24.11.0`, npm `11.6.1` for the
aggregate/package runs. The local host is not an Ubuntu GitHub runner.

- Strict OpenSpec validation passed before implementation and again afterward;
  all 23 existing main specs also passed strict validation.
- Focused workflow, launch and real-ASAR fixture tests: **3 files / 56 tests**
  passed on local Node `26.4.0`. The workflow adds **9** parsed-YAML cases after
  its implementation, following production-first order.
- Full `npm run test:all`: **148 files / 3,537 tests**, lint, production
  renderer/main/preload build and all retained gates passed, exit 0.
  Local baseline: 7 locked copies; cycle check: 324 files; mock-free runtime:
  165 modules; Futures boundary: 24 files; command paths: 131 modules.
- `npm ci --dry-run --offline --ignore-scripts --no-audit --no-fund
  --logs-dir=/tmp/ci-a06-npm-logs`: exit 0 under Node 24/npm 11. This checks install
  planning/lock compatibility, **not** a fresh install or execution of install
  scripts on a clean hosted runner. The working installed tree was not replaced.
- Real package command: `npm run dist -- --linux --x64 --dir --publish never
  --config.directories.output=release/ci-a06-2026-09-05`, with the workflow's
  known account/analytics inputs cleared and signing discovery disabled.
  The output override preserves the pre-existing `release/linux-unpacked` and
  previous audit packages; the CI command uses the ordinary output on a fresh runner.
- Electron-builder `26.15.3`, Electron `43.6.0`: package hook passed for
  **2,062 files / 10 renderer build files**, including the full build inventory.
  No application was executed.
- Post-package full Vitest on Node 24.11.0: **148 files / 3,537 tests** passed
  again, exit 0, after the packager's native rebuild.

Local diagnostic logs (not CI artifacts): `/tmp/ci-a06-node24-gates.log`
(interrupted sandbox attempt), `/tmp/ci-a06-node24-gates-approved.log`,
`/tmp/ci-a06-install-dry-run.log`, `/tmp/ci-a06-package.log` and
`/tmp/ci-a06-post-package-tests.log`.

Package: `release/ci-a06-2026-09-05/linux-unpacked/resources/app.asar`.
SHA-256: `8254cd218d867dde6c254b0d01887820cd7db96d6876733ef2c7a250045ec348`.
It matches the previous self-audit ASAR byte-for-byte; the direct dev dependency
and CI files do not change the production package.

Manifest SHA-256: `79453d94edb6861118b6dad2801c0fd89678201fe707077c1efbb4e0a1a605ec`.
Lockfile SHA-256: `4050c95eafbd12faf3b568f2461fe05c4b002fd0d44cbdd3e0c79c2924579b00`.
These are new manifest/lock hashes, not a new npm audit result.

## Environment failures and limitations

The initial sandboxed aggregate run was interrupted (exit 130) after child-process
and loopback fixture failures. A minimal `listen(0, '127.0.0.1')` reproduced
`EPERM`. GitNexus/source review confirmed the pool tests' local HTTP listener and
fatal-runtime tests' child-process fixture. The full rerun was explicitly allowed
outside those sandbox restrictions and passed without changing tests or runtime.
No failing test was skipped or weakened to obtain a passing result.

Known nonfatal DOM `TimeoutNaNWarning`, Babel large-test warning, legacy ESLint
environment warning and package-description warning remain visible. No claim is
made about all runtime warnings or global program safety.

## GitNexus review boundary

Bound repository: `trade_ui_latest`, primary checkout above; index refreshed at
base `db6aed2` (13,305 nodes / 21,021 edges / 300 flows). The old `cc-trade` label
in AGENTS is not the actual registry binding. Installed GitNexus v1.5.3 is used
via the local MCP SDK; unsupported index-only/PDG/CLI detection flags are not used.

Pre-edit impact on package checks, package manifest and testing docs returned
empty LOW results. These were treated as unresolved: source/text review identified
`dist → electron-builder → afterPack → checkPackagedApp → assertPackagedApp`,
the CLI entry, and real-ASAR fixture tests. Those implementations stay unchanged.
README adds guidance only; existing documentation links are retained.
The status report has one direct documentation reference (LOW). Ledger's deeper
walk returned partial MEDIUM due to an old read-only adapter error; a depth-1
rerun completed (10 direct document references, zero processes). Only a new dated
ledger section is appended; no historical evidence or anchors are changed.

Graph limitations include a per-file node cap, omitted large test file, unresolved
dynamic callbacks and non-exhaustive process resources. GitHub scheduling, YAML
semantics and npm script hooks are reviewed with parsed configuration, exact-path
source checks and actual commands, not inferred from graph zeros.

The refreshed working-tree index has 13,355 nodes / 21,080 edges / 300 flows.
Pre-commit `detect_changes(scope=all)` and `scope=compare, base_ref=main` each
report 103 changed nodes, 15 changed files, zero affected processes, LOW, with
neither partial nor truncated reported. These results do not fully represent
YAML/lockfile semantics. The old filename matcher also lists `docs/README.md` and
`archive/futures-testnet/README.md` for the root README change; exact Git paths
confirm neither was edited. All 15 staged paths are this change's configuration,
new test, dependency declaration or documentation; application source and main
specs have zero diff. User-owned untracked skills/audits are excluded.

## Remaining acceptance

Task 3.1 stays unchecked. Record the actual GitHub run/commit and operator
acceptance after an authorized push; record branch enforcement separately.
The main-only policy is unchanged. No archive or main-spec synchronization is
claimed for this new, not-yet-hosted-accepted change.
