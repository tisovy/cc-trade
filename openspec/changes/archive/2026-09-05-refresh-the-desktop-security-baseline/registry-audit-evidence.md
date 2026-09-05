# Registry audit completion — 2026-09-05

## Authorization and scope

The operator was separately told that the only remaining task in this audit
batch was `npm audit`, which sends dependency names and versions to npm registry.
The subsequent instruction “работай дальше” was interpreted in that specific
context as permission for the scan; that interpretation was stated before the
command. The execution approval layer then allowed the explicitly scoped audit.
The previous denied attempts and behavior-only acceptance are not retroactively
treated as permission. No Git push, application launch, trade or credential
change was performed, and no installation or automatic fix was requested.

## Reproducible checkpoint

- Checkout: `main`, `21f8b516b359fc6df7c276ea74d5dd3b2c19d24e`, primary repository.
- Result recorded on 2026-09-05; recording clock read: 08:56:58 UTC.
- Node: `v26.4.0`; npm: `12.0.1`.
- Registry: `https://registry.npmjs.org/`; configured `omit`: empty.
- Command: `npm audit --json --ignore-scripts --registry=https://registry.npmjs.org/`.
- Exit status: **0**. The complete JSON stdout is preserved in [registry-audit.json](registry-audit.json).
- Manifest SHA-256: `d8368bcc7ecf1c34893284cd285429a9cee792fcaf1db5b285c00af6a77b9373`.
- Lockfile SHA-256: `b937b7132135fff93d18f79f26c2e661955d25f6f409f2bb641a2673a1d4b976`.

## Result and limits

The registry reported **zero known vulnerabilities**: info 0, low 0, moderate 0,
high 0, critical 0. Report version is 2. Dependency metadata reports total 718,
prod 114, dev 568, optional 128, peer 23 and peerOptional 0; these categories
overlap and must not be summed as disjoint groups. No development-dependency
omission flag was used. Electron remains part of desktop runtime risk assessment
even though its npm package is classified as a development dependency.

This is a fresh registry report for the captured dependency tree, not proof that
the application, packaged Chromium/Node binary, build environment or supply chain
has no unknown vulnerabilities. It does not replace upstream binary advisories,
source review, future rescans or the recorded runtime/packaging checks.

`npm run check:dependency-baseline` also passed for all seven locked copies.
That local check remains a version-floor guard, not another vulnerability scan.
No package, source or main-spec changes were needed. Therefore no fresh build,
package or source-test run was performed for this evidence-only completion; the
earlier 3,528-test/package checkpoint and operator acceptance retain their scope.

## OpenSpec closure

Task 2.4 is complete. Task 2.5 already records the operator's packaged-use
acceptance; scanning has not changed the accepted implementation. All ten tasks
and all planning artifacts are complete. Both delta requirements exactly match
their main-spec blocks, so the already-synced archive route is selected.
See [tasks](tasks.md) and the [acceptance history](../../../audit-live-acceptance-2026-09-05.md).

Before documentation edits, GitNexus was bound to `trade_ui_latest` at the
primary checkout and refreshed at `21f8b51`. Upstream/context analysis of
`Coverage limitations and graph review` resolved this change's evidence section
but returned no callers/processes, labeled LOW by the installed version. This
empty result was treated as unresolved and supplemented with tracked references;
the graph does not model transitive dependency security or every Markdown link.
