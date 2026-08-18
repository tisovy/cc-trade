## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `keep-candle-history-answers` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing history hook, reducer/service and command-routing symbol that will be edited; report blast radius and risk before changing code.
- [x] 1.2 Make the renderer assemble a completed answer in event-derived state outside the resource snapshot and apply that exact accepted answer while preserving request/selection/generation/revision guards.
- [x] 1.3 Add an exact, bounded workstation history-outcome protocol shape and route it through the validated workstation frame path without treating it as generation/revision-ordered resource state.
- [x] 1.4 Emit and consume an unavailable history outcome when ownership validation refuses the request, carrying the subscription identity and selection needed to release only a matching renderer read.

## 2. Proof after implementation

- [x] 2.1 Add a hook regression proving a served page survives a same-cycle outage and a mismatched failure cannot release another read.
- [x] 2.2 Add protocol, router and service/command-path regressions proving `CANDLE_HISTORY_OWNER_UNAVAILABLE` produces one validated bounded workstation outcome and an abandoned selection ignores it.
- [x] 2.3 Run the focused hook, protocol, router and workstation-service tests, `npm run lint`, `npm run check:futures-production` and `npm run check:command-path`.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `keep-candle-history-answers` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.

## 4. Post-implementation audit

- [x] 4.1 Run upstream GitNexus impact analysis for the history hook symbol before the audit fix.
- [x] 4.2 Prevent a mismatched unavailable outcome from replacing an already accepted matching history answer in the same renderer batch.
- [x] 4.3 Add a hook regression proving a mismatched outcome delivered after a matching served page cannot discard that page or retain its request lock.
- [x] 4.4 Re-run the focused hook tests, `npm run lint`, `git diff --check` and strict OpenSpec validation.
