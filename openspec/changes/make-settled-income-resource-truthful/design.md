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

Use a versioned shape containing `status`, canonical `rows`, `coveredFrom`, `coveredTo`, `targetTo`, `completeByType`, `attemptedAt`, `successfulAt`, `generation`, and sanitized `error`. Every timestamp and coverage bound is a non-negative safe integer. `ready` requires a safe last-attempt time and at least one successful logical page or a valid loaded cache with a safe last-success time. `stale` requires retained successful content plus a later failure/age condition. `error` without retained content never masquerades as empty ready data. Lane normalization makes current completeness a state invariant: only `ready` without a pending checkpoint may carry `complete=true`; pending, idle, stale, and failed states retain evidence but publish incomplete. Durable and IPC trust boundaries reject rather than silently coerce contradictory ready/pending/time state.

### 2. Make successful coverage transactional

The walker returns tentative page results separately from committed coverage. The store advances rows/bounds/success time only when the logical page/window satisfies its success contract. A failure writes diagnostic attempt state but does not mutate the confirmed snapshot. Loading validates and clamps bounds atomically, rejecting a cache whose post-clamp interval is inverted or wholly expired.

### 3. Centralize canonical entry normalization and identity

Move row parsing, allowed type mapping, exact-string identifier handling, required non-empty settlement asset, bounded field/decimal validation, and canonical identity serialization into one shared module used by main/store and renderer. Validate once at the HTTP boundary; later layers revalidate the canonical shape without reparsing numbers or regenerating alternate keys. Bounds are deliberately wider than Binance's documented/runtime values, but apply before token-alphabet validation, identity concatenation, digesting, persistence, or IPC so one malformed field cannot defeat the row-count ceiling. Non-empty income type and symbol tokens must already use uppercase ASCII letters, digits, and underscores; settlement assets must already use uppercase ASCII letters and digits. They are not trimmed or Unicode-case-folded into validity. The adapter carries a present optional identifier through unchanged so the shared boundary can distinguish malformed evidence from an actually omitted/empty identifier. Signed amounts are reduced to one exact plain-decimal text (no plus sign, redundant leading/trailing zeroes, or negative zero) before fallback identity and digest construction, so equivalent exchange spellings cannot be counted twice. Diagnostic messages and codes are a separate untrusted boundary: any bounded message containing a credential marker becomes a generic redacted diagnostic, only bounded numeric or conventional uppercase machine codes survive serialization, and main-process logs emit only that sanitized code.

Canonical scope is type-aware. Binance defines `FUNDING_FEE` and `INSURANCE_CLEAR` as contract-scoped income, so those rows require one non-empty canonical symbol before they can enter a complete lane. Account-level credit types may legitimately omit a symbol and remain canonical account-shared evidence. This distinction prevents a malformed position-scoped row from being assigned to an unrelated contract by timestamp without discarding valid account-level rebates.

This removes the current paired `incomeRowKey` implementations and the triple normalization path that previously allowed unsafe-number collisions.

The renderer treats IPC as a validation boundary too: absent/blank times are not numeric zero, and aggregate status, coverage, target, observation times, and completeness are re-derived from normalized lanes rather than trusted from contradictory payload flags. Supplied aggregate metadata must agree with that lane authority or the whole frame is rejected.

### 4. Separate money revisions from observation-time publication

Increment a persisted monotonic generation whenever the committed canonical map, coverage, completeness, or resource state changes. For store reconciliation/debugging, also compute a stable digest over sorted canonical serialized entries and metadata. Identical successful verification leaves that content generation and digest unchanged. Publication dedup additionally compares the bounded per-lane attempt/success times: a genuinely newer verification therefore sends one metadata-fresh frame without pretending the money changed, while a byte-identical frame with unchanged times is still suppressed. The renderer accepts that same-generation frame only when its digest agrees, its canonical lane content is byte-equivalent to the held frame, and its `readAt` and lane clocks are monotonic. A claimed digest label alone is not proof that money stayed unchanged; same-generation content or digest disagreement remains a contradiction.

The synchronous save path validates the resource's authoritative digest once and serializes the already-canonical lanes without recomputing that same full-resource digest or re-normalizing every row a second time.

Main-process IPC publication keeps one activation-scoped cache of sorted row references keyed by account fingerprint plus the validated content generation/digest. A same-content observation frame rebuilds only its bounded lane metadata and reuses those arrays; a content revision or activation/account change creates a fresh sorted snapshot. Because canonical lane maps already own frozen canonical rows, the cache sorts references and does not clone every row into a second object graph.

A monotonic generation is chosen over using a hash alone because it is cheap for every frame and naturally orders replacements. The digest protects migration/debug assertions.

### 5. Keep manual refresh compound and background triggers detached

Manual Futures Refresh is accepted as one compound operation that starts account and income work together. The renderer marks only the button-originated command with the validated `manual: true` intent bit; startup, execution-driven, and periodic account reads omit it. The LOW-risk typed-command handler publishes a bounded receipt naming the request, account fingerprint, and server-side request time only for that explicit manual command after it has been admitted; the receipt states that both account and settled income are independently authoritative resources and never copies a provisional income success into the command outcome.

The renderer combines that receipt with the account resources' own attempt/status fields to expose a terminal account outcome, while the existing canonical `futures_settled_income` frame remains the sole authority for income `loading`, `ready`, `stale`, or `error`. A queued account pass therefore remains pending until its own attempt is visible, and a later account success cannot clear or replace an income failure. The command does not await the detached income walk. Startup, execution/funding-triggered, and periodic work remains scheduled/detached, emits no manual receipt, and reports only through the resource frames.

### 6. Stage the CRITICAL path behind seam tests

Preserve existing admission/scheduling entry points initially. Replace store commit semantics first, then publication revision, then renderer resource handling, then manual refresh. Tests at `read → store → broadcast` seams cover every trigger reason so a revision fix cannot accidentally alter scheduling.

### 7. Name the account before sending a joining renderer its settled snapshot

Keep settled-income admission strict: the renderer continues to accept a settled frame only when its fingerprint exactly matches the most recent account envelope. On futures activation, the main process sends the activation acknowledgement first, then a connection-local account-state frame built from the same canonical payload as normal account broadcasts, then the connection-local settled-income snapshot. Existing renderers receive no redundant account broadcast. A fresh REST read remains independently scheduled and may be skipped when the shared resource is already current.

### 8. Dirty trade history only for actual fills

Order lifecycle execution reports still update visible order state, but `NEW`, `CANCELED`, and `EXPIRED` reports with no filled quantity do not advance fill-history activity, invalidate frozen coverage, or arm a delayed trade repair. A `TRADE` execution or another report carrying positive fill evidence does all three. This keeps the history proof tied to exchange facts that can add a trade row and avoids REST reads for order-state churn.

### 9. Admit renderer resource frames as one validated lane snapshot

Canonical row helpers intentionally drop malformed rows and collapse repeated identities, which is useful when constructing a resource at the exchange boundary but unsafe at the renderer trust boundary: a complete IPC lane could lose one charge and still qualify exact NET. Renderer ingestion therefore validates every raw row individually, rejects any duplicate identity (whether byte-equivalent or conflicting), rejects a row assigned to another lane, and rejects duplicate canonical lane names before constructing any candidate state.

The lane container is authoritative only when its normalized names equal the complete `FUTURES_UNDERIVABLE_INCOME_TYPES` set. Empty, partial, and extra lane sets are transactionally rejected before generation or observation ordering is considered. This prevents a newer but incomplete frame from replacing a held complete snapshot and making omitted money indistinguishable from a confirmed zero lane.

Lane rows and lane state are the sole authority for accepted aggregate money and metadata. A supplied aggregate list is validated with the same lossless rules and compared as a canonical identity/content set against the lane union; missing, extra, duplicate, or conflicting aggregate evidence rejects the whole frame. Aggregate status, coverage, target, attempt/success time, and completeness are derived from those validated lanes, and any supplied disagreement rejects the frame. The hook then naturally retains its prior fingerprint/generation snapshot. This is chosen over partially accepting valid rows with downgraded completeness because a partial newer generation would replace the last confirmed frame and discard evidence even though IPC corruption proves no trustworthy transaction boundary.

The main frame does not repeat the complete row union at top level: the lane arrays already contain every authoritative row, and the renderer derives their sorted union. Both each lane and any compatibility aggregate list are rejected before iteration when they exceed the shared retained-row ceiling. This keeps an observation-only hourly publication bounded and avoids serializing, parsing, canonicalizing, and sorting the same potentially large evidence set twice.

### 10. Restore persisted rows losslessly before canonical construction

The durable v2 payload is a trust boundary just like IPC. Before constructing a lane, restoration validates every raw confirmed and pending row, verifies that it belongs to the named lane, rejects repeated canonical identities, and rejects blank/absent ready observation times or a ready/complete lane carrying a pending checkpoint. This check happens before helpers that intentionally filter malformed rows, collapse identities, or coerce invalid state; otherwise a payload can append corrupt evidence while retaining the digest of its valid subset and be restored as `ready/complete` after the contradiction disappears.

### 11. Give manual loading a monotonic in-memory authority

Each accepted manual settled-income request assigns a monotonic intent revision to its requested lanes before it enters debounce or the single-flight queue. A pass snapshots the revisions it is authorized to satisfy. On completion, a lane carrying a different or newer manual revision keeps the current resource's `loading` state and retained confirmed evidence rather than accepting the older pass's terminal state. Only the manual pass that captured the current revision may clear that intent to ready, stale, or error.

This authority remains process-local because it coordinates overlapping work, not durable exchange evidence. The main process retains the last persistable exchange-backed resource separately from the live provisional loading presentation. When a funding, fill, or insurance witness arrives during manual loading, live state receives both the loading intent and the new stale debt, while the durable write applies that debt to the last exchange-backed lane snapshot. It never serializes unrelated loading lanes, their provisional target, or their cleared transient errors. A successful authorized pass advances both live and durable authority; a protected older completion advances neither durable state nor the manual intent. Confirmation debt therefore remains restart-safe without turning UI coordination into stored exchange evidence. Teardown clears the intent revisions with the other activation-owned scheduler state.

## Risks / Trade-offs

- **[Store schema migration loses cache]** → Version records and fail closed to a fresh read; never reinterpret incompatible bounds.
- **[Generation resets after account change]** → Scope store and generation by account fingerprint and activation generation.
- **[More explicit failures are visually noisy]** → Retain confirmed values and use one resource-level stale/error treatment rather than per-row alerts.
- **[Canonical module creates Electron/renderer build coupling]** → Keep it dependency-free and cover both import targets in build tests.
- **[Malformed IPC partially replaces confirmed renderer money]** → Validate lanes and aggregate as one transaction; reject the complete candidate and retain the prior generation on any row/lane contradiction.
- **[Malformed persisted evidence disappears before digest validation]** → Validate raw stored lane/checkpoint rows losslessly before canonical construction and reject the whole cache on any contradiction.
- **[A forged same-generation label hides changed money]** → Compare normalized lane state and rows as well as the claimed digest before admitting observation-only replacement.
- **[One malformed row consumes unbounded CPU/memory despite the row ceiling]** → Bound every identity/text/decimal field at canonical entry before exact parsing, identity construction, hashing, persistence, and IPC.
- **[Observation-only publication recopies the complete ledger]** → Send rows once under authoritative lanes, derive the aggregate in the renderer, and reject arrays above the shared per-lane ceiling before canonicalization/sort.
- **[A newer observation clock re-sorts unchanged lane rows]** → Reuse the activation/account/content-keyed sorted row snapshot and invalidate it on any generation/digest change.
- **[An older walk finishes after the operator presses Refresh]** → Preserve the newer per-lane manual intent until its authorized pass reaches a terminal outcome; never let the old completion advertise ready in between.
- **[An exchange event lands while manual loading is visible]** → Persist its debt against the last exchange-backed resource, not the live provisional loading frame, so restart-safe invalidation never stores process-local UI intent.

## Migration Plan

1. Add the canonical row module and v2 resource/store shape, with read compatibility only for provably valid v1 caches.
2. Implement transactional production commit semantics and content generation.
3. Extend IPC/hook/UI with dual-read support, then remove the legacy frame.
4. Make manual refresh publish compound resource outcomes.
5. Only afterward add/update first-page failure, failed verification, expired cache, same-count correction, unsafe ID, trigger-seam, and UI-state tests.
6. Run live failure/recovery probes before archive. Rollback invalidates v2 cache and performs a fresh read; confirmed exchange data remains the authority.
