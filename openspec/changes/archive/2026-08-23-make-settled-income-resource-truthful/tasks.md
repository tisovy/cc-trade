## 1. CRITICAL impact and schema gates

- [x] 1.1 Re-run GitNexus upstream impact for `readFuturesSettledMoney`, store load/save, scheduling, broadcast, hook, and refresh symbols; warn on CRITICAL/HIGH results and list every affected trigger flow before editing
- [x] 1.2 Define the versioned canonical income entry and resource frame in production code, preserving identifiers as strings, then verify Electron and renderer builds import the same dependency-free contract

## 2. Transactional resource production path

- [x] 2.1 Implement canonical normalization/identity at the HTTP boundary and remove duplicate production key generation/reparsing, then verify unsafe integer IDs remain distinct through a local round-trip probe
- [x] 2.2 Implement versioned store load validation and transactional successful commits so failures cannot advance rows/bounds/success time, then verify expired/inverted cache is rejected and old confirmed data survives a simulated failure
- [x] 2.3 Add monotonic content generation plus stable digest over canonical rows/coverage/state and verify same-count amount/identity corrections advance generation while identical verification does not
- [x] 2.3a Keep save-time digest validation while removing avoidable repeated full-resource canonicalize/sort/digest passes, then verify one save serializes each canonical lane once
- [x] 2.4 Propagate status, bidirectional coverage, target, attempt/success times, generation, and sanitized failure through production broadcast/IPC/hook consumers, then verify a first-page refusal never emits ready-empty
- [x] 2.5 Correct failure outcome classification to use the walk's failed state even when no error code exists, then verify a plain `Error` produces failed/stale resource state
- [x] 2.6 Clear failed-lane completeness without erasing its confirmed rows/bounds/success time, then verify serialized `stale/error` lanes cannot also claim `complete=true`
- [x] 2.7 Enforce lane status/completeness consistency at the canonical constructor, then verify retained `idle/loading/stale/error` lanes serialize with `complete=false`
- [x] 2.8 Revalidate temporal and status/completeness invariants at the renderer boundary, then verify malformed IPC cannot become epoch time or exact settled coverage
- [x] 2.9 Send each joining Futures renderer a fingerprint-authoritative account frame before its settled-income snapshot without rebroadcasting to existing renderers
- [x] 2.10 Make v2 renderer ingestion atomically reject duplicate lanes, malformed/duplicate/conflicting/wrong-lane rows, and contradictory aggregate rows while deriving accepted aggregate money from lane authority
- [x] 2.11 Make v2 persisted-lane restoration reject malformed, duplicate, or wrong-lane confirmed and pending rows before lossy canonical helpers run
- [x] 2.12 Bound canonical income identifiers and textual money/dimensions before identity construction, hashing, persistence, or IPC
- [x] 2.13 Reject symbol-less contract-scoped funding/insurance at the canonical resource boundary while preserving valid symbol-less account-level credits
- [x] 2.14 Publish newer per-lane attempt/success times without advancing content generation, and admit only same-digest/newer-read same-generation frames at the renderer boundary
- [x] 2.15 Enforce ready/success/pending temporal invariants in canonical construction, persisted restore, and renderer ingestion; derive aggregate state from lanes and require actual canonical content equality for same-generation observation updates
- [x] 2.16 Bound renderer row arrays before canonicalization and publish authoritative lane rows once without duplicating the aggregate row union
- [x] 2.17 Require renderer frames to carry exactly every canonical settled-income lane so empty, partial, or extra lane sets cannot replace held authority
- [x] 2.18 Fence settled-income completion by monotonic per-lane manual intent so an older background walk cannot overwrite newer manual-loading state
- [x] 2.19 Cache sorted canonical lane-row references by activation/account/content revision so observation-only frames rebuild metadata without re-canonicalizing the retained ledger
- [x] 2.20 Keep a separate last-persistable exchange-backed settled resource so event debt written during manual refresh never serializes process-local loading lanes
- [x] 2.21 Reject non-canonical income type/symbol/asset alphabets and fully sanitize credential-bearing failure codes/messages before persistence or IPC
- [x] 2.22 Normalize each valid income amount to one exact plain-decimal text before fallback identity and digest construction
- [x] 2.23 Preserve and reject padded/Unicode/lowercase tokens and malformed present optional identifiers, make credential-marker diagnostics generic across store/IPC/logging, and refuse non-array adapter pages without empty coercion
- [x] 2.24 Reject numeric monetary evidence at both the HTTP normalizer and canonical resource boundary, compute each lane's completeness only against its own acquisition target, and reserve the aggregate maximum for resource-wide completeness and metadata

## 3. Refresh and UI production path

- [x] 3.1 Carry explicit validated manual intent only from the Futures Refresh button, publish its accepted compound receipt, derive terminal account outcome from request-newer account-resource attempts, and keep canonical settled-income state independent while leaving startup/mutation/periodic reads detached; verify account success cannot overwrite income failure
- [x] 3.2 Render settled-income loading/ready/stale/error and last-success time without replacing retained values, then verify pending and failed refreshes remain visible and retryable
- [x] 3.3 Preserve all existing scheduler/startup/user-stream/command trigger entry points behind the new resource seam and verify each trigger produces exactly one expected resource transition

## 4. Tests after implementation

- [x] 4.1 Update store/walk tests for first-page failure, failed verification immutability, expired cache, bidirectional coverage, and plain-error outcome; run focused Electron suites
- [x] 4.2 Add read→store→broadcast tests for same-count amount/identity correction, identical dedup, unsafe identifiers, account fingerprint, and generation ordering; run the main-process suite
- [x] 4.2a Add canonical/store regressions proving assetless rows fail closed and save serialization reuses one authoritative digest without weakening mutation rejection
- [x] 4.3 Add hook/UI/manual-refresh tests for independent resource states, retained stale data, target coverage, pending refresh, and partial failure; run focused renderer suites
- [x] 4.3a Add a Closed renderer regression for v2 loading/ready/stale/error, retained wallet rows, last-success text, and retry action; run the focused history-panel suite
- [x] 4.4 Run all GitNexus-identified startup, user-stream, place/modify/cancel/margin, and refresh regression suites
- [x] 4.5 Add constructor/serialization regressions for every non-ready status retaining previously complete evidence
- [x] 4.6 Add renderer-frame regressions for blank/null times and contradictory non-ready completeness
- [x] 4.7 Add main/renderer regressions for activation-frame admission and for zero-fill lifecycle reports versus actual fills
- [x] 4.8 Add renderer and hook regressions proving malformed or contradictory newer frames cannot replace confirmed lane evidence or publish exact NET
- [x] 4.9 Add persisted-resource regressions proving corrupt extra, duplicate, wrong-lane, and pending rows reject the whole cache instead of preserving complete state
- [x] 4.10 Add oversized income identifier/decimal/symbol/type/asset regressions proving one row cannot defeat resource bounds
- [x] 4.11 Add main/hook regressions proving manual compound acceptance, queued account pending state, terminal account success beside income failure, and no manual receipt for periodic/background refreshes
- [x] 4.12 Add canonical and lane regressions proving symbol-less funding/insurance fail transactionally while symbol-less account-level credits remain admissible
- [x] 4.13 Add main/renderer regressions proving unchanged successful verification updates observation time once, suppresses an exact replay, and rejects same-generation digest disagreement
- [x] 4.14 Add constructor/store/renderer regressions for missing or regressed ready times, ready-with-pending state, contradictory aggregate metadata, and changed money hidden behind the same generation/digest label
- [x] 4.15 Add renderer/main regressions for pre-canonicalization row ceilings and single-copy observation frames
- [x] 4.16 Add renderer regressions proving empty, partial, extra, and newer incomplete lane sets are rejected while the held snapshot survives
- [x] 4.17 Add a single-flight race regression proving old completion preserves newer manual loading until the authorized manual pass succeeds or fails
- [x] 4.18 Add a cache regression proving observation-only publication reuses row arrays while content or activation revisions invalidate them
- [x] 4.19 Add an event-during-manual-loading persistence regression proving restart-safe debt is written over exchange-backed lanes without storing provisional loading state
- [x] 4.20 Add canonical-boundary regressions for malformed token alphabets, arbitrary diagnostic codes, and authorization scheme/token redaction
- [x] 4.21 Add canonical-boundary regressions proving equivalent decimal spellings share one amount and fallback identity without numeric rounding
- [x] 4.22 Add adapter→walk, store/IPC/logger, and retained-resource regressions for lossy token/identifier normalization, quoted credentials, and non-array page containers
- [x] 4.23 Add adapter/resource/store/IPC regressions proving numeric income cannot become rounded canonical money
- [x] 4.24 Add main-resource and renderer-frame regressions proving a funding-only target advance preserves older complete credit lanes and rejects contradictory aggregate completeness

## 5. Verification and operator gate

- [x] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-settled-income-resource-truthful --strict` and verify it passes
- [x] 5.2 Run GitNexus `detect_changes` against `main`, inspect every CRITICAL/HIGH flow delta, and resolve unexpected scheduling/admission changes before commit
- [ ] 5.3 Exercise live success → failed refresh → recovery and a same-shape verification correction, confirming timestamps/coverage/UI are truthful; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation; do not use archival as proof of live recovery
