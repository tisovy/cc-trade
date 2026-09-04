## 1. Contract

- [x] 1.1 Verify current protocol and SDK behavior, inspect affected owners, disclose HIGH/CRITICAL impact and validate the proposal before code.

## 2. Implementation

- [x] 2.1 Implement a bounded, generation-owned signed Spot private-subscription controller.
- [x] 2.2 Integrate shared activation/teardown and account catch-up; remove obsolete Spot listenKey methods and timers.
- [x] 2.3 Publish subscription health, guard new placements while unavailable, and display/reset the renderer warning.
- [x] 2.4 After production changes, replace retired lifecycle tests and add controller, local-wire, service and renderer regressions.
- [x] 2.5 Retain health at the gateway before workspace mount; invalidate stale REST account snapshots and coalesce trailing balance reads.

## 3. Verification

- [x] 3.1 Run targeted/full checks and exact diff/graph review; record decisions, evidence and limitations.
- [x] 3.2 Validate and commit directly to main.
- [ ] 3.3 Obtain operator live confirmation before archive; no live order or induced production disconnect as an automated test.
