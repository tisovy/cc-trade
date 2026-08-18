## 0. Pre-implementation gate

- [x] 0.1 Run strict OpenSpec validation for `bound-depth-delivery` before changing production code. Passed on 2026-08-18 with no production edit present.

## 1. Production implementation

- [x] 1.1 Run upstream GitNexus impact analysis for every existing depth delivery, session lifecycle and release symbol that will be edited; report blast radius and risk before changing code.
- [x] 1.2 Add session-owned depth delivery state with a 200 ms minimum routine spacing, one replaceable newest pending descriptor and one teardown-safe timer.
- [x] 1.3 Route routine diffs through the bounded dispatcher, build the renderer view only when a delivery is due, let stale/unavailable/resynchronizing/recovered-live and explicit selection states emit immediately, and clear pending delivery on ownership change or release.

## 2. Proof after implementation

- [x] 2.1 Add service tests proving routine emissions and expensive view construction stay at least 200 ms apart, the newest book reaches the renderer, and pending storage never grows past one.
- [x] 2.2 Add service tests proving stale/recovery states bypass delay and teardown prevents a late delivery.
- [x] 2.3 Run the focused workstation-service tests, `npm run lint` and `npm run check:futures-production`.

## 3. Change completion

- [x] 3.1 Run `git diff --check` and strict OpenSpec validation for `bound-depth-delivery` after implementation.
- [x] 3.2 Stage only this change's files and implementation, then run GitNexus `detect_changes` on staged scope and confirm the affected symbols/flows are expected.
- [x] 3.3 Commit the completed change directly to `main` without archiving it.
