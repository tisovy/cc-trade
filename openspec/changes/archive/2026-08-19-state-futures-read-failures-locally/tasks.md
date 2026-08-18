## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `state-futures-read-failures-locally` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing symbol that will be edited and report direct callers, affected processes and risk before changing code.
- [x] 1.2 Attach sanitized, reason-specific terminal catches at the `unstated`, `stream` and `bootstrap` detached Futures refresh launch sites without changing refresh behavior.

## 2. Proof after implementation

- [x] 2.1 Add focused tests that make each detached refresh reject and prove the local reason is recorded without a process-wide unhandled rejection.
- [x] 2.2 Run the focused Binance connection tests, `npm run lint` and `npm run check:command-path`.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `state-futures-read-failures-locally` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.
