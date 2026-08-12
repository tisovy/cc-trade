## 1. Confirm Scope and Blast Radius

- [x] 1.1 Verify the primary checkout is on `master`, preserve unrelated worktree changes, refresh the GitNexus index if stale, and inventory every dependency, lockfile entry, import, npm command, build-mode branch, report artifact, ignore rule, current-documentation instruction, and project-local probe tied to Playwright/E2E.
- [x] 1.2 Run GitNexus upstream impact analysis for every existing function, class, or method that will be modified or deleted, report direct callers/processes/risk to the operator, and stop for an explicit warning before any HIGH or CRITICAL symbol edit.
- [x] 1.3 Classify each inventoried module as E2E-only or shared; record that `electron/env-setup.js`, safe-development/smoke entries, deterministic workstation verification compositions, and network/static safety guards remain unless the refreshed graph proves otherwise.

## 2. Remove Dependencies, Commands, and Runner Assets

- [x] 2.1 Remove `@playwright/test` and `playwright` through npm and verify the regenerated lockfile contains no reachable `playwright`, `playwright-core`, or `@playwright/test` package.
- [x] 2.2 Remove `prebuild:e2e`, `build:e2e`, `postbuild:e2e`, and `test:e2e`; redefine `test:all` as an aggregate of the retained Vitest, lint, normal-build, and static safety gates without any browser download or launch.
- [x] 2.3 Delete `playwright.config.js`, the E2E suite and helpers under `tests/`, Playwright-specific generated-report conventions and ignore rules, and the identified root `probe_recent.mjs` browser probe if it is still present.
- [x] 2.4 Re-run a reference/import inventory and remove any newly identified runner-only helper or configuration while preserving files with accepted non-browser consumers.

## 3. Remove the E2E-only Electron Composition

- [x] 3.1 Simplify `vite.config.js` so deterministic aliases remain available to Vitest, safe-development, and smoke builds, while the `e2e` build mode, `main.e2e.js` selection, and E2E-only output commentary are gone.
- [x] 3.2 Delete `electron/main.e2e.js`, `electron/e2e-websocket-route.js`, their dedicated tests, and the E2E mock-message test/fixture path after confirming no retained command or test imports them.
- [x] 3.3 Update Electron artifact, workstation-boundary, launch-contract, and devtools tests/checks to describe and enforce only the normal, safe-development, smoke, and Vitest compositions.
- [x] 3.4 Add or revise focused Vitest coverage for the simplified build-mode selector and retained composition boundaries without adding any browser-driving replacement.

## 4. Align Current Documentation

- [x] 4.1 Update `README.md`, `docs/tests.md`, and other current operator/developer entry points so every advertised verification command exists and belongs to the retained stack.
- [x] 4.2 Remove retired runnable instructions from active roadmap sections and clarify mixed documents where historical Playwright evidence could otherwise be mistaken for a current acceptance gate; do not rewrite factual past audit results.
- [x] 4.3 Document the retained verification contract and the known loss of automated cross-process UI coverage without recommending or introducing a replacement browser runner.
- [x] 4.4 Mark the accepted Phase 8 workstation ADR and threat model's browser-automation composition, guards, screenshots, and evidence as historical after the runner removal.

## 5. Verify the Removal Without Browser Automation

- [x] 5.1 Verify dependency and command integrity with npm's lockfile/package inspection and a static scan proving no Playwright package, import, executable suite, launch command, E2E build branch, report convention, or project-local probe remains in the supported surface.
- [x] 5.2 Run the retained focused and full Vitest commands; if the pre-existing Node/web-storage portability failure reproduces, stop and track that harness repair in a separate OpenSpec change rather than silently expanding this removal.
- [x] 5.3 Run lint, the normal production build, circular-import checking, runtime-mock checking, Futures production-boundary checking, command-path checking, Electron artifact checking, and any other retained static safety gate referenced by `test:all`.
- [x] 5.4 Run `OPENSPEC_TELEMETRY=0 openspec validate remove-playwright-e2e --strict --no-interactive`, `git diff --check`, and GitNexus `detect_changes()`; confirm only the expected dependency, verification, Electron-composition, test, and documentation surface changed.
- [x] 5.5 Keep the change unarchived and record manual confirmation of the normal application plus retained safe-development/smoke behavior as the archive gate rather than an automated implementation task.
- [x] 5.6 Strengthen the normal Electron artifact gate so it rejects deterministic verification markers and requires the reviewed production composition markers, with focused pure-contract tests.
- [x] 5.7 Add retained regression assertions that the retired dependency nodes, npm script keys, project entry/config files, and explicit `e2e` Electron build mode remain absent.
