## Context

History pages are currently accumulated in the shared workstation resource snapshot and consumed later by an effect. A status transition can rewrite every resource between those two steps. Separately, ownership validation throws before the normal history-failure emitter has a session it may use. Resource events require a positive session generation and revision, so a reply built from the current shown session would either lie about ownership or be dropped by the renderer's ordering guard.

## Goals / Non-Goals

**Goals:**

- Bind history completion to the accepted history events that form the response.
- Return a typed unavailable answer for an ownership refusal.
- Keep selection, generation, offset and request ownership guards intact.

**Non-Goals:**

- Change live candle-window ownership, history cache bounds or exhaustion rules.
- Retry automatically without another scroll.
- Turn generic workstation command errors into candle-history answers.

## Decisions

The hook will maintain an event-derived history accumulator outside `resources.candleHistory`, as part of the state transition that has already accepted the event's request, generation and revision. It will validate offset, total, selection and generation, accumulate rows, and expose a completed answer keyed by the completing revision. A later status transition may still rewrite the resource snapshot and notices, but it preserves that completed answer. The settlement effect will consume only this exact answer; the effect that derives an answer from `state.resources.candleHistory` will be removed so there is one writer.

`CANDLE_HISTORY_OWNER_UNAVAILABLE` will be answered with a small workstation history-outcome frame, distinct from an ordered resource event. The frame will carry the load action, subscription request id, symbol, interval, end time, `unavailable` outcome and bounded reason code. It deliberately has no generation or revision: no session owns the refusal, and inventing either can cause it to replace real resource state. The production protocol will create, validate and parse the exact response shape, and the desk-frame router will classify it on the workstation lane. Other request errors retain the existing rejection path.

Both a completed served answer and an unavailable outcome will pass through the same hook settlement function. It first matches subscription request id, symbol, interval and end time. It then clears only that selection and request lock, marks an unavailable outcome as failed without changing rows or exhaustion, and applies/cache-writes only a live served page. A reply for an abandoned selection is ignored.

## Risks / Trade-offs

- [Two history accumulators could disagree] → Make the event-derived buffer the only source that applies history; resource state remains presentation state only.
- [A late ownership refusal could release a newer read] → Match request id, symbol, interval and end time before settlement.
- [A second workstation frame shape could bypass validation] → Give the outcome its own exact-key creator/parser tests, retain the shared request-id/symbol/interval bounds, and route only validated frames to the hook.
- [An outcome could be mistaken for mutable resource state] → Keep it outside generation/revision ordering and never pass it to `applyFuturesWorkstationEvent`.
