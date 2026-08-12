## Why

Playwright/Electron end-to-end automation is no longer an accepted verification path for this project, yet it still expands the dependency graph, build modes, Electron bootstrap surface, maintenance burden, and default test commands. Remove that unsupported path completely so the repository exposes only verification workflows the operator intends to maintain and trust.

## What Changes

- **BREAKING (developer tooling)** Remove the Playwright packages, configuration, npm scripts, tracked browser-automation suites, helpers, reports, and related ignore rules.
- Remove the E2E-only Electron entry point, mock-WebSocket routing, verification build mode, and source branches that exist only to launch Playwright.
- Remove or revise documentation and automation that advertise Playwright or the removed E2E commands as supported project workflows.
- Preserve the normal, safe-development, and smoke Electron compositions and all production runtime behavior.
- Keep Vitest, lint, normal builds, and the existing static boundary/guard checks as the supported automated verification stack; this change does not introduce a replacement browser runner.

## Capabilities

### New Capabilities

- `project-verification`: Defines the supported repository verification surface after browser-driven E2E automation is removed.

### Modified Capabilities

- `futures-live-readiness`: Verification-launch safety applies only to the
  retained safe-development and bounded-smoke entries after the browser-driven
  entry is removed.

## Impact

- Affected dependency manifests: `package.json` and the npm lockfile.
- Affected tooling: Playwright configuration, npm verification scripts, E2E test directories/helpers, generated-report conventions, and any CI or documentation references.
- Affected Electron/Vite composition: the E2E build mode and the modules reachable only from its dedicated main-process entry.
- Normal application startup, production trading code, Vitest suites, lint, build, safe-development, and smoke workflows remain in scope for regression verification but are not behaviorally changed.
- Historical Git commits and this OpenSpec change remain as audit records; "complete removal" applies to the repository's supported and executable project surface.
