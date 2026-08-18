## Context

The `unstated`, `stream`, and `bootstrap` refreshes are intentionally fire-and-forget because the state they read must not delay the event that caused them. `refreshFuturesAccountState` already updates each failed resource; what is missing is settlement of the outer promise at the three detach points.

## Goals / Non-Goals

**Goals:**

- Keep all three refreshes detached.
- Prevent their rejections from reaching the global process handler.
- Preserve a reason-specific, sanitized diagnostic at each launch site.

**Non-Goals:**

- Change refresh scheduling, coalescing, retry policy or resource state.
- Change the process-wide handler for genuinely unowned rejections.

## Decisions

Each `void refreshFuturesAccountState(...)` expression will attach a terminal `catch` at the same launch site. A small shared reporter may normalize a safe error code and message format, but it will receive the explicit launch reason so the three call sites remain self-describing.

The catch will log through the existing bounded logger and will not rethrow. Resource-level failure state remains owned by `refreshFuturesAccountState`; duplicating renderer notifications in the catch would present one failed read twice.

Tests will drive each detached path with a rejecting refresh dependency and observe the local diagnostic plus the absence of `unhandledRejection` after production code is in place.

## Risks / Trade-offs

- [The catch could duplicate an existing resource warning] → Keep it to one reason/code diagnostic and leave renderer state untouched.
- [A formatter could leak raw error text] → Accept only the existing safe code/category and fixed reason vocabulary; never interpolate request or response objects.
