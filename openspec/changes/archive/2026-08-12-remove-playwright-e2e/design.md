## Context

Browser-driven Electron automation currently crosses the dependency manifest and lockfile, npm scripts, Vite build-mode selection, a dedicated Electron main entry, an environment-projected mock WebSocket route, a repository-level test tree, generated-report conventions, static boundary checks, and current developer documentation. Removing only the test files would leave dormant dependencies and executable production-adjacent branches behind.

The repository also has deterministic verification infrastructure that is not owned by that runner. `electron/env-setup.js`, the safe-development and bounded-smoke entries, the Futures production verification composition, Vitest fixtures, and the network escape guards are shared safety assets and must remain.

## Goals / Non-Goals

**Goals:**

- Remove Playwright completely from the supported and executable repository surface.
- Remove the dedicated browser-automation Electron/Vite composition and mock routing that have no remaining consumer.
- Keep the normal application, safe-development mode, bounded smoke mode, Vitest, lint, build, and static safety checks operational.
- Make current scripts and documentation describe the verification stack that the operator actually accepts.

**Non-Goals:**

- Introduce another browser or Electron automation runner.
- Change production trading behavior, renderer UX, exchange protocol behavior, or credentials handling.
- Rewrite Git history or erase factual evidence from historical audit documents.
- Treat this removal as proof that the retained tests cover every behavior previously exercised by browser automation.

## Decisions

### 1. Remove the path vertically, not file-by-file in isolation

The implementation will remove all layers of the retired path in one coherent change:

- direct dependencies and their lockfile closure;
- `prebuild:e2e`, `build:e2e`, `postbuild:e2e`, and `test:e2e`, with `test:all` redefined to use only retained gates;
- `playwright.config.js`, the browser suite and helpers under `tests/`, generated report conventions, and the identified root-level `probe_recent.mjs` browser probe if it is still present;
- `electron/main.e2e.js`, `electron/e2e-websocket-route.js`, and tests/fixtures that exist only for that route;
- the `e2e` Vite build branch and E2E-only cases in artifact and workstation-boundary checks;
- current README/testing instructions and active roadmap instructions that still advertise the removed commands.

This prevents a half-removed state in which a package, mock transport, or build branch remains reachable even though its primary suite is gone.

### 2. Reachability, not naming, decides which shared verification code stays

Files are deleted only when their remaining import and command graph has no accepted consumer. In particular:

- keep `electron/env-setup.js` because `main.safe-dev.js`, `main.smoke.js`, and local WebSocket tests consume it;
- keep the safe-development and bounded-smoke main entries;
- keep `futures-production-workstation-verification-composition.js` and equivalent deterministic compositions because Vitest, safe-development, and smoke verification use them;
- keep source and artifact safety guards, removing only their E2E-specific mode branches and wording;
- remove mock message helpers imported solely by the retired browser suite rather than moving them into production-adjacent code.

Before deletion, implementation must repeat an import/script-reference inventory so a newly added accepted consumer is not removed accidentally.

### 3. Preserve the aggregate command name but change its contract

`test:all` remains as the convenient aggregate entry point, but it will run only the supported non-browser gates. Keeping the name avoids unnecessary breakage in local habits while removing the retired command from its execution graph. The exact retained sequence will favor already independent commands: Vitest, lint, normal build, and the static safety/boundary checks.

No command will silently launch Electron through a browser driver or download browser binaries.

### 4. Distinguish current instructions from historical evidence

Current operator entry points such as `README.md` and `docs/tests.md`, plus any active roadmap or OpenSpec acceptance instruction, will be updated so they contain no runnable reference to the retired workflow. Current capability contracts will name only the retained verification entries. Historical phase plans and post-implementation audit reports may retain statements about what was run at that time; rewriting those statements would falsify the audit trail.

Where a mixed document contains both active guidance and historical evidence, only the active guidance is replaced and the historical section is explicitly framed as past evidence when ambiguity exists. The removal change itself necessarily names the retired tool as the subject of the decision.

### 5. Acceptance is static and unit-oriented

The implementation will be accepted with dependency/lockfile integrity, source and command inventory, Vitest, lint, the normal build, retained static guards, OpenSpec validation, and GitNexus change detection. It will not run or add browser-driven E2E verification.

## Risks / Trade-offs

- **Lost cross-process coverage:** Removing the suite reduces automated coverage of renderer-to-Electron composition. Mitigation: retain focused Vitest coverage, deterministic smoke, and static channel/build boundary checks; document the known gap instead of replacing the runner implicitly.
- **Accidental deletion of shared safety code:** E2E-named files sit near shared verification infrastructure. Mitigation: use reachability inventory before deletion and explicitly preserve shared environment setup, deterministic compositions, and network guards.
- **Stale automation references:** A script or active document could keep invoking a removed command. Mitigation: scan manifests, scripts, current docs, and source imports as an explicit acceptance task.
- **Misleading historical edits:** Erasing old evidence would make prior audit reports inaccurate. Mitigation: retain clearly historical statements while removing every current/executable path.
- **Aggregate command duration:** Expanding `test:all` to retained lint/build/static gates may make it slower than a unit-only command. Mitigation: keep individual commands available and document the aggregate contract.

## Migration Plan

1. Re-inventory every dependency, import, build-mode branch, command, current-documentation reference, generated artifact, and project-local probe associated with the retired path.
2. Remove the runner packages through npm so the lockfile is regenerated rather than hand-edited.
3. Remove the dedicated suites, helpers, configuration, Electron entry, mock route, and E2E-only tests.
4. Simplify Vite and static guard logic to the normal, safe-development, smoke, and Vitest compositions.
5. Redefine aggregate verification and update current documentation/active roadmap instructions.
6. Run only the retained non-browser verification gates, strict OpenSpec validation, GitNexus change detection, and a final reference inventory.
7. Keep the change unarchived until the operator confirms the resulting repository behavior; carry any unverified follow-up forward per repository policy.

Rollback is a normal Git revert of the coherent removal commit. No production data or user settings are migrated.

## Open Questions

None. The operator has explicitly chosen complete removal and explicitly prohibited browser-driven E2E execution.
