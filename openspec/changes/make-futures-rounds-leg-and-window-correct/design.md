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

Persist per-key `coveredFrom`, `coveredTo`, `flatBoundary`, `pageLimited`, `retentionLimited`, and `terminalReconciled`. The fold returns resolved rounds plus unresolved segments; it does not coerce unresolved segments into rows. A response of exactly the endpoint limit sets `pageLimited` until an older request disproves truncation.

### 3. Replace percentage tolerance with exact decimal evidence

Preserve exchange decimal strings through parsing and perform quantity/PnL consistency with fixed-scale integer or rational arithmetic. The allowable comparison error is derived from contract tick/step and settlement-asset precision for the fills involved. One percent of notional is never a rounding bound.

This avoids adding a floating-point epsilon whose economic size grows with the trade. If precise evidence is unavailable, the state is unresolved rather than guessed.

### 4. Backfill bounded time slices toward a proven flat boundary

For a position key that lacks a boundary, request older account trades in bounded time slices, narrow any page-limited slice until it can be fully enumerated, normalize/sort/deduplicate, then prepend it. Stop at a proven flat state, retention, cancellation, or a declared request budget. The current-open-position basis has priority over an operator review, while admission fairness remains unchanged.

This approach is chosen over blindly following `fromId`, which fetches forward and cannot be combined with time bounds, and over loading all six months on every activation.

### 5. Reconcile terminal state with the account snapshot

After folding, compare each current key's leg, signed/leg quantity, and entry basis with the same-generation account snapshot. A mismatch invalidates terminal certainty and schedules one gap/backfill reconciliation. Persisted rounds from a previous position generation are not reused merely because the symbol matches.

### 6. Maintain fills from both stream and REST through one identity map

Normalize execution reports into the same fill identity as REST. Insert them immediately and idempotently. Detect missing continuity/unknown identity and coalesce a targeted REST gap read. The default Working tab no longer controls whether settlement data is current.

## Risks / Trade-offs

- **[More REST traffic on old open positions]** → Request only current keys lacking boundaries, persist progress, stop at flat, and expose the bound instead of looping.
- **[Mode changes or malformed `positionSide`]** → Fail the affected key unresolved; never merge an explicit hedge leg into `BOTH`.
- **[Persisted schema is incompatible]** → Version the held history/coverage record and rebuild derived rounds from canonical fills.
- **[Snapshot reconciliation races a new execution]** → Compare activation/account generations and retry after the execution fold rather than marking a cross-generation mismatch.

## Migration Plan

1. Add canonical position keys and coverage metadata at normalization/storage boundaries.
2. Implement production per-key folding and unresolved output, then switch open-round and Closed Positions consumers.
3. Add targeted basis/backfill orchestration and execution-report insertion.
4. Migrate or invalidate old symbol-only derived state while preserving canonical fills.
5. Only after production code is in place, add hedge, page-limit, break-even, reversal, persistence, and gap-read tests.
6. Verify simultaneous live LONG/SHORT and one-way reversal against operator data before archive. Rollback disables the new derived index and rebuilds from preserved fills.
