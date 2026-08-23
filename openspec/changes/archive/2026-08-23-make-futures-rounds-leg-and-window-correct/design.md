## Context

See `proposal.md` for motivation. Fill payloads carry `positionSide`, but the round engine groups only by symbol and persists one running exposure. Current account-trade reads keep the newest 1000 fills per symbol, while the fold tries to infer unknown left-boundary state from reported PnL. Open settled PnL reuses those fills but does not proactively acquire them for current positions.

## Goals / Non-Goals

**Goals:**

- Give every hedge leg and one-way exposure an unambiguous identity and state machine.
- Make the evidence/coverage supporting a round first-class rather than implicit.
- Fetch only enough older history to prove a current position or requested review.
- Keep fill-derived current settlement synchronized without UI-tab side effects.

**Non-Goals:**

- Attributing contract-level funding to a hedge leg; that belongs to `make-futures-wallet-net-additive`.
- Claiming history older than Binance retention.
- Downloading complete six-month trade history for every symbol at startup.

## Decisions

### 1. Introduce a canonical position key

Normalize every fill and snapshot into `{symbol, leg}` where hedge `LONG`/`SHORT` remain independent and one-way input is `BOTH`. Round keys include this position key plus the opening fill identity/generation. No fallback maps `LONG` and `SHORT` back to symbol-only state.

The round engine runs one deterministic state machine per position key. One-way `BOTH` keeps signed exposure and can split a reversal into a closed round and opposite live remainder. Hedge state uses leg semantics: an execution on one leg never consumes the other.

### 2. Carry evidence and coverage beside each fold

Persist `coveredFrom`, `coveredTo`, `pageLimited`, `retentionLimited`, and continuity as one contract-level acquisition proof, because `/userTrades` enumerates a contract window rather than a hedge leg. At fold time, project that immutable proof to every same-generation position key named by either retained fills or the authoritative position snapshot. `flatBoundary` and `terminalReconciled` are derived per-key facts and are not independent durable REST checkpoints. A snapshot-only key still inherits the contract's retention/page/continuity evidence even when no retained fill can supply its basis. The fold returns resolved rounds plus unresolved segments; it does not coerce unresolved segments into rows. A response of exactly the endpoint limit sets `pageLimited` until an older request disproves truncation.

Snapshot admission is fail-closed per canonical key. More than one snapshot row for the same `{symbol, leg}`, or a row whose present quantity cannot be parsed exactly, records an invalid key rather than choosing a last row or treating it as absent. That key cannot terminal-reconcile or supply a reverse-flat proof; permutation therefore cannot turn contradictory account evidence into an authoritative zero.

An unreadable row with enough symbol/leg evidence to belong to a position key is a continuity barrier for that key. It cannot be discarded while later fills are folded as exact; a reliable valid copy of the same trade identity may replace the malformed projection, otherwise the key stays unresolved until canonical reacquisition replaces the compromised sequence. A row whose key cannot be established bars the whole supplied batch because its ownership is unknowable.

Repeated reliable identities merge monotonically only when every field present in both copies agrees. A sparse stream projection may therefore gain missing REST evidence, but two different present quantities, prices, sides, times, realized amounts, fees, or assets for one identity are a continuity conflict rather than a last-write-wins update.

That conflict evidence must survive the bounded persistent cache as well as the in-memory fold. The cache deduplicates byte-for-byte-equivalent evidence for one reliable identity, but retains distinct bounded payload variants for that identity. Retention therefore counts stored evidence variants while the forward cursor remains the highest reliable exchange identity; a renderer restart cannot convert an already observed contradiction into whichever payload happened to be written last.

On restore, individually canonical but conflicting variants are still not proof of a contiguous canonical history. The rows remain present for audit and deterministic Conflict presentation, while the contract's restored trade cursor and coverage are cleared. The next authenticated basis read therefore takes the existing bounded cold-reacquisition path, which can atomically replace the compromised cache with one clean exchange enumeration instead of paging forever beyond the bad identity.

That comparison also applies when one copy cannot form a complete canonical fill. A valid copy may replace an incomplete projection only when every field that is still readable on the incomplete copy agrees. The implementation therefore retains a bounded partial-evidence view for duplicate comparison; it does not discard the entire malformed object and suppress its contradictions merely because another copy with the same symbol and trade ID exists.

Presence is distinct from validity during that merge. An omitted realized-PnL, commission, commission-asset, or settlement-asset field may be enriched by a compatible canonical copy, but a present value that cannot satisfy its bounded canonical domain is conflicting evidence. It must compromise the position fold instead of being treated as sparse and replaced with the other copy's value.

The fold also applies the shared trade-history asset normalizer independently of REST/store admission. This defense-in-depth boundary prevents a retained, streamed, injected, or future caller with optimistic coverage metadata from promoting an arbitrary or unbounded asset string to a resolved denomination or fee bucket. A malformed settlement asset makes trade coverage incomplete; a malformed present commission asset makes commission coverage incomplete even when another layer should already have rejected it.

### 3. Replace percentage tolerance with exact decimal evidence

Preserve exchange decimal strings through parsing and perform quantity/PnL consistency with fixed-scale integer or rational arithmetic. The allowable comparison error is derived from contract tick/step and settlement-asset precision for the fills involved. One percent of notional is never a rounding bound.

The same exact realized-PnL text reaches Closed presentation. The renderer rounds that text directly to a signed cents glance value without a JavaScript `Number`, while keeping the unchanged exact decimal and proven asset on the PnL element. A non-zero sub-cent amount that would appear as zero keeps its exact text instead. A sub-cent value or integer beyond JavaScript's safe range therefore cannot silently change the underlying evidence even though the compact cell follows the operator's cents-at-a-glance rule.

Closed reconciliation keeps one explicit `PnL` column whose glance value is Binance's exchange-reported realized amount. The element's accessible title carries the exact decimal, proven asset, and canonical additive wallet result when evidence is complete (or its qualified subtotal otherwise). Fee, funding, insurance, credit, asset, and coverage explanations remain on that element or the shared group rather than becoming separate `Gross`, `NET`, or component columns.

This avoids adding a floating-point epsilon whose economic size grows with the trade. If precise evidence is unavailable, the state is unresolved rather than guessed.

Apply a generous fixed size/scale limit before decimal regex and `BigInt` construction. JavaScript numbers rendered in scientific notation are not converted with `toFixed`, because that can round a real fee or realized amount to zero while still labelling coverage exact; those values are unsupported evidence and fail closed. Binance's normal string decimals remain exact and far inside the bound.

The raw-evidence rule does not apply a second time to a presentation `Number` produced from a ratio the fold already parsed exactly. Terminal reconciliation safely expands that internal bounded decimal representation, so a valid `0.0000001` entry is not rejected merely because JavaScript displays it as `1e-7`.

### 4. Backfill bounded time slices toward a proven flat boundary

For a position key that lacks a boundary, request older account trades in bounded time slices, narrow any page-limited slice until it can be fully enumerated, normalize/sort/deduplicate, then prepend it. Stop at a proven flat state, retention, cancellation, or a declared request budget. The current-open-position basis has priority over an operator review, while admission fairness remains unchanged.

Returning to zero during a forward fold whose left edge is unknown is not a flat-boundary proof: an omitted earlier exposure can make that zero accidental. An early REST stop is allowed only when reverse reconciliation starts from a current complete position snapshot owned by the same Futures activation, treats an absent contract leg as terminal zero only under that complete snapshot, and unwinds a fully enumerated contiguous newest suffix with bounded exact-decimal quantities. Every canonical position key encountered for the contract must reach exact zero at the same enumerated slice boundary. A malformed quantity, mixed one-way/hedge topology, stale/loading snapshot, activation change, reconnect, or fill/activity revision rejects the proof.

The successful proof stores the slice boundary on the v2 contract coverage and leaves the original frozen `targetFrom`/`targetTo` visible. It does not set whole-target `complete=true`; `flatBoundary` is the narrower proof that qualifies rounds at or after that edge. While the authenticated stream proof remains current, automatic basis selection may vouch for that stopped suffix without immediately starting the same older work again. The reader may discard only pending slices strictly older than that boundary. If the proof later races before atomic acceptance, it is cleared and the same checkpoint resumes the unchanged fixed target; page, request, retention, and cancellation accounting are never reset by a failed proof. Until this production proof exists, acquisition keeps its fixed bounded target and explicit request/retention limits; the fixed seven-day target is a safe fallback, not evidence that the minimum basis was acquired.

This approach is chosen over blindly following `fromId`, which fetches forward and cannot be combined with time bounds, and over loading all six months on every activation.

### 5. Reconcile terminal state with the account snapshot

After folding, compare each current key's leg, signed/leg quantity, and entry basis with the same-generation account snapshot. A mismatch invalidates terminal certainty and schedules one gap/backfill reconciliation. Persisted rounds from a previous position generation are not reused merely because the symbol matches.

### 6. Maintain fills from both stream and REST through one identity map

Normalize execution reports into the same fill identity as REST. Insert them immediately and idempotently. Detect missing continuity/unknown identity and coalesce a targeted REST gap read. The default Working tab no longer controls whether settlement data is current.

The shared stream projection includes the compact `ma` margin-asset field as the same trimmed uppercase `marginAsset` evidence used by REST. Omitting it would deliberately make an otherwise complete execution sparse, downgrade settlement coverage, and force a redundant REST read to recover data the authenticated stream already supplied.

Held history already distinguishes stream-only trade identities from REST-confirmed rows. The renderer projects contract coverage to each position key and caps that key's `coveredTo` immediately before its earliest still-folded fill. This keeps rounds wholly before the raced suffix exact, while any round touching the suffix stays unresolved until the gap response absorbs the identity and removes its folded marker. Merely sharing a millisecond with the previous frozen window is therefore not treated as proof that the new execution was enumerated.

Only an actual fill advances fill-history activity. Pure order lifecycle reports still fold working-order state, but do not invalidate a frozen history proof or buy a REST repair merely because they share the execution-report envelope.

The renderer holds a separate monotonic trade-evidence revision alongside the composite history generation. A canonical trade read or streamed fill advances that revision; an order-only response, discovery clock, error, or observation-only history update does not. The history reducer also retains the untouched endpoint's row/folded collections by reference instead of filtering and sorting them again. The memoized fill/coverage snapshot is keyed to the trade revision, so order history can update without rematerializing the fill collection, rebuilding the bounded round index, or rerunning wallet reconciliation. Position fields used for terminal reconciliation remain an independent invalidation input.

### 7. Treat settlement asset as round evidence

Preserve the uppercase `marginAsset` supplied by account trades and carry it through canonical fill storage and round derivation. A resolved round requires every contributing fill to name one consistent settlement asset. Missing or conflicting asset evidence leaves that round unresolved; commission asset or the symbol suffix is not a substitute for the exchange field.

Persisted trade rows created before this evidence existed remain displayable only as unverified input. Their identity cursor must not bless them as current: the backend performs a bounded frozen-window reacquisition and replaces the contract only after it proves the new basis and its forward gap.

Commission asset is canonical fill evidence too. It is trimmed and uppercased once beside the settlement asset, then that same normalized value drives commission completeness, exact fee buckets, and settlement-fee subtraction. The fold does not re-read the raw field under different normalization rules.

### 8. Give transactional acquisition one owner and one commit point

Each renderer connection owns its history checkpoints, pending symbols, timer, queue, and disposed/generation token. Shared REST admission and stream activity remain account-global, but a renderer switching market or closing cannot clear or emit another renderer's repair.

Cold, legacy, ordinary forward-gap, Full, and post-gap failures use bounded backend checkpoints. React initiates the current-position basis read but does not schedule a competing continuation. A frozen replacement is committed only when stream connected/epoch/activity topology is unchanged and REST has reached every stream-observed fill identity for that symbol. Until then rows merge additively and coverage remains incomplete.

### 9. Bound the durable cache to the active fingerprint

The IndexedDB schema is advanced when namespaced v2 history becomes authoritative, invalidating legacy symbol-only records that cannot prove account or settlement-asset ownership. Every composite write then prunes records outside the authenticated fingerprint as well as excess current-account contracts before writing the retained set. The physical store therefore holds at most the current account's 24 newest contracts; changing or rotating credentials replaces that cache instead of accumulating another 24-record namespace.

This deliberately trades warm switching between credentials for a hard storage/memory bound. The application authenticates one Futures account at a time, while every `getAll` would otherwise clone every old account's rows before filtering them. Account isolation is preserved because reads still require the exact fingerprint, and the current account keeps its full 24-contract allowance.

### 10. Commit shared symbol discovery monotonically

Every income-backed traded-symbol discovery receives a process-local issue sequence. A successful persisted/discovered candidate may replace the shared cache only when no later-issued candidate has already committed. An older crossed response may still answer the renderer/session that owns it, but it cannot rewind the cache used by later reconnect and rotation reads. Clearing account history advances a commit fence as well as clearing the cache, so work issued before the reset cannot restore retired state.

The sequence orders cache publication only. Renderer activation generation, session disposal, and credential fingerprint remain the authority for whether a request may continue or emit; discovery ordering does not create cross-renderer ownership or relax account isolation.

### 11. Retain checkpoints only while another bounded attempt is eligible

A per-renderer acquisition checkpoint exists only while it carries progress into an allowed continuation. When cold, Full, basis-gap, or post-gap acquisition reaches its declared retry bound, the final response remains additive/incomplete and the checkpoint is deleted instead of becoming unreachable terminal memory. A later explicit request may begin a new acquisition with a new target and retry budget; no automatic timer is armed for the exhausted work.

### 13. Bound cumulative REST pages per frozen acquisition

The per-pass trade-window subdivision bound is not a transaction bound: a dense Full/cold window can retain a checkpoint and spend the same page allowance again on every continuation. Each transactional checkpoint therefore accumulates successful `/userTrades` page requests across passes and has a hard 16-page lifetime budget. A continuation passes only the remaining allowance into its window readers; when both the frozen right seam and older backfill are required, one page is reserved for the right seam and the remainder is assigned to the older boundary search.

Reaching the cumulative allowance without proving the frozen window marks coverage `retentionLimited`, keeps the evidence additive/incomplete, and evicts the checkpoint without another timer. A later explicit request receives a new target and a fresh budget. This bound is per symbol and per renderer-owned checkpoint; it does not merge account identities or let one renderer consume another renderer's transactional state.

### 12. Use one IndexedDB transaction as the persistence concurrency boundary

A renderer-local promise queue cannot protect the same database from another renderer or another store instance: both can read the same old contract, independently merge one endpoint, and let the last sequence of puts erase the other's evidence. The default persistence path therefore performs `getAll`, composite merge/global pruning, deletes, and retained puts in one `readwrite` transaction. IndexedDB serializes overlapping read/write transactions, so every update plans from the latest committed state while transaction abort preserves the previous state atomically.

The transaction replaces up to dozens of individually opened delete/put transactions with one connection and one commit. That connection is explicitly closed after completion, abort, or error. The injectable `readAll`/`write`/`remove` adapter path remains supported for tests and alternate stores, but production selects the atomic mutation path unless those legacy adapters are supplied.

### 14. Admit `/userTrades` only as bounded canonical pages

The adapter bounds and canonicalizes every field before trimming, uppercasing, numeric conversion, duplicate signatures, or renderer/persistence handoff. Trade and order identities remain exact digit strings; symbol, side, leg, and assets use small canonical text domains; exchange money remains fixed-decimal text within the fold's size/scale domain; time is a safe non-negative integer. Price and quantity must be positive, commission non-negative, and a non-zero commission must name its asset. Scientific notation, raw numeric money, wrong types, missing essential evidence, and a response symbol different from the requested contract reject the whole page.

Optional endpoint time bounds use a strict tri-state: undefined, null, and blank mean omitted; a valid safe integer is sent; any other present value fails before transport. The bounded window still requires both of its own edges. It also receives the expected contract and validates the complete logical page before mutating rows or coverage. Consequently the forward-identity gap path and frozen-window path share one admission contract, and neither can persist a malformed row with a v2-complete claim.

The canonicalizer and validator live in a dependency-free shared utility rather than in the Electron reader. Persistent v2 restore calls that same validator for every held trade. It does not delete malformed rows—the unresolved fold and audit surface still need the evidence—but a single invalid held trade makes that contract's settlement evidence non-current, clearing its restored trade cursor and v2 coverage so REST reacquisition cannot be skipped.

The bounded window rejects an array longer than its admitted page size with `OVERSIZED_TRADE_PAGE` before iterating a row or mutating the candidate map. Its injectable `PAGE_SIZE` and `MAX_REQUESTS` are test/narrowing seams, not authority to widen production: each is clamped to `1..FUTURES_TRADE_HISTORY_WINDOW.<ceiling>`. This keeps one malicious answer or oversized caller-supplied limit from bypassing the declared memory/request bounds.

This deliberately does not add a transport-wide body cap in this change. Field checks occur immediately after JSON parsing and prevent oversized values from entering repeated canonicalization, sorting, renderer cloning, or IndexedDB; a response-stream byte ceiling has different limits for every Futures endpoint and requires a separate transport-wide design.

### 15. Restore is a trade-evidence mutation

The empty held-history state intentionally starts at trade revision zero. A valid persisted v2 snapshot is different evidence even when its general generation starts at one, so restore assigns trade revision one explicitly. This preserves the order-only reference/memo optimization while ensuring a hook that already memoized the empty revision cannot retain an empty Closed index after IndexedDB supplies fills.

## Risks / Trade-offs

- **[More REST traffic on old open positions]** → Request only current keys lacking boundaries, persist progress, stop at flat, and expose the bound instead of looping.
- **[Mode changes or malformed `positionSide`]** → Fail the affected key unresolved; never merge an explicit hedge leg into `BOTH`.
- **[Persisted schema is incompatible]** → Version the held history/coverage record and rebuild derived rounds from canonical fills.
- **[Credential rotation leaves old account rows in IndexedDB]** → Purge legacy/foreign namespaces during schema migration and every current-account composite write; retain only the active fingerprint's 24 newest contracts.
- **[Snapshot reconciliation races a new execution]** → Compare activation/account generations and retry after the execution fold rather than marking a cross-generation mismatch.
- **[A stream fill is visible before REST indexes it]** → Retain the highest observed fill identity and defer atomic replacement until REST reaches it or the bounded repair remains explicitly incomplete.
- **[Two renderers request the same basis]** → Isolate transactional ownership per renderer; shared rate admission bounds duplicated account reads without allowing one connection to steal another's result.
- **[Crossed discovery responses rewind shared cache]** → Order successful cache commits by issue sequence and fence pre-reset work without changing the owning renderer's response.
- **[Many terminal symbols grow session memory]** → Delete exhausted checkpoints immediately after the final incomplete outcome; a later operator request starts fresh rather than reviving a dead checkpoint.
- **[Dense Full/cold history multiplies the per-pass REST cap across continuations]** → Accumulate successful pages on the checkpoint, pass only the remaining 16-page allowance into each continuation, and finish unresolved at the bound.
- **[Two renderers persist complementary evidence at once]** → Serialize their read/merge/prune/write operations with one IndexedDB `readwrite` transaction per composite update; close each connection after settlement.
- **[Binance returns a malformed user-trade page]** → Reject the page before coverage/cache mutation and retain the previously confirmed rows; surface a bounded acquisition failure rather than persisting guessed money.
- **[One user-trade field is extremely large]** → Check type and length before trimming, regex, uppercase, numeric conversion, or signature creation; keep a transport-wide response cap out of this endpoint-scoped change.
- **[A user-trade answer contains more rows than requested]** → Reject it before row iteration with `OVERSIZED_TRADE_PAGE`, and clamp injected window limits so they can narrow but never widen production ceilings.

## Migration Plan

1. Add canonical position keys and coverage metadata at normalization/storage boundaries.
2. Implement production per-key folding and unresolved output, then switch open-round and Closed Positions consumers.
3. Add targeted basis/backfill orchestration and execution-report insertion.
4. Invalidate old symbol-only or settlement-asset-less evidence and reacquire its bounded canonical fill window.
5. Only after production code is in place, add hedge, page-limit, break-even, reversal, persistence, and gap-read tests.
6. Verify simultaneous live LONG/SHORT and one-way reversal against operator data before archive. Rollback disables the new derived index and rebuilds from preserved fills.
