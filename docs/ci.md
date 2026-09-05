# Continuous verification

[CI](../.github/workflows/ci.yml) has one stable job, `Linux verification`, on a
GitHub-hosted Ubuntu 24.04 x64 runner. Pushes to `main` and manual runs on `main`
trigger it; there are no path filters or new development branches. A newer run
for the same workflow/ref cancels the superseded one. Cancelled/skipped runs are
not evidence that the revision passed.

The job selects the exact Node version from [`.nvmrc`](../.nvmrc), logs Node/npm
versions, and runs:

```sh
npm ci --no-audit --no-fund
npm run test:all
npm run dist -- --linux --x64 --dir --publish never
```

`test:all` owns the tests, lint, normal production build, dependency-version
floors and architecture guards. Packaging performs another clean production
build, then the existing `afterPack` hook reads the actual ASAR and checks the
complete renderer build inventory, including lazy chunks. A failed command
fails the job; there is no allowed-failure or failure-swallowing step.

## Authority and data boundary

The workflow uses only official checkout/setup-node actions pinned to full
commit SHAs, `contents: read`, no persisted checkout credentials and no cache.
SHA pinning follows [GitHub's action security guidance](https://docs.github.com/en/actions/reference/security/secure-use).
It does not reference repository/environment secrets or upload artifacts.
Known trading and analytics inputs are explicitly empty, signing discovery is
disabled, and no command launches Electron or a trading session. The normal
production build is inspected; CI does not replace it with a safe-dev build.

This is account-free verification, not network isolation. Public dependency,
Node, Electron and build-tool downloads still occur. Install scripts run on the
ephemeral runner, so dependency code is part of the supply-chain boundary. Do not
move this job onto an operator's machine or give it trading/signing credentials.
`--no-audit` avoids an automatic npm audit metadata submission; the local security
floor check is not a fresh vulnerability scan.

## Local reproduction

Use the version in `.nvmrc` and a development environment without private `.env`
files, account/analytics variables or signing credentials. `npm ci` replaces the
local installed dependency tree; do not run it against a live operator install.
Run the three commands above. They rebuild generated `dist/`, `dist-electron/`
and `release/linux-unpacked/`; they do not start the application.

For an existing development install, the last two commands reproduce the gates
and package check but do not prove a fresh locked install. The workflow's blank
job variables do not sanitize a developer's shell or private files automatically.
No account keys are necessary for any of these verification commands.

## Hosted acceptance and branch policy

Checked-in configuration and passing local commands are not proof that GitHub
ran the workflow or enforces it. After a separately authorized push:

1. Confirm Actions is enabled and the configured runner/actions are permitted.
2. Record the run URL, full commit SHA, Node/npm versions and the successful
   `Linux verification` result, including the actual ASAR hook output.
3. Treat failed/cancelled/skipped runs as unaccepted. Fix a failing gate without
   bypasses; rerun infrastructure failures for the same revision explicitly.
4. Record owner acceptance and the chosen branch-enforcement policy separately.

With direct commits to `main`, a push-triggered check reports after the commit
has reached the remote branch; it cannot retroactively block that push. Making
a status check required is a separate repository-rules decision, not something
this YAML accomplishes. Do not silently introduce a PR-only workflow or an
administrative bypass that contradicts the main-only policy.

This job verifies Linux x64 package contents, not Windows/macOS installers,
signatures, live UI behavior or exchange responses. It publishes no release.
The [OpenSpec change](../openspec/changes/gate-main-with-offline-verification/tasks.md)
stays active until hosted evidence and owner acceptance are recorded. Its current
checkpoint is also in the [verification ledger](../openspec/live-verification-ledger.md).
