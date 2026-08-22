## 1. Dependency, API, and impact gates

- [x] 1.1 Confirm `make-settled-income-resource-truthful` is implemented and exposes per-lane-capable coverage/state, otherwise keep this change blocked and verify no cursor migration begins
- [x] 1.2 Confirm `charge-every-binance-retry-weight` is implemented before asserting physical request budgets, otherwise keep budget acceptance tasks blocked
- [x] 1.3 Re-verify official Binance Income History bounds/page/limit/weight/retention semantics and record the source date; do not assume undocumented ordering
- [x] 1.4 Run GitNexus upstream impact for the walker, adapter income page, lane store, schedule/read functions, user events, and command priority flows; warn on CRITICAL/HIGH results before editing

## 2. Lossless acquisition production path

- [x] 2.1 Add versioned per-income-type lane state and migrate/invalidate the prior union cursor safely, then verify one failed lane cannot advance or erase another
- [x] 2.2 Implement fixed inclusive target-window pagination with explicit page numbers, canonical dedup, and local sort, then verify a synthetic >1000-same-millisecond dataset is enumerated without cursor `+1` loss
- [x] 2.3 Remove response-order assumptions from coverage decisions while retaining bounded diagnostics, then verify ascending and descending page fixtures produce identical canonical output
- [x] 2.4 Carry per-lane partial/complete/target state into the aggregate resource and wallet consumers, then verify funding-current/rebate-stale does not claim complete Net
- [x] 2.5 Enforce a cumulative per-lane row ceiling across continuation passes, preserve bounded partial evidence with `ROW_LIMIT_REACHED`, and verify the oversized target stops queueing without claiming coverage or completeness
- [x] 2.6 Enforce a cumulative per-frozen-target page/request ceiling across continuation passes, terminate repeated full duplicate pages with `PAGE_LIMIT_REACHED`, and retain confirmed coverage without another continuation
- [x] 2.7 Validate every answered page before checkpoint/coverage advancement and fail the lane transactionally on malformed, assetless, cross-type, or out-of-window rows
- [x] 2.8 Reject conflicting canonical income identities across all pages of one frozen target while retaining byte-equivalent page overlap
- [x] 2.9 Preserve missing or blank income timestamps as missing endpoint evidence instead of manufacturing epoch, so page validation rejects them transactionally
- [x] 2.10 Reject non-array and over-requested income pages before normalization in the adapter and independently before iteration in the walker
- [x] 2.11 Preserve transient `EMPTY_ANSWER` semantics and bounded confirmation retry for `null`/`undefined` transport silence while classifying answered non-array containers as `INVALID_INCOME_PAGE`
- [x] 2.12 Independently default and upper-clamp every injected v2 walker limit so partial test seams remain live and no caller can widen production row/page/overlap budgets
- [x] 2.13 Mark row-retention exhaustion as an aggregate failed walk so scheduler diagnostics cannot label `ROW_LIMIT_REACHED` as a healthy partial pass

## 3. Budgeted scheduling production path

- [x] 3.1 Map funding, fill/rebate, insurance, startup, manual, confirmation, and verification reasons to the minimum lanes in production scheduling and verify a funding event requests only `FUNDING_FEE`
- [x] 3.2 Coalesce zero/nonzero-realized fill bursts into delayed underivable-credit lane reads and verify an opening fill can surface a late rebate without one walk per fill
- [x] 3.3 Rotate/reconcile every required lane during periodic verification within a declared physical-weight budget and verify deferred work remains explicitly partial/queued
- [x] 3.4 Extend bounded production diagnostics and the probe's acquisition-shape summary with reason, lane/page/read counts, physical attempts, charged weight, requested-lane coverage gained, and aggregate rebate symbol/trade-identity presence; verify neither emits raw identity, row, URL, signed material, credential, header, exchange message, or money, while the probe's separate explicit wallet-comparison section may report per-asset amounts
- [x] 3.4a Reconcile the settled diagnostic vocabulary with the exact production reasons `bootstrap`, `stream`, `fill`, `funding`, `settlement`, `refresh`, `confirm`, `credit-confirm`, `insurance`, `insurance-confirm`, `verification`, `extension`, and `tick`, and verify none can be silently dropped
- [x] 3.5 Replace the global terminal retry gate with per-lane automatic cooldown, preserving manual/hourly bypass, then verify a refused rebate lane cannot block a due funding or insurance read
- [x] 3.6 Put `ROW_LIMIT_REACHED` into the existing per-lane automatic cooldown while preserving manual/hourly bypass, then verify ordinary ticks cannot restart the oversized target from page one
- [x] 3.7 Make activation bootstrap the sole all-lane cold-start owner; keep stream-open account refresh but prevent it from enqueueing a duplicate income pass after the debounce
- [x] 3.8 Persist per-lane delayed-confirmation debt before the debounce, restore its stale state and remaining timer after restart, and clear it only after a successful post-deadline confirmation
- [x] 3.9 Bind queued settled-income physical admissions to their captured Futures activation while retaining the post-answer stale-state guard
- [x] 3.10 Make durable confirmation restore tolerate only a bounded backward-clock target, authenticate before degrading future evidence, and preserve stale debt without accepting future ready authority
- [x] 3.11 Coalesce durable confirmation invalidations into conservative one-second target/deadline buckets while retaining the exact newest-event in-memory timer and immediate first-bucket persistence
- [x] 3.12 Finalize a completed income walk against the current global resource generation/content after reapplying exact current confirmation markers, never its stale walk-start revision
- [x] 3.13 Canonicalize every confirmation-debt lane as stale and incomplete even without retained rows or coverage, and align durable/IPC admission with that invariant
- [x] 3.14 Persist event confirmation debt before cooldown/backoff/due admission and re-arm a due confirmation when that admission remains deferred
- [x] 3.15 Restrict ordinary tick work to genuinely incomplete non-loading lanes without confirmation debt, sending no income request for debt-only incompleteness
- [x] 3.16 Derive durable confirmation deadlines only from rounded event witnesses while allowing acquisition `targetTo` to advance independently across walk completion and restart
- [x] 3.17 Revalidate fired/debounced/single-flight confirmation lanes against current debt before REST admission, dropping repaid lanes and dynamically narrowing re-armed family timers
- [x] 3.18 Short-circuit same-bucket confirmation invalidation from scalar lane state before canonical lane construction so covered fill bursts do not clone retained credit ledgers
- [x] 3.19 Retain an account-wide HTTP 418 automatic floor until a deliberate all-lane pass proves recovery with successful lane answers
- [x] 3.20 Route the maintained live probe through the production fixed-window per-lane walker and remove its timestamp-cursor/unfiltered-union acquisition path

## 4. Tests after implementation

- [x] 4.1 Add walker/store tests for timestamp peers, fixed pages, descending order, duplicate boundaries, late rows, page bounds, retention, and one-lane failure; run focused Electron suites
- [x] 4.1a Add a multi-pass dense-lane regression proving retained and serialized rows stay bounded, coverage is cleared, and no continuation remains at the row ceiling
- [x] 4.1b Add multi-pass duplicate-page and invalid-page regressions proving bounded termination, truthful retained coverage, explicit errors, and no exact Net claim
- [x] 4.1c Add same-page and resumed-page conflict regressions proving response order cannot choose the money for one reliable identity
- [x] 4.1d Add adapter regressions proving null/blank income timestamps remain missing and cannot enter a canonical page as epoch
- [x] 4.1e Add adapter, direct-walker, and connection regressions proving malformed/over-requested pages fail transactionally without normalization or false empty coverage
- [x] 4.1f Add walker/main regressions proving transport silence stays retryable as `EMPTY_ANSWER` while an answered non-array page is non-successful `INVALID_INCOME_PAGE`
- [x] 4.1g Add walker regressions proving partial injected limits retain production defaults and oversized row/page/overlap limits cannot widen production ceilings
- [x] 4.1h Add a dense-lane regression proving `ROW_LIMIT_REACHED` also sets the aggregate failed outcome without discarding bounded evidence
- [x] 4.2 Add scheduler tests for funding-only weight, opening-fill rebate confirmation, burst coalescing, insurance trigger, cold start, and verification rotation; run the main-process suite
- [x] 4.3 Add physical-weight budget tests for immediate/confirm/cold/verification paths, including pooled fallback and timestamp recovery, after retry accounting is live; run limiter and income suites together
- [x] 4.4 Run command-priority, listen-key restoration, account refresh, history fan-out, and cancellation regression suites
- [x] 4.5 Add a delayed private-stream-open regression proving exactly one cold-start income pass while stream account refresh and later event triggers still work
- [x] 4.6 Add resource round-trip and main-process restart-seam regressions proving pre-deadline bootstrap cannot clear persisted confirmation debt and a post-deadline success can
- [x] 4.7 Add a queued-before-send lifecycle regression proving deactivation/account switch prevents the retired income attempt from creating transport or mutating the next activation
- [x] 4.8 Add resource/store regressions for bounded rollback with future rows/coverage plus atomic rejection of the same future evidence without confirmation debt
- [x] 4.9 Add distinct-millisecond burst, same-bucket restart, in-flight generation-race, and empty-debt regressions; run resource/parser/main suites together
- [x] 4.10 Add cooldown/account-backoff event regressions proving debt persists before admission and a blocked due confirmation is re-armed
- [x] 4.11 Add tick regressions proving debt/loading lanes spend no weight while a distinct incomplete lane is selected alone
- [x] 4.12 Add restart/bootstrap regressions proving acquisition-target movement never extends an existing event-derived confirmation deadline
- [x] 4.13 Add manual/verification and partial-family races proving obsolete confirmation lanes are removed before REST and cannot degrade newly exact evidence
- [x] 4.14 Add a dense-ledger same-bucket regression proving duplicate fill witnesses reuse lane rows without canonical clone/hash/store work
- [x] 4.15 Add an HTTP 418 recovery regression proving a failed deliberate probe does not reopen automatic event/tick reads
- [x] 4.16 Add a probe regression proving explicit page continuation preserves timestamp peers and incomplete lane evidence remains qualified

## 5. Verification and operator gate

- [x] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-settled-income-acquisition-lossless --strict` and verify it passes
- [x] 5.2 Run GitNexus `detect_changes` against `main`, inspect all scheduler/admission/resource deltas, and resolve unexpected flows before commit
- [ ] 5.3 Measure live funding, opening-fill rebate posting latency (including whether it exceeds the two-minute confirmation-debt horizon), and hourly verification cycles for row completeness and request weight; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after live confirmation and record any undocumented ordering/rebate-field observation in the maintained probe journal
