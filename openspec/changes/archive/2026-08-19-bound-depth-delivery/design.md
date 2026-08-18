## Context

The shown session applies each exchange diff to its authoritative book and immediately crosses that book into a complete renderer view. The renderer outbox already protects a blocked socket, but it acts after serialization and does not reduce work while the socket accepts each frame.

## Goals / Non-Goals

**Goals:**

- Keep consecutive routine depth view constructions and emissions at least 200 ms apart.
- Retain exactly the newest pending state with constant memory.
- Deliver non-live and recovered states immediately.
- Make timers session-owned and teardown-safe.

**Non-Goals:**

- Drop or coalesce exchange diffs before they update the authoritative book.
- Change snapshot depth, grouping, row coverage or renderer-outbox backpressure.
- Throttle catalog, candles, header, status or tape.

## Decisions

Each session will hold `lastDepthDeliveryAt`, one `pendingDepthDelivery`, and one timer. Routine diff handling will emit immediately only when at least 200 ms have elapsed since the previous routine delivery. Otherwise it replaces the pending slot and arms one timer for the earliest eligible instant. The trailing callback rechecks held/shown ownership, builds the newest complete view from the authoritative book, emits it, clears the slot, and records its actual delivery time. This gives a leading emission and, when more diffs arrive, one newest trailing emission without ever placing two routine emissions inside the minimum spacing.

Depth emission sites will go through one depth-specific dispatcher. Bootstrap, explicit depth reconfiguration, stale/unavailable/resynchronizing delivery, recovery completion and held-session selection will request immediate delivery. Immediate delivery cancels any older routine pending payload before emitting and establishes the next routine spacing point, so a failure or recovered state cannot later be overwritten by an older queued book.

The pending slot will describe the newest authoritative book rather than accumulate frames. Where possible, the expensive renderer view will be built only when a delivery is actually due; this is the work reduction the transport outbox cannot provide.

Session release, hide/show ownership transfer and service stop will clear the depth timer and slot through the same release discipline already used for tape timers.

## Risks / Trade-offs

- [Five depth paints per second may be less fluid than the source cadence] → Preserve an eligible leading update and guaranteed newest trailing update; keep all diffs in the authoritative book.
- [An older timer could emit after a contract switch] → Recheck session identity and ownership and clear timers during every release/selection transition.
- [Immediate recovery followed by an older pending live book could regress state] → Immediate paths cancel the pending slot before delivery.
