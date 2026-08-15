## 1. Make MARK Removal Machine-Checked

- [x] 1.1 Add chart tests asserting no MARK series, horizontal MARK price line, MARK label, or MARK accessibility text is created for a payload that carries mark data.
- [x] 1.2 Add a chart test asserting no INDEX series, line or label is created, and correct the stale `aria-label` that still announces an "index overlay" the chart no longer draws.
- [x] 1.3 Assert that current mark price still reaches the position rows, distinguishing "MARK overlay removed" from "mark price lost". (The header no longer carries Mark at all — it was removed on operator request — so the surviving reader is the position row, covered in `FuturesPortfolioDock.test.jsx` and `futuresOrderPresentation.test.js`, and the chart test asserts the position's ENTRY overlay still draws.)
- [x] 1.4 Re-close task 7.4 in `restore-futures-trading-and-tune-tape` once these assertions exist.

## 2. Harden the Runtime-MOCK Source-Graph Check

- [x] 2.1 Resolve aliased and bare first-party specifiers when walking the graph, so no production subtree is skipped.
- [x] 2.2 Fail when the reachable module count falls below a recorded floor, so a silently shrinking graph cannot report success.
- [x] 2.3 Detect synthetic-data shapes generically instead of only six historical symbol names: identifiers declared or called as mock/fake/stub/synthetic/simulated/dummy, and `Math.random()` anywhere in the graph outside a named allowlist of identifier-minting files.
- [x] 2.4 Report explicitly that the check covers the production source graph, and document its relationship to `check-electron-build-artifacts.mjs`.
- [x] 2.5 Add self-tests proving the check fails on a renamed mock, on a bare or aliased import that hides one, and on a graph that shrinks below the floor.

## 3. Correct Account-Error Retryability

- [x] 3.1 Classify 4xx responses that are not permission or rate-limit failures as non-retryable, leaving `-2014`/`-2015`/`-1021`/`-1003` and 5xx behavior unchanged.
- [x] 3.2 Extend `futures-account-state.test.js` for 404, 400, and an unclassified 5xx, asserting the retryability each exposes to the ticket.

## 4. Verify

- [x] 4.1 Run the full test suite, ESLint, production build, runtime-MOCK check, futures boundary check, and circular-import check. (79 files / 867 tests passed with 2 skipped; lint clean; build and artifact boundary clean; source graph 105 modules; circular and boundary checks clean.)
- [x] 4.2 Confirm the hardened check still passes on the unmodified production graph and fails on each seeded regression from task 2.5. (On the real graph: a seeded pattern matches real modules, a raised floor fails, and the unmodified graph reports no failures. The renamed-mock, bare-specifier, aliased-specifier and below-floor failures are proven in `scripts/check-runtime-mock-layer.test.mjs`.)
