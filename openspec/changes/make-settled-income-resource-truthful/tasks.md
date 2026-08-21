## 1. CRITICAL impact and schema gates

- [ ] 1.1 Re-run GitNexus upstream impact for `readFuturesSettledMoney`, store load/save, scheduling, broadcast, hook, and refresh symbols; warn on CRITICAL/HIGH results and list every affected trigger flow before editing
- [ ] 1.2 Define the versioned canonical income entry and resource frame in production code, preserving identifiers as strings, then verify Electron and renderer builds import the same dependency-free contract

## 2. Transactional resource production path

- [ ] 2.1 Implement canonical normalization/identity at the HTTP boundary and remove duplicate production key generation/reparsing, then verify unsafe integer IDs remain distinct through a local round-trip probe
- [ ] 2.2 Implement versioned store load validation and transactional successful commits so failures cannot advance rows/bounds/success time, then verify expired/inverted cache is rejected and old confirmed data survives a simulated failure
- [ ] 2.3 Add monotonic content generation plus stable digest over canonical rows/coverage/state and verify same-count amount/identity corrections advance generation while identical verification does not
- [ ] 2.4 Propagate status, bidirectional coverage, target, attempt/success times, generation, and sanitized failure through production broadcast/IPC/hook consumers, then verify a first-page refusal never emits ready-empty
- [ ] 2.5 Correct failure outcome classification to use the walk's failed state even when no error code exists, then verify a plain `Error` produces failed/stale resource state

## 3. Refresh and UI production path

- [ ] 3.1 Make manual Futures Refresh expose/await independent account and settled-income outcomes while leaving mutation-triggered reads detached, then verify account success cannot overwrite income failure
- [ ] 3.2 Render settled-income loading/ready/stale/error and last-success time without replacing retained values, then verify pending and failed refreshes remain visible and retryable
- [ ] 3.3 Preserve all existing scheduler/startup/user-stream/command trigger entry points behind the new resource seam and verify each trigger produces exactly one expected resource transition

## 4. Tests after implementation

- [ ] 4.1 Update store/walk tests for first-page failure, failed verification immutability, expired cache, bidirectional coverage, and plain-error outcome; run focused Electron suites
- [ ] 4.2 Add read→store→broadcast tests for same-count amount/identity correction, identical dedup, unsafe identifiers, account fingerprint, and generation ordering; run the main-process suite
- [ ] 4.3 Add hook/UI/manual-refresh tests for independent resource states, retained stale data, target coverage, pending refresh, and partial failure; run focused renderer suites
- [ ] 4.4 Run all GitNexus-identified startup, user-stream, place/modify/cancel/margin, and refresh regression suites

## 5. Verification and operator gate

- [ ] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-settled-income-resource-truthful --strict` and verify it passes
- [ ] 5.2 Run GitNexus `detect_changes` against `main`, inspect every CRITICAL/HIGH flow delta, and resolve unexpected scheduling/admission changes before commit
- [ ] 5.3 Exercise live success → failed refresh → recovery and a same-shape verification correction, confirming timestamps/coverage/UI are truthful; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation; do not use archival as proof of live recovery
