## Context

See `proposal.md` for motivation. The shared limiter currently reserves before entering retry logic, so multiple physical HTTP attempts share one logical charge. This limiter serves many account, history, stream, and command flows; GitNexus reports a CRITICAL blast radius of 49 total dependants across 17 execution flows.

## Goals / Non-Goals

**Goals:**

- Make admission and accounting correspond one-to-one with physical Binance attempts.
- Preserve cancellation, retry eligibility, and command priority.
- Use observed Binance weight/backpressure conservatively when available.

**Non-Goals:**

- Changing which errors are retryable.
- Increasing retry counts.
- Replacing the shared scheduler or changing endpoint-declared weights.

## Decisions

### 1. Move reservation inside the physical-attempt loop

Represent a logical operation as metadata plus an attempt factory. Before invoking the factory for attempt `n`, await `reserve({weight, priority, signal})`. A retry performs a new reservation after backoff and cancellation checks. The logical promise still resolves/rejects with the final attempt as before.

This is preferred to multiplying the initial reservation by maximum attempts because unused retries would unnecessarily block work and cancellation could not release historical window usage safely.

### 2. Return structured attempt accounting

Internal execution results include attempt count, declared weight charged, observed used-weight samples, retry causes, and final outcome. Diagnostics record bounded categories only. Callers that only need the payload keep the existing adapter-facing shape.

### 3. Reconcile observed exchange usage conservatively

When adapters surface recognized used-weight and retry-after headers, update the limiter window to at least the observed usage and postpone admission according to authoritative backpressure. Never lower current local usage from a possibly stale header. Header absence keeps declared charges unchanged.

### 4. Cover global call classes before rollout

Build seam fixtures for: first-try success, timeout then success, three failures, cancellation during backoff/admission, 429, high observed weight, stream listen-key priority, trading command priority, and long history/income fan-outs. No income-specific scheduling changes land in this change.

## Risks / Trade-offs

- **[Retries take longer under honest admission]** → This is required to avoid bans; keep priority/fairness and surface queued state.
- **[A timeout that never reached Binance is still charged]** → Conservative charging is safer because delivery is unknowable; later headers may only raise, not lower, the window.
- **[Adapters do not expose headers consistently]** → Declared per-attempt charging is sufficient; header reconciliation is additive.
- **[Global regression]** → Land separately, run all account/command/history suites, and compare diagnostics before enabling income budget assumptions.

## Migration Plan

1. Add structured attempt metadata without changing reservation placement.
2. Move the production reservation into the attempt loop and expose observed header hooks.
3. Update diagnostics/metrics consumers.
4. Only after production code lands, add deterministic limiter tests and rerun every GitNexus-identified flow suite.
5. Observe request latency, charged weight, 429s, and command priority in live operation before archive. Rollback restores one logical reservation; no persisted data migration is involved.
