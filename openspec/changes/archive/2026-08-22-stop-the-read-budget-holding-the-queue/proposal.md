## Why

On 2026-08-22 the operator's first leverage change of the session answered in
26 368ms against a round that ordinarily takes about 2 000ms. The same shape is
in the record twice before: 49 576ms to set leverage on 2026-08-21, and 43 196ms
to change a margin mode on 2026-08-15. None of the three is longer than the
minute the desk's own read budget runs on, and none of them has a network fault
beside it.

The cause is the budget, not the exchange. Futures reads are admitted through a
queue that lets one request in at a time, and the request holding that slot does
its waiting inside it. When a start spends the minute's 800 weight — three
account passes of 90 land in the first three seconds — the request at the head
sleeps out the rest of the window still holding the slot, and nothing behind it
moves. `urgent`, which the operator's command already carries, only decides who
leaves the queue first; while the slot is held nobody leaves it at all. A
one-weight leverage command waited behind a ninety-weight read for a window that
had room for it.

Nothing in the record said so. The journal for that command reads: the command,
twenty-six seconds of book faults belonging to a different subsystem, then the
answer. A wait the desk imposes on itself and does not admit to reads as an
exchange that was slow, which it was not.

## What Changes

- A request that the read budget has no room for gives the admission slot back
  while it waits, and asks again, instead of sleeping on it. Reading the window
  and booking against it stay under the slot, so concurrent callers still cannot
  both claim the last of it.
- The desk records one line each time its own budget, and not the exchange, held
  a request back — what was waiting, whether it was the operator's business or
  the desk's housekeeping, how long, and how full the minute was.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-live-readiness`: a request waiting for the desk's own budget no longer
  stops every other request.
- `desk-diagnostic-record`: the record states when the desk made itself wait.

## Impact

Affected code is `RateLimiter` in `electron/services/binance-connection.js` — the
admission path every Futures REST read and both contract-configuration commands
take — and the field table in `electron/services/desk-diagnostic-record.js`.

Weight accounting, admission spacing, urgency and its bound, and cancellation
semantics are all unchanged; the seven existing `RateLimiter` tests pass against
the new code without modification. Independent of
`charge-every-binance-retry-weight`, which changes what is charged rather than
what waiting costs, though both touch the same class.
