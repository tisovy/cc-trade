## Context

Vitest runs with the JSDOM environment and loads `src/test/setup.js` before test modules. On Node.js 26, an experimental process-global Web Storage accessor can win over JSDOM's global projection and yield `undefined`; application modules and test cleanup then fail before their assertions can provide useful signal. Several tests also call `vi.unstubAllGlobals()`, so a harness binding installed through Vitest's stub registry can disappear during teardown.

The repository already has test-owned storage mocks for tests that need spies, but the default environment needs a plain Storage-method-compatible contract rather than a globally shared spy. The previous README also advertised Node.js 18 even though the installed Vite release requires a newer runtime, so the support declaration must be made internally consistent before portability can be claimed.

## Goals / Non-Goals

**Goals:**

- Install deterministic `localStorage` and `sessionStorage` before any test module evaluates.
- Give each test fresh storage state even when a previous test mutates globals or calls `vi.unstubAllGlobals()`.
- Keep the default `npm test` command portable without process flags or machine state.
- Fail with a focused harness error if the environment cannot install the required globals.

**Non-Goals:**

- Change production renderer persistence or application storage helpers.
- Pin the project to one Node.js release solely to avoid the harness defect.
- Add a browser-oriented test environment, external storage service, or dependency.
- Convert every test-specific storage spy to the default harness implementation.

## Decisions

### 1. Own the default Web Storage globals in the test harness

A small test-only helper will create in-memory objects implementing the Storage methods used by the application, including required argument counts, DOM-string conversion, unsigned-long `key()` conversion, `length`, and insertion order. It will install them directly with configurable own-property descriptors on `globalThis`. The setup file will invoke it during setup, before test modules load.

Direct descriptors are chosen over `vi.stubGlobal` because tests legitimately call `vi.unstubAllGlobals()`; the default environment must survive that cleanup. Relying on Node's experimental accessor or on whichever descriptor JSDOM happens to project was rejected because that is the portability defect being fixed.

### 2. Reinstall fresh storage for every test

The harness will install fresh local and session stores at the start of each test, rather than sharing one store and hoping every suite clears it. Vitest's `unstubGlobals` cleanup clears its internal stub registry between tests before the harness installs the next pair. This makes isolation the default and recovers from a prior test replacing, deleting, or stubbing a descriptor. An initial installation remains necessary before test-module evaluation.

Clearing only in `afterEach` was rejected because a failing teardown or a removed global can prevent cleanup and contaminate later tests.

### 3. Keep specialized spy storage explicit

`src/test/mocks/storage.js` remains available for tests that assert storage calls. Such a fixture is installed inside that suite's `beforeEach`, after the default harness reset, rather than at module scope. The default harness storage implements the required browser method semantics without globally exposing Vitest spies, so global mock resets cannot silently disable storage methods.

### 4. Verify the hostile descriptor, not only the happy path

Focused coverage will replace an ambient storage descriptor with an unavailable value, run the installer, and verify string coercion, missing-key `null`, removal, clearing, `length`, and key enumeration. A second case will prove local/session separation and per-test reset. The standard full suite on the current Node.js version remains the acceptance test.

### 5. Preflight both global descriptors before mutation

The installer will inspect both own descriptors without invoking their getters and reject a non-configurable target before defining either storage global. A failed install therefore leaves the target unchanged instead of creating a half-installed environment.

### 6. Declare the runtime range the toolchain actually accepts

`package.json` and the README will both declare Node.js `^20.19.0 || >=22.12.0`, matching the installed Vite major's runtime floor. Acceptance records the exact available runtimes exercised; it does not claim that one run on Node 26 proves every future Node release.

## Risks / Trade-offs

- **A future runtime exposes a non-configurable global descriptor** → Detect the descriptor and fail with a focused setup error naming the blocked storage global instead of producing dozens of unrelated component failures.
- **The in-memory implementation drifts from browser Storage method semantics** → Cover required arity, DOM-string conversion, unsigned-long index conversion, the complete project-used method interface, and string coercion in focused tests; named-property proxy behavior is not part of the project contract.
- **A test intentionally expects persistence across test cases** → Such coupling becomes explicit test setup or a shared fixture; cross-test persistence is not a supported default.
- **A future toolchain raises its Node.js floor** → Keep `package.json` and README on one declared range and update them together with the dependency change.

## Migration Plan

1. Add the test-only Storage implementation and focused hostile-descriptor regressions.
2. Install fresh local/session stores from the existing Vitest setup lifecycle.
3. Run the focused storage suites, then standard `npm test` with no environment workaround.
4. Run the retained aggregate verification to ensure the harness change does not affect build or static gates.

Rollback removes the test-only helper and setup wiring; no production or user data is migrated.
