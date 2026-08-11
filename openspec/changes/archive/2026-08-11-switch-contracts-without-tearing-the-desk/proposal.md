## Why

Switching contract sometimes leaves the desk unusable: the chart flickers
between the old contract and the new one, `RESYNCHRONIZING` comes and goes, and
the operator cannot trade. The operator reported it on 2026-08-11 with the main
process log, and the log names the cause outright.

**One throw during teardown skips the rest of the teardown.**

`createSocket(...).close()`
(`electron/services/futures-production-workstation-transport.js:358`) removes
every listener from the upstream WebSocket and then calls `socket.close()`. A
socket still in its handshake does not answer `close()` by closing: `ws` aborts
the handshake and *emits an error* — `WebSocket was closed before the connection
was established`. The listeners were just removed, so nothing is listening, and
Node's EventEmitter throws it. The throw travels synchronously back through the
abort listener the stream registered (`:669`) into
`AbortController.abort()`, and out of `FuturesProductionWorkstationService.stopCurrent`
(`futures-production-workstation-service.js:1029`) — the first statement in it:

```js
stopCurrent() {
    const session = this.current;
    this.current = null;
    if (!session) return;
    session.abortController.abort();      // ← throws here
    session.intervalAbortController?.abort();   // never runs
    session.stream?.close?.();                  // never runs
    session.orderBook.stop();                   // never runs
    // freshness, reconnect and interval-reconnect timers never cleared
}
```

So a contract switch that happens while any upstream socket is still connecting
leaves the previous session **half alive**: its depth, trade and kline sockets
stay open and keep delivering, its freshness and reconnect timers keep firing,
and its order book keeps running — while `this.current` already points at
nothing. `handleRequest` (`:143`) rejects, so the request that was supposed to
start the new contract never starts it, and the renderer's local connection is
torn down and re-established (`Peer 127.0.0.1 disconnected` … `Connection
accepted`, three times in the operator's log). What the operator sees is two
contracts' worth of data arriving against a desk that is repeatedly
re-subscribing from scratch.

The same log shows the second generation aborting instantly afterwards —
`upstream-streams 6ms error`, `ticker 6ms error`, `premium-index 6ms error` —
and then a later `upstream-streams 7504ms error`: the service never recovers
within the session.

## What Changes

- **A socket closes without throwing, whatever state it is in.** Closing a
  connection that has not finished its handshake is an ordinary event during a
  contract switch, not an error anyone should hear about.
- **Teardown is total.** Every step of stopping a session runs, and one step
  failing cannot skip the others: sockets, timers, the order book and the
  pending queues are released independently.
- **A failed teardown never blocks the next contract.** `handleRequest` must be
  able to start the generation the operator asked for even if stopping the
  previous one reported a problem, and must state that problem rather than
  reject the request that was about to succeed.
- **A dead session's timers cannot act.** A reconnect or freshness timer that
  survives its session performs no work when it fires.

## Trade-offs this accepts

- The teardown becomes best-effort per step rather than fail-fast. That is the
  correct shape for release: there is nothing to do about a socket that will not
  close, and the operator's next contract must not wait on it. Each failure is
  still reported through the service's internal-error path, so a teardown that
  starts failing is visible rather than silent.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: switching contract releases the previous
  contract's work completely and starts the next one, even when a socket is
  still connecting.

## Impact

- `electron/services/futures-production-workstation-transport.js` — a socket
  handle that survives being closed mid-handshake.
- `electron/services/futures-production-workstation-service.js` —
  `stopCurrent`, `haltSession` and `handleRequest`: total release, and a switch
  that proceeds.
- No renderer change is expected: the renderer already drops frames that do not
  name its own `requestId` and symbol
  (`src/hooks/useFuturesProductionWorkstation.js:262`). If the operator still
  sees two contracts after the backend is fixed, that is a second defect and
  belongs in its own change.
