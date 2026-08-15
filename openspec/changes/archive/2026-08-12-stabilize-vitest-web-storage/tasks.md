## 1. Baseline and Safety

- [x] 1.1 Verify the primary checkout is on `master`, record the active Node.js version, validate this change strictly, and reproduce the standard `npm test` Web Storage harness failure without `NODE_OPTIONS` or other process-level workarounds.
- [x] 1.2 Run GitNexus upstream impact analysis for every existing function, method, or class that the harness implementation will modify; report the blast radius and obtain explicit direction before proceeding if any result is HIGH or CRITICAL.

## 2. Deterministic Web Storage Harness

- [x] 2.1 Add a test-only in-memory Storage implementation covering `getItem`, `setItem`, `removeItem`, `clear`, `key`, `length`, browser-style string coercion, and missing-key `null` semantics.
- [x] 2.2 Add an installer that replaces unavailable or hostile ambient `localStorage` and `sessionStorage` accessors with configurable own-property descriptors and emits a focused setup error when replacement is impossible.
- [x] 2.3 Wire the installer into `src/test/setup.js` before test-module evaluation and before every test with fresh, separate local and session stores, while preserving the existing network guards and cleanup hooks.

## 3. Regression Coverage

- [x] 3.1 Add focused Vitest coverage for hostile or undefined ambient Web Storage descriptors and the complete default Storage behavior.
- [x] 3.2 Prove that `localStorage` and `sessionStorage` do not share state, that each test starts empty, and that the harness recovers after a test deletes or replaces a storage global or calls `vi.unstubAllGlobals()`.
- [x] 3.3 Keep specialized spy-based storage fixtures explicit and verify that the default harness does not change their existing call-observation behavior.
- [x] 3.4 Move module-scoped spy storage fixtures behind each affected suite's `beforeEach` boundary and remove the unused DataContext fixture so deterministic setup cannot detach a suite from the storage object it asserts against.
- [x] 3.5 Clear Vitest's global-stub registry between tests and prove an un-restored `vi.stubGlobal('localStorage', ...)` cannot resurrect stale storage in a later test.
- [x] 3.6 Preflight both storage descriptors without invoking hostile getters and prove a locked second descriptor leaves the first global unchanged.
- [x] 3.7 Match JSDOM's required method arity, DOM-string conversion, and unsigned-long `key()` conversion; cover both globals at module evaluation and prove fresh object identity between tests.
- [x] 3.8 Remove the detached module-scope storage mock from `MiniChart.test.jsx`, which has no storage-call assertions and actually uses the default harness.

## 4. Documentation and Verification

- [x] 4.1 Document the self-contained Vitest Web Storage contract, the standard command, and the exact Node.js version used for acceptance without prescribing a machine-global workaround.
- [x] 4.2 Run the focused harness tests and the standard `npm test` command with no storage-related environment flags; require the complete Vitest suite to pass.
- [x] 4.3 Run lint, the normal build, every retained static safety check, and the aggregate `test:all` command; confirm none launches or downloads a browser.
- [x] 4.4 Re-run strict OpenSpec validation, `git diff --check`, and GitNexus `detect_changes` against `master`; confirm only the planned test-harness, focused-test, documentation, and OpenSpec surfaces are affected.
- [x] 4.5 Keep the change unarchived and record operator confirmation of the standard verification command in the intended environment as the archive gate rather than an automated implementation task.
- [x] 4.6 Align the README and package manifest on Node.js `^20.19.0 || >=22.12.0`, matching the installed Vite toolchain, and verify the harness on every supported runtime already installed locally.
