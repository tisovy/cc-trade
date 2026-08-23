## Context

See `proposal.md` for motivation. Reverified on 2026-08-22 against Binance's official [Get Income History](https://developers.binance.com/docs/derivatives/usds-margined-futures/account/rest-api/Get-Income-History) contract: it documents inclusive `startTime`/`endTime`, explicit `page`, a maximum `limit` of 1000, IP weight 30, the recent seven days when no bounds are supplied, and roughly three months of retained data. It does not document response ordering, so no coverage decision may depend on observed order. The current implementation always asks for page 1, infers direction from returned rows, advances millisecond cursors, and queries six filtered types for every trigger.

This change depends on the truthful resource/coverage frame from `make-settled-income-resource-truthful` and on per-attempt weight accounting from `charge-every-binance-retry-weight` for final budget assertions.

## Goals / Non-Goals

**Goals:**

- Enumerate a fixed income window without timestamp-peer loss or ordering assumptions.
- Track and refresh required income types independently.
- Reduce event-triggered weight while preserving eventual verification.

**Non-Goals:**

- Reading derivable `REALIZED_PNL` and gross `COMMISSION` as substitutes for fills.
- Promising attribution for rebate rows until their live `symbol`/`tradeId` shape is measured.
- Exceeding documented retention to synthesize old coverage.

## Decisions

### 1. Give each income type an independent lane

Each required type owns `{coveredFrom, coveredTo, targetTo, nextPage, status, successfulAt, error}` and its canonical row map. Aggregate resource completeness is the conjunction only of lanes required by the consumer. Store records lane state so one failure cannot advance or erase another.

### 2. Page a frozen inclusive target window

At walk start, freeze `[startTime, endTime]` and request `page=1..N` with the documented maximum limit for one income type. Continue until a short/empty page, explicit bound, or failure. Normalize/deduplicate every page, then sort canonical rows locally. Never move either time bound merely because a page is full.

Freezing `endTime` prevents new later events from shifting the target during the walk. Periodic verification handles late-posted rows whose event time falls inside an already-read window.

### 3. Do not infer coverage from row order

Coverage comes from successfully enumerating the requested pages for the fixed window. Ascending/descending observations remain diagnostics only. If enumeration is bounded before a terminal page, the lane is partial against its unchanged target.

### 4. Map triggers to lanes and coalesce confirmations

- `FUNDING_FEE` user event: immediate funding tail plus one funding confirmation.
- Any execution: coalesced delayed reads for the four underivable commission-credit lanes, including zero-realized opening fills.
- Insurance/liquidation evidence: insurance tail.
- Startup/manual refresh: stale/missing lanes required for current surfaces.
- Periodic verification: rotate/reconcile every required lane within the declared interval.

Activation bootstrap is the sole cold-start owner of the all-lane read. Opening or reopening the private user-data stream still refreshes account resources, but it does not independently enqueue the same all-lane income pass: the socket carries future change evidence, while bootstrap already covers history that predates it. This avoids a second 180-weight pass when the handshake finishes after the bootstrap debounce; later funding, fill, insurance, manual, continuation, and periodic triggers retain their narrower or deliberate reads.

One unfiltered all-income request was considered because its weight is also 30, but dense derivable realized/commission rows can consume the 1000-row pages and make sparse underivable coverage ambiguous. Filtered per-lane reads are retained, narrowed by reason.

### 5. Make request budgets executable assertions

Define budgets in physical request weight, not logical pages. At minimum record event reason, bounded lane/page/read counts, physical attempts, charged weight, coverage gained across the requested lanes, and deferred work. Funding's one-page immediate read is 30 when it succeeds without transport/time recovery rather than an assumed 30 regardless of attempts, and remains 30 rather than 180 from unrelated lanes. Confirmations and verification have separate caps. Admission may defer low-priority verification but never label it complete.

The generic physical-operation summary is aggregated into the existing one-line settled-pass diagnostic through an observational per-call callback. Underivable-credit shape is reported only as row counts plus counts with a non-empty symbol and/or reliable trade identity. Identity values, rows, URLs, signed material, credentials, headers, exchange messages, and monetary amounts never enter this production record or the probe's acquisition-shape summary. The separate, explicitly invoked wallet-reconciliation section of the maintained live probe prints per-asset money because direct operator comparison is its purpose; it remains outside production logging and never prints credentials, signed material, headers, raw rows, or raw identities.

The diagnostic reason remains a closed vocabulary and is exhaustive for the production literals `bootstrap`, `stream`, `fill`, `funding`, `settlement`, `refresh`, `confirm`, `credit-confirm`, `insurance`, `insurance-confirm`, `verification`, `extension`, and `tick`. A new scheduler literal must update this contract and its exhaustive regression rather than turn a valid pass into a silently discarded record.

### 6. Measure rebate shape before tightening ownership

Extend the existing probe to report bounded counts of symbol/trade-identity presence per rebate type without logging sensitive rows. The ownership change consumes those facts but remains truthful when fields are absent.

The probe uses `walkFuturesSettledIncomeLanes` with the same filtered income types, fixed inclusive target, explicit page numbers, canonical validation, row/page ceilings, and continuation checkpoints as production. It may supply its own read-only HTTP transport, but it does not implement a parallel timestamp cursor or unfiltered union walk. The operator comparison therefore fails closed with per-lane coverage/error evidence when acquisition is incomplete instead of silently comparing a lossy sample against the application.

### 7. Scope terminal cooldown to the lane that failed

A deterministic terminal response for one filtered income type suppresses only automatic reads of that lane for the reconciliation interval. Other due lanes continue. Manual refresh and full verification may probe all lanes deliberately. Only a response explicitly classified as account/IP-wide may establish a global backoff. Once established, that account-wide floor is cleared only by a deliberate all-lane pass whose requested lanes return successful resource answers. A timeout, empty answer, or different refusal without another 418 does not prove the account/IP-wide condition recovered and therefore cannot reopen automatic event/tick pressure.

### 8. Bound cumulative lane evidence, not only each pass

Each fixed-window lane has a `MAX_ROWS_PER_LANE` ceiling shared by every resumed page of that target. Per-pass page caps remain an admission bound; they are not a memory bound because `pending.rows` survives into the next pass. If a non-terminal page reaches the cumulative ceiling, or committing a terminal page would make the retained lane exceed it, the walker keeps a deterministic newest-first bounded set of real rows, clears unproven coverage, sets `complete=false` with `ROW_LIMIT_REACHED`, and removes `pending` so no continuation timer repeats the oversized enumeration.

An explicit row/page resource ceiling is a failed lane outcome for aggregate diagnostics as well as an error stored on that lane. The walker-level `failed` signal therefore becomes true for a refusal, page-target ceiling, or row-retention ceiling; `partial` remains reserved for healthy bounded continuation or truthfully incomplete coverage without a failed page/resource outcome.

The bounded rows remain useful partial evidence, but the resource is not eligible for exact Net. This is chosen over silently dropping overflow and calling the window complete, and over persisting an arbitrarily large checkpoint that would be synchronously stringified and parsed on the Electron main process.

`ROW_LIMIT_REACHED` also enters the existing per-lane automatic reconciliation cooldown. Otherwise the generic one-minute incomplete-resource tick would restart the same frozen enumeration from page one even though its continuation checkpoint was removed. Manual refresh and full/hourly verification keep their existing cooldown bypass so an operator or later bounded policy can probe recovery deliberately, and no other lane inherits this local stop.

### 9. Bound every frozen target and validate every answered page

The per-pass page budget controls scheduler admission but does not bound a checkpoint resumed by later passes. Each frozen lane target therefore also owns a cumulative `MAX_PAGES_PER_TARGET` ceiling derived from its persisted `nextPage`. A terminal short page may complete the target only at or below that ceiling. If another full page reaches the ceiling, the walker removes the continuation, retains the previous confirmed lane rows and coverage, sets `complete=false`, and reports `PAGE_LIMIT_REACHED`. Repeating the same full duplicate page can therefore consume only the declared finite number of physical requests for that target.

Before adding a page to its pending candidate map, require an array no larger than the exact requested page limit, validate every raw row through the canonical boundary, and then require a non-empty settlement asset, the requested income type, and a timestamp inside the exact inclusive target. The HTTP adapter rejects an over-requested array before mapping it, and the walker repeats the check before iterating so an injected/custom adapter cannot bypass the resource budget. `INVALID_INCOME_PAGE`, `OVERSIZED_INCOME_PAGE`, `INVALID_INCOME_ROW`, `INCOME_TYPE_MISMATCH`, and `OUT_OF_WINDOW_RESPONSE` are failed page outcomes, not silence or rows to skip. A repeated reliable identity is deduplicated only when all canonical row fields agree; conflicting content fails with `CONFLICTING_INCOME_IDENTITY` instead of making the selected amount depend on page/response order. The pending page is discarded transactionally and confirmed coverage does not advance. Consumer predicates may still intentionally filter an otherwise valid canonical row after page validity has been established.

Transport silence remains distinct from a malformed answered container. A `null` or `undefined` page is `EMPTY_ANSWER`, retains confirmed lane evidence, and follows the existing bounded transient-confirmation retry policy. An answered object whose `rows` is not an array is `INVALID_INCOME_PAGE`: it also retains confirmed evidence, but cannot masquerade as transient transport silence or terminal empty coverage.

Every injected walker limit is a narrowing test/configuration seam, never authority to widen production work. Page size, pages per pass, cumulative pages per frozen target, retained rows per lane, and tail overlap are independently defaulted and clamped to their declared production ceilings. Supplying a partial limits object therefore cannot disable acquisition through `undefined` arithmetic, while an oversized value cannot expand memory, persistence, IPC, or physical-request budgets.

### 10. Persist delayed-confirmation debt per lane

A private-stream funding or fill event invalidates confirmed history before the delayed confirmation read is allowed to run. That obligation is durable lane state, not merely an in-memory timer: each affected lane stores an optional `confirmationNotBefore` deadline in the canonical resource. A lane with this field cannot be `ready` or complete, and the field participates in the resource digest and persisted/IPC representations.

Before an early stream event persists invalidation, the main process synchronously restores the existing account-scoped resource once so it cannot overwrite a valid cache with the initial empty resource. On restore it rebuilds the in-memory confirmation set and re-arms the remaining per-family delay. Reads started before the persisted deadline preserve the stale lane even if their endpoint walk succeeds. Only a successful pass whose captured start time is at or after the deadline clears both the durable debt and the in-memory marker; a failure retains them and follows the existing bounded confirmation retry path. This deliberately prefers a conservative extra stale interval over a false exact Net during restart or timer loss.

Writing the complete bounded ledger for every partial fill would synchronously stringify and rename the same multi-megabyte resource once per millisecond. Durable debt therefore rounds its persisted `targetTo` upward to the next one-second boundary and stores `confirmationNotBefore = roundedTarget + confirmationDelay`. Before constructing a canonical lane, invalidation compares only the next scalar target, deadline, stale status, and completeness with the held lane. An event already covered by those scalars returns the original lane reference without cloning or canonicalizing its retained rows. The first event entering a bucket writes immediately; later events already covered by the same conservative target do not clone the lane, move the content digest, or rewrite the file. Crossing a boundary performs the next immediate canonical transition and write. The exact in-memory event marker is never rounded and still replaces the live timer to `newestEventAt + confirmationDelay`; while the process is alive it may confirm at that exact time, while restart conservatively waits at most one extra second. This ordering means a crash after a later same-bucket event still inherits a deadline no earlier than that event's required delay.

An in-flight walker owns exchange evidence, not the resource revision clock. When it completes, confirmation debt is reapplied from the exact current in-memory markers and the candidate is finalized relative to the current global resource rather than the snapshot passed into the walker. A digest equal to the current resource keeps its current generation; changed content advances from that current generation. This prevents a sequence such as generation 7 walk, generation 8/9 invalidations, generation 8 completion-with-different-digest. Confirmation debt always canonicalizes to `stale`, including an empty lane; `loading` remains reserved for acquisition without a known invalidation debt.

Absolute wall time can move backward between the invalidation write and restart. Restore therefore authenticates the original snapshot digest before applying clock-relative policy. A future target is tolerated only on a debt lane and only when its displacement from the new clock fits inside the persisted `confirmationNotBefore - targetTo` interval. That target and deadline are obligations, not coverage, so they survive; rows beyond the new clock are removed, coverage is clipped to the new clock or cleared, a future continuation is discarded, and future attempt/success clocks are cleared. Any future authority without that bounded debt relationship, especially a `ready` lane, still rejects the whole stored resource. This avoids both losing durable debt on a small clock correction and promoting a future snapshot as exact.

### 11. Recheck activation at physical settled-income admission

Each settled-income pass captures the Futures activation generation that owns it and supplies that ownership predicate to the existing physical-attempt limiter. The limiter rechecks it after a queued reservation and immediately before transport creation. The existing checks before the logical page call and after the lane walk remain defense in depth: an already-retired pass cannot start a physical request, and a request already sent before deactivation cannot publish, persist, or clear state after its answer returns.

This guard belongs at the settled-income call site rather than changing the shared limiter or lifecycle functions. The shared limiter already defines the admission boundary for all Futures transports; passing the captured predicate makes that boundary account-aware without changing retry, priority, or cancellation semantics for its other callers.

### 12. Separate event invalidation, acquisition work, and confirmation timing

A funding, fill, or insurance witness first creates and persists its lane confirmation debt and replaces the family timer. Scheduler cooldown, account-wide backoff, and ordinary due checks are decisions about whether REST may run now; they do not decide whether the known exchange event happened. If the dedicated confirmation timer reaches its deadline while a lane or account backoff still prevents admission, the timer is re-armed for the earliest bounded eligibility instant and the durable stale obligation remains authoritative.

Confirmation timer payloads and single-flight queues are scheduling hints, not durable authority. Immediately before scheduling REST work, the scheduler intersects their captured confirmation-only lane set with the current in-memory confirmation-debt map. It carries a separate set for lanes independently requested by a new event, manual read, verification, or continuation; upgrading the human-readable reason never changes that provenance. Lanes already repaid by a successful manual, verification, or sibling pass are removed unless a distinct non-confirmation request still needs them; a confirmation request with no current debt is discarded. A re-armed family timer may use the family to choose one clock, but it re-evaluates the family at fire time rather than re-reading siblings that became exact while the timer waited. This prevents a redundant failed confirmation from degrading newly confirmed evidence without dropping genuinely new work.

The ordinary account `tick` is an acquisition repair, not a second confirmation clock. It selects only lanes that are incomplete for a reason other than `confirmationNotBefore` and are not already loading. A resource whose only incomplete lanes are waiting for their event deadline therefore spends no income request weight on the tick; if another lane has a genuine acquisition gap, only that lane is requested.

The scheduling debounce repeats the same debt intersection immediately before it hands work to the single-flight runner. Confirmation and non-confirmation provenance is carried explicitly through the in-flight follow-up queue and back into the next debounce, rather than inferred from the upgraded reason. This closes both the short fast-pass race and the reason-coalescing race; captured confirmation lane names never outrank the current debt map, while newly witnessed event lanes remain runnable.

`targetTo` remains the newest acquisition target and may advance during bootstrap, continuation, or manual verification. `confirmationNotBefore` is instead `roundedEventTarget + confirmationDelay`, conservatively preserving any existing later event deadline. Reapplying debt after a walk or restart may widen acquisition coverage but cannot derive a new deadline from that widened target. This keeps repeated pre-deadline restarts from resetting the same two-minute obligation.

## Risks / Trade-offs

- **[Page contents shift because Binance posts a late row inside the frozen window]** → Canonical dedup plus periodic overlap verification; never claim immutable exchange history.
- **[Many pages in one lane starve commands]** → One page per admission turn, bounded pass, and existing fairness/command priority.
- **[Lane store increases state size]** → Rows are still canonical/deduplicated and retained only inside the supported window.
- **[A dense rebate lane exceeds the retained-row ceiling]** → Preserve a bounded newest-first evidence set, fail the lane explicitly incomplete, and stop continuation rather than growing memory, disk, and IPC payloads without limit.
- **[The endpoint repeats a full page or ignores `page`]** → Stop at the cumulative frozen-target page ceiling with `PAGE_LIMIT_REACHED`; never let a persisted continuation turn a per-pass budget into unbounded requests.
- **[A malformed row would otherwise look like exchange silence]** → Reject the whole page transactionally and retain the last confirmed lane rather than publishing exact but short Net.
- **[An adapter coerces or over-returns a page]** → Require the exact array container and requested row ceiling before normalization in both adapter and walker; never reinterpret malformed transport as empty success.
- **[One reliable identity is returned with conflicting values]** → Accept only byte-equivalent overlap; fail the frozen lane transaction rather than choosing whichever response arrived last.
- **[Rare credit appears later than the coalesced confirmation]** → Hourly/periodic verification remains the eventual reconciliation backstop.
- **[The process exits between invalidation and delayed confirmation]** → Persist the lane deadline immediately, restore stale state and the remaining timer, and require a successful post-deadline pass before clearing it.
- **[Wall time steps backward between invalidation and restart]** → Verify the persisted digest first, preserve only a target inside its own confirmation interval, and fail closed by degrading future evidence while retaining stale confirmation debt; reject future authority without debt.
- **[A fill burst would synchronously rewrite the full ledger per millisecond]** → Persist the first upward-rounded one-second debt bucket immediately, reuse it for covered events, and keep the exact newest timestamp only in memory for the live timer.
- **[An old walk completes after newer event invalidations]** → Reapply exact current debt and finalize against current global content/generation so the commit cannot regress generation or reuse one generation for a different digest.
- **[An income page waits in the limiter while Futures deactivates or the account changes]** → Recheck the captured activation at physical admission so the retired pass cannot create transport or mutate the next activation's resource.
- **[An event arrives during endpoint cooldown or account backoff]** → Persist the debt first and re-arm its dedicated timer at the earliest eligible instant; do not let admission policy erase exchange evidence.
- **[A generic account tick sees debt-induced incompleteness]** → Exclude debt/loading lanes and spend weight only on an independent acquisition gap.
- **[Bootstrap advances a lane before its confirmation deadline]** → Advance `targetTo` independently while retaining the original event-derived deadline across completion and restart.
- **[A queued or re-armed confirmation outlives its debt]** → Intersect captured lanes with current debt immediately before scheduling REST and drop a fully repaid confirmation instead of re-reading or degrading exact siblings.
- **[Same-bucket fills repeat against a dense ledger]** → Compare scalar debt state before constructing a lane so covered events do not clone/canonicalize retained rows.
- **[A recovery probe fails differently from the original 418]** → Keep the account-wide automatic floor until a full deliberate pass returns successful lane authority; absence of a repeated 418 alone is not recovery proof.

## Migration Plan

1. Add lane state to the production store/resource while reading the old union as unverified input.
2. Implement the fixed-window page-number walker and switch one lane at a time, starting with funding.
3. Replace all-six trigger mapping with reason-specific invalidation and coalescing.
4. Add production budget diagnostics and the aggregate, non-sensitive rebate-shape probe.
5. After implementation, add timestamp-peer, descending-order, partial-lane, burst-coalescing, and physical-weight tests.
6. Compare request weight and row counts over live funding/verification cycles before archive. Rollback restores the previous scheduler but invalidates incomplete lane cursors.
