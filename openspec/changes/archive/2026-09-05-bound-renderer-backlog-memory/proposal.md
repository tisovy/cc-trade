## Why

Audit A04 identified that 4096 account / 1024 market messages do not bound retained payload bytes. A few large history snapshots can dominate memory, and a silent blocked connection has no backlog deadline.

## What Changes

- Bound each renderer's queued UTF-8 payloads to 64 MiB and any single outbound frame to that ceiling.
- Bound a continuously nonempty backlog to 30 seconds, including silence and partial progress; superseding does not renew the deadline.
- Relieve byte pressure only by dropping explicitly replaceable market snapshots. Otherwise close the affected renderer, clear retained state, and let the existing reconnect/account-refresh path recover without replaying commands.
- Record a bounded overflow reason and queue measurements; retain current lane priority/count ceilings.

## Capabilities

### New Capabilities
- `renderer-backlog-bounds`: byte/time ceilings for local renderer delivery.

### Modified Capabilities
None. This extends the existing account-first/lossless-or-close transport rule without changing its payload or supersession semantics.

## Impact

Renderer outbox and main's overflow diagnostic callback; Spot/Futures share this transport. No exchange calls, request retries, automatic order cancellation or service restart. The configured byte ceiling bounds serialized payload retention, not total process RSS or serialization performed before admission.
