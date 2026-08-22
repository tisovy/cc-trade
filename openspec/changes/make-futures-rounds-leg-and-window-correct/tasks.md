## 1. Position identity and fold production path

- [x] 1.1 Run GitNexus upstream impact for the round fold, trade-history read/store, execution handler, settled-money fold, hook, and history consumers; record the graph's known ESM/JSX blind spots before editing
- [x] 1.2 Add canonical `{symbol, leg}` position keys, persist versioned contract-window acquisition proof, and project it per key and generation at the fold boundary; then verify existing held history can be loaded or safely invalidated without losing canonical fills
- [x] 1.3 Replace the symbol-only production round state with independent hedge-leg and `BOTH` state machines, then verify a direct runtime probe keeps simultaneous LONG and SHORT open
- [x] 1.4 Replace percentage-of-notional consistency tolerance with exact decimal/contract-precision comparison and verify the reproduced 0.5-on-100.5 case is no longer accepted as rounding
- [x] 1.5 Return resolved rounds and explicit unresolved segments with terminal snapshot reconciliation, then verify a stale symbol-only persisted round cannot attach to a mismatched current position
- [x] 1.6 Preserve per-fill `marginAsset`, require one consistent settlement asset per round, and verify missing/conflicting evidence never produces an exact USDT or USDC result
- [x] 1.7 Bound fill decimal parsing and reject lossy scientific numeric evidence, then verify malformed quantity/money cannot allocate unbounded integers or resolve as rounded zero
- [x] 1.8 Preserve absent REST fill money/time/asset fields as missing evidence rather than normalized zero or epoch values

## 2. Targeted acquisition and live maintenance production path

- [x] 2.1 Implement bounded older account-trade acquisition for unresolved position keys, stopping early only after same-generation reverse terminal reconciliation proves exact per-leg flat at a fully enumerated slice boundary; verify page-limit/retention/cancellation state remains explicit and retain the fixed bounded target when that proof is unavailable
- [x] 2.2 Prioritize basis reads for current open positions without coupling them to the selected history tab and verify a fresh profile schedules reads only for current position symbols
- [x] 2.3 Normalize user-stream executions into the held fill identity map and coalesce targeted gap reads, then verify duplicate REST/stream delivery changes totals once
- [x] 2.4 Propagate per-key coverage and unresolved reasons through the hook and Closed Positions/open-settlement production models, then verify incomplete keys never emit exact closed rows or wallet results
- [x] 2.5 Make cold/legacy/forward-gap/Full/post-gap acquisition backend-owned, bounded, and per-renderer; verify a market switch or closed renderer cannot cancel, steal, or receive another renderer's repair
- [x] 2.6 Gate atomic replacement on unchanged stream topology/activity and the highest stream-observed fill identity, then verify a reconnect or REST-late fill remains additively visible until confirmed
- [x] 2.7 Restrict fill-history activity invalidation to actual fills, then verify `NEW`, cancellation, and expiry reports do not schedule unnecessary trade-history repair
- [x] 2.9 Reject absent/blank/non-integer/inverted acquisition window bounds, then verify no missing edge becomes an epoch-wide read
- [x] 2.8 Globally bound IndexedDB history to the active fingerprint, purge legacy/foreign namespaces without reducing its 24-contract allowance, and verify credential rotation cannot make `getAll` grow per account
- [x] 2.10 Make the default persistent-history update one atomic IndexedDB read/merge/prune/write transaction, preserve injected adapters, and close every opened connection after settlement
- [x] 2.11 Fence shared traded-symbol discovery commits by monotonic issue order and history reset, preserving per-renderer responses and account fingerprint isolation
- [x] 2.12 Delete cold/Full/basis/post-gap checkpoints when their bounded retry budget is exhausted while allowing a later explicit request to start fresh
- [x] 2.14 Reject invalid/out-of-window trade rows and conflicting duplicate identities transactionally before a bounded trade window advances coverage
- [x] 2.13 Enforce a cumulative 16-page `/userTrades` budget per frozen Full/cold checkpoint, pass only its remainder to continuations, and evict incomplete work at exhaustion
- [x] 2.15 Stabilize the renderer's terminal-reconciliation position basis so valuation-only account frames do not refold bounded fill history
- [x] 2.16 Keep unreadable retained fills as per-position (or unknown-owner batch) continuity barriers so later rounds cannot become exact around omitted executions
- [x] 2.17 Preserve bounded internally derived entry decimals through terminal reconciliation even when their numeric presentation uses exponent notation
- [x] 2.18 Pass one canonical commission asset through completeness, fee allocation, and settlement NET instead of re-reading raw evidence in the HIGH-risk fill fold
- [x] 2.19 Merge compatible duplicate trade evidence monotonically and turn conflicting present evidence into a per-key continuity barrier instead of last-write-wins money
- [x] 2.20 Compare readable evidence on malformed duplicate identities with valid canonical copies so a conflicting partial row cannot be silently suppressed
- [x] 2.30 Carry stream `ma`/`marginAsset` through normalized execution reports and held fills without inventing it when absent
- [x] 2.31 Cap derived per-key coverage before stream-only fills until REST absorbs their identities, without invalidating older proven rounds in the contract
- [x] 2.32 Project contract acquisition proof to snapshot-only current keys and preserve retention/page/continuity evidence when no retained fill can provide their basis
- [x] 2.21 Make optional `/userTrades` time bounds tri-state and admit only bounded canonical rows for the requested contract, rejecting a malformed response transactionally before cursor, renderer, or persistence handoff
- [x] 2.22 Pass expected-contract evidence through the bounded trade-window API and reject a foreign-contract logical page before rows or coverage mutate
- [x] 2.23 Reuse the dependency-free canonical trade validator at v2 restore, retaining malformed persisted rows as unresolved evidence while clearing their cursor and completeness proof
- [x] 2.33 Treat present-but-malformed duplicate fill money or asset evidence as a continuity conflict instead of sparse enrichment before round exactness
- [x] 2.34 Reuse the bounded canonical asset domain inside the round fold so direct malformed or oversized assets cannot become resolved denominations
- [x] 2.35 Reject a `/userTrades` answer larger than its admitted page size with `OVERSIZED_TRADE_PAGE` before row iteration, and clamp injected page/request limits to `1..FUTURES_TRADE_HISTORY_WINDOW` so callers can narrow but never widen production bounds
- [x] 2.36 Invalidate duplicate or malformed authoritative `{symbol, leg}` snapshot keys before terminal reconciliation so input order cannot manufacture an authoritative zero or exact round
- [x] 2.37 Preserve distinct conflicting trade-identity payloads across bounded persistent-store writes/restores while deduplicating equivalent copies and keeping cursor semantics identity-based
- [x] 2.38 Clear restored trade cursor/coverage proof when canonical same-ID variants conflict, retaining the rows so bounded cold reacquisition can replace rather than page beyond the compromised seam
- [x] 2.39 Add a monotonic trade-evidence revision and memoized trade snapshot so order-only history responses cannot rebuild the round index or wallet ledger
- [x] 2.40 Preserve untouched endpoint row/folded collections by reference so an order-only read cannot filter and sort the bounded fill collection, or vice versa

## 3. Presentation production path

- [x] 3.1 Update Closed Positions to key and group rounds by leg, show unresolved scope without phantom rows, and verify closing one hedge leg does not mutate the other row
- [x] 3.2 Update current-position settlement lookup to `{symbol, leg}` and verify two hedge rows no longer receive one symbol-wide fill total
- [x] 3.3 Render Gross and NET in the round's proven settlement asset and verify a USDC round is never labelled USDT
- [x] 3.21 Preserve the first surviving Closed-window round across prepends, clamp removed anchors, and re-arm one selected-view history read after its prior read identity is cleared
- [x] 3.22 Include the canonical position leg in row-action accessible names that would otherwise collide between hedge rows
- [x] 3.23 Make recovered Closed-position entry provenance visible and focusable instead of leaving it only in a `title`
- [x] 3.24 Preserve exact exchange realized-PnL text through the Closed Gross renderer instead of converting it to a two-decimal JavaScript number
- [x] 3.25 Align the Closed presentation and delta requirement on explicit `Gross` and `NET` column names without creating standalone fee/funding columns

## 4. Tests after implementation

- [x] 4.1 Add round-fold tests for simultaneous hedge legs, independent partial closes, both legs closing, timestamp ties, and one-way reversal; run the focused round suite
- [x] 4.2 Add incomplete-window tests for exactly 1000 fills, break-even first close, scale-out/re-entry, retention exhaustion, precision tolerance, and snapshot mismatch; run the focused fold/history suite
- [x] 4.3 Add hook/main tests for startup basis acquisition, execution insertion, gap coalescing, cancellation, persistence migration, and no-history-click updates; run the focused integration suites
- [x] 4.4 Add Closed Positions/open-settlement component tests for per-leg identity and unresolved coverage, then run all affected component suites
- [x] 4.5 Add USDC, missing/conflicting margin-asset, legacy-cache reacquisition, REST-late stream-fill, reconnect, bounded-failure, and multi-renderer ownership regressions
- [x] 4.6 Add user-stream regressions proving non-fill lifecycle reports preserve history activity/reconciliation proof while true fills still invalidate it
- [x] 4.8 Add persistent-store regressions proving legacy and previous-fingerprint records are removed while the current account remains isolated and bounded
- [x] 4.7 Add oversized fill-decimal and scientific-number regressions for quantity, realized PnL, and commission
- [x] 4.9 Add trade-window bound validation regressions for null, blank, unsafe, and inverted times
- [x] 4.10 Add two-instance concurrent persistence and IndexedDB transaction/connection-lifecycle regressions
- [x] 4.11 Add crossed multi-renderer discovery and terminal-checkpoint eviction/fresh-retry regressions
- [x] 4.12 Add REST-normalization regressions proving omitted fill money/time fields cannot resolve a round or exact NET
- [x] 4.14 Add bounded-window regressions for unnamed trades, out-of-window rows, identical overlap duplicates, and conflicting identity reuse
- [x] 4.13 Add a dense/repeating Full reacquisition regression proving the cumulative REST-page budget terminates truthfully and evicts its checkpoint
- [x] 4.15 Add a hook regression proving mark/uPnL/margin-only position refreshes preserve the round-index identity while quantity or entry changes recompute it
- [x] 4.16 Add round-index regressions proving a malformed in-sequence fill blocks later exact NET while a valid duplicate identity can replace an incomplete projection
- [x] 4.17 Add terminal-reconciliation regressions for exact sub-micro entry prices rendered by JavaScript in scientific notation
- [x] 4.18 Add a regression proving canonical commission-asset normalization subtracts the settlement fee exactly once
- [x] 4.19 Add round-index regressions for compatible sparse/rich duplicate enrichment and conflicting duplicate quantity/PnL evidence
- [x] 4.21 Add component regressions for Closed-window prepend/shrink identity and successful-read reset re-arming
- [x] 4.22 Add a hedge-row accessibility regression proving close and whole-position sizing actions name the intended leg
- [x] 4.23 Add a Closed-row accessibility regression proving recovered entry provenance is available without hover
- [x] 4.24 Add round-index regressions for a compatible incomplete duplicate replacement and an incomplete duplicate whose present field conflicts with the valid copy
- [x] 4.30 Add adapter and held-history regressions proving streamed settlement-asset evidence survives canonical folding
- [x] 4.31 Add hook regressions for a stream-only fill inside an older timestamp span and for REST confirmation restoring that key's right edge
- [x] 4.32 Add hook/fold regressions proving a snapshot-only current key inherits contract retention-limited coverage and remains unresolved without exact fill-owned money
- [x] 4.25 Add adapter regressions for omitted versus malformed optional time bounds, bounded canonical trade fields, exact zero-commission asset handling, and whole-page rejection before return
- [x] 4.26 Add trade-window regressions for foreign contracts, missing/non-canonical essential fields, oversized evidence, and transactional row/coverage retention
- [x] 4.27 Add persistent-store regressions proving every essential malformed v2 trade invalidates restored cursor/coverage without deleting the audit row
- [x] 4.33 Add retained-fill regressions proving malformed duplicate realized PnL, commission, commission asset, and settlement asset cannot be enriched away by a valid copy
- [x] 4.34 Add direct-fold regressions proving malformed and oversized settlement or commission assets keep otherwise complete rounds unresolved
- [x] 4.35 Add reverse-flat acquisition regressions for LONG/SHORT/BOTH exact quantities, a shared all-keys boundary, forward-only false zero, dense/page-limited slices, stale/loading snapshots, fill/reconnect/activation races, cancellation, and fallback to the unchanged frozen target
- [x] 4.36 Add trade-window regressions proving an oversized page is rejected before row access/state mutation and injected page/request limits can shrink but never exceed production ceilings
- [x] 4.37 Add round-index regressions proving duplicate snapshot keys are fail-closed and order-invariant instead of last-write-wins
- [x] 4.38 Add store-to-restore-to-round-index regressions proving conflicting same-ID fills survive restart, remain order-invariant and unresolved, and respect the physical cache bound
- [x] 4.39 Extend restart-conflict regressions to prove restored cursor/coverage are cleared while exact duplicates retain proof and remain eligible for forward paging
- [x] 4.40 Add Closed renderer regressions proving sub-cent and beyond-safe-integer Gross values retain their exact signed decimal and asset
- [x] 4.41 Add held-history/hook regressions proving an order-only response preserves round and wallet identities while a trade read or streamed fill invalidates them
- [x] 4.42 Add a Closed header regression proving the two money columns are named `Gross` and `NET`
- [x] 4.43 Extend held-history regressions to prove cross-endpoint responses retain the untouched row and folded-identity references

## 5. Verification and operator gate

- [x] 5.1 Run `OPENSPEC_TELEMETRY=0 openspec validate make-futures-rounds-leg-and-window-correct --strict` and verify it passes
- [x] 5.2 Run GitNexus `detect_changes` against `main`, reconcile every affected round/history/open-settlement flow, and resolve unexpected symbols before commit
- [ ] 5.3 Verify on live data simultaneous LONG/SHORT, one-leg partial close, one-way reversal, an already-open startup position without opening History, and at least one USDC-settled Closed row; keep this unchecked until the operator confirms
- [ ] 5.4 Archive only after operator confirmation; carry any unproven retention/boundary case into a follow-up change
