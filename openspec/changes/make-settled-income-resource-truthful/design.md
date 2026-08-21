## Context

See `proposal.md` for motivation. The current walk initializes bounds from `now`, the store can merge failed verification with advanced coverage, and the broadcast revision uses only row count/bounds/completeness. Renderer frames omit the newest covered edge and have no independent resource failure state. GitNexus marks the central reader CRITICAL, so changes must preserve scheduler, startup, user-stream, and command-trigger behavior at explicit seams.

## Goals / Non-Goals

**Goals:**

- Define invariants for successful data, attempted work, persisted coverage, and publication.
- Make same-shape corrections observable without flooding identical frames.
- Give settled income the same truthful resource semantics as other account data.

**Non-Goals:**

- Changing page traversal or per-lane cadence; that belongs to `make-settled-income-acquisition-lossless`.
- Changing monetary ownership; that belongs to `make-futures-wallet-net-additive`.
- Blocking trading mutations on background income reads.

## Decisions

### 1. Introduce one versioned settled-income resource frame

Use a versioned shape containing `status`, canonical `rows`, `coveredFrom`, `coveredTo`, `targetTo`, `completeByType`, `attemptedAt`, `successfulAt`, `generation`, and sanitized `error`. `ready` requires at least one successful logical page or a valid loaded cache. `stale` requires retained successful content plus a later failure/age condition. `error` without retained content never masquerades as empty ready data.

### 2. Make successful coverage transactional

The walker returns tentative page results separately from committed coverage. The store advances rows/bounds/success time only when the logical page/window satisfies its success contract. A failure writes diagnostic attempt state but does not mutate the confirmed snapshot. Loading validates and clamps bounds atomically, rejecting a cache whose post-clamp interval is inverted or wholly expired.

### 3. Centralize canonical entry normalization and identity

Move row parsing, allowed type mapping, exact-string identifier handling, and canonical identity serialization into one shared module used by main/store and renderer. Normalize once at the HTTP boundary; later layers validate the canonical shape without reparsing numbers or regenerating alternate keys.

This removes the current paired `incomeRowKey` implementations and the triple normalization path that previously allowed unsafe-number collisions.

### 4. Generate publication revisions from content

Increment a persisted monotonic generation whenever the committed canonical map, coverage, completeness, or resource state changes. For store reconciliation/debugging, also compute a stable digest over sorted canonical serialized entries and metadata. Broadcast uses generation; identical attempted verification leaves generation unchanged.

A monotonic generation is chosen over using a hash alone because it is cheap for every frame and naturally orders replacements. The digest protects migration/debug assertions.

### 5. Keep manual refresh compound and background triggers detached

Manual Futures Refresh starts account and income work concurrently, awaits each resource result, and returns/publishes a compound outcome. One resource's success does not overwrite another's failure. Execution/funding-triggered income work remains scheduled/detached and reports only through the resource frame.

### 6. Stage the CRITICAL path behind seam tests

Preserve existing admission/scheduling entry points initially. Replace store commit semantics first, then publication revision, then renderer resource handling, then manual refresh. Tests at `read → store → broadcast` seams cover every trigger reason so a revision fix cannot accidentally alter scheduling.

## Risks / Trade-offs

- **[Store schema migration loses cache]** → Version records and fail closed to a fresh read; never reinterpret incompatible bounds.
- **[Generation resets after account change]** → Scope store and generation by account fingerprint and activation generation.
- **[More explicit failures are visually noisy]** → Retain confirmed values and use one resource-level stale/error treatment rather than per-row alerts.
- **[Canonical module creates Electron/renderer build coupling]** → Keep it dependency-free and cover both import targets in build tests.

## Migration Plan

1. Add the canonical row module and v2 resource/store shape, with read compatibility only for provably valid v1 caches.
2. Implement transactional production commit semantics and content generation.
3. Extend IPC/hook/UI with dual-read support, then remove the legacy frame.
4. Make manual refresh publish compound resource outcomes.
5. Only afterward add/update first-page failure, failed verification, expired cache, same-count correction, unsafe ID, trigger-seam, and UI-state tests.
6. Run live failure/recovery probes before archive. Rollback invalidates v2 cache and performs a fresh read; confirmed exchange data remains the authority.
