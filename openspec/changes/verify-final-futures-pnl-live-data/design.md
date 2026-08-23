## Context

See `proposal.md` for motivation. Five implementation changes have deterministic coverage and are ready to archive, while their final live observations remain operator-owned. Confirmation debt is restart-safe because a cross-bucket event persists the complete bounded settled-income resource; the common same-bucket path is already coalesced, but a lane-sized synthetic resource demonstrates that a rare transition can still serialize and rewrite tens of megabytes synchronously.

## Goals / Non-Goals

**Goals:**

- Preserve a traceable mapping from every unfinished archive task to one follow-up task and ledger row.
- Verify visible Closed `PnL`, exact title evidence, settled component ownership, resource readiness, and request accounting without mutating the live account.
- Measure persistence cost without exposing money or credentials, and make the threshold for a separate optimization change explicit.

**Non-Goals:**

- Placing/cancelling orders, changing leverage or margin, closing positions, or transferring funds to stage evidence.
- Treating a deterministic USDC/BNB fixture as live evidence for an account that does not use those cases.
- Redesigning the durable resource format inside this verification-only change.

## Decisions

### 1. Operator observations remain the authority

The operator compares already-existing live rounds and positions with Binance and reports the contract/time plus pass, mismatch, or not-applicable outcome. Diagnostics may supply counts, readiness, duration, and weight, but never substitute for what the two applications display. This is preferred to an automated authenticated probe because the remaining acceptance question is presentation on the operator's actual account.

### 2. Verification is read-only and opportunistic

Hedge, reversal, funding, and restart cases are checked only when they naturally exist. A missing case remains outstanding or is explicitly marked not applicable; the verifier does not create market exposure to manufacture it.

### 3. Performance measurement uses bounded synthetic resources

Measure synchronous confirmation-debt persistence at both the operator-like row count and the admitted per-lane ceiling, recording only row count, serialized bytes, and elapsed time. If a realistic write blocks for more than 16 ms, or any admitted transition writes more than 10 MiB or blocks for more than 50 ms, create a separate implementation change for a durable scalar-debt sidecar or equivalent format revision. The current full-resource write remains unchanged here because changing crash-recovery authority while archiving correctness fixes would broaden the risk surface.

### 4. One ledger remains the durable evidence index

Every result is appended to `openspec/live-verification-ledger.md` with date, account/environment, revision, and the originating follow-up task. The five archived task files stay historically truthful and unchecked; the follow-up task is where eventual completion is recorded.

## Risks / Trade-offs

- **[A live case may not naturally occur soon]** → Keep it outstanding or mark it operator-confirmed N/A; never stage a trade merely to close paperwork.
- **[Binance UI and desk time grouping can differ]** → Record contract, leg, and approximate close/funding time, then compare the exact exchange PnL/detail rather than row position alone.
- **[Synthetic ceiling cost exaggerates normal traffic]** → Report realistic and ceiling measurements separately, but still treat an admitted blocking write as an architectural debt when it crosses the explicit bound.
- **[Archiving can be mistaken for live confirmation]** → The ledger and archive summaries explicitly state that automated completion and operator verification are different facts.
