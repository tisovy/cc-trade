## Why

Audit item A06 remains open: local tests, build and package contracts exist, but
the repository has no checked-in CI workflow to run them when `main` changes.
Regressions should produce a visible automated result without an operator's
trading account or a launched application.

## What Changes

- Add a GitHub Actions workflow for pushes to `main` and manual runs on `main`.
- Run the retained aggregate checks and build a Linux x64 directory package,
  including the existing full-renderer ASAR hook, without publishing or launching.
- Limit the job to a hosted runner, read-only repository permission, immutable
  action revisions, no persisted checkout credentials and no trading secrets.
- Retain parsed workflow contract tests and document local reproduction, remote
  acceptance and the distinction between CI reporting and branch enforcement.

## Capabilities

### New Capabilities

- `continuous-verification`: automatic account-free verification of `main` and
  truthful reporting of local versus hosted evidence.

### Modified Capabilities

None. Existing trading, build and packaging contracts are reused unchanged.

## Impact

New `.github/workflows/ci.yml`, workflow contract tests, a direct development-only
YAML parser declaration reusing the already locked package, and documentation.
No application runtime changes. Dependency/tool downloads are allowed in CI;
"offline verification" means no live market/account session, not an air gap.
No automatic registry audit, artifact upload, deployment, signing, push, remote
settings changes or feature branches. A06 and this change remain open until an
actual hosted run and operator acceptance are recorded.
