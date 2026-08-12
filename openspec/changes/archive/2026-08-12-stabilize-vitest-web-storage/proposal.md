## Why

The documented standard `npm test` command fails on Node.js 26 because Node's experimental global Web Storage accessor shadows JSDOM's storage objects with `undefined`. The resulting 78 failures are harness failures rather than product regressions, so the retained verification contract is not portable across the documented Node.js support range.

## What Changes

- Make the Vitest/JSDOM setup install one deterministic, isolated Storage-method contract for `localStorage` and `sessionStorage` regardless of ambient Node Web Storage globals.
- Add a focused regression that reproduces the shadowed or unavailable global and proves storage state is isolated and reset between tests.
- Keep the standard `npm test` command self-contained; developers SHALL NOT need `NODE_OPTIONS`, a storage-file flag, or a machine-global workaround.
- Preserve production renderer storage behavior and application code unchanged.
- Record the Node.js version used by verification so future failures can be separated from product regressions.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `project-verification`: The standard Vitest command must provide deterministic Web Storage methods across the declared Node.js support range without external process flags.

## Impact

- Test harness: `src/test/setup.js`, `src/test/webStorage.js`, `vitest.config.js`, focused setup tests, and suites that previously installed spy storage at module scope.
- Dependency/documentation contract: `package.json`, the lockfile, `README.md`, and `docs/tests.md` declare the supported/tested Node.js and fixture-lifecycle contract.
- Production Electron, renderer, trading behavior, dependencies, and user storage are not changed.
