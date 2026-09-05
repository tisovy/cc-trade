## 1. Local CI implementation

- [x] 1.1 Add the main-only hosted workflow with locked install, aggregate gates and unsigned/non-publishing package verification; inspect action revisions, command ordering and permissions.
- [x] 1.2 Declare the already locked YAML parser as a direct dev dependency; verify lockfile consistency without changing resolved dependency versions.
- [x] 1.3 After implementation, add parsed workflow contract tests for triggers, security, fail-fast ordering, normal packaging and existing gate wiring; run the focused tests.
- [x] 1.4 Document reproduction, acceptance boundaries and the main-only enforcement decision; verify documentation matches the workflow and update A06 status.

## 2. Integration and self-review

- [x] 2.1 Run the full aggregate suite and real Linux x64 packaging/ASAR checks without launching the app; record environment and results.
- [x] 2.2 Validate OpenSpec, review the complete diff and run GitNexus all/compare-main checks; record limitations and commit the scoped change to main.

## 3. Hosted acceptance (requires a later authorized push)

- [ ] 3.1 Record an actual hosted run URL, revision, full gate/package result, owner acceptance and a separate main-compatible enforcement decision before syncing/archiving; local checks alone do not complete this task.
