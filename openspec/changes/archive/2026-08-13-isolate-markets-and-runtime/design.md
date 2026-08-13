## Context

The renderer and the Electron main process share one local WebSocket transport,
but market activation and renderer authentication are separate trust
boundaries. Before this change, renderer effect ordering could send work before
activation, a late channel connect could survive cleanup, and a window could
request its runtime before the main process registered it. The fallback runtime
then turned that bootstrap race into an endless invalid-token retry loop.

The change spans the main-process transport, renderer connection lifecycle,
lazy market workspaces, and retained Node integration coverage. It therefore
needs one design that keeps market ownership, connection ownership, and runtime
identity independent.

## Goals / Non-Goals

**Goals:**

- enforce the active market and activation generation at the backend boundary;
- prevent work from a superseded activation or a connection that outlives its
  cleanup;
- issue a renderer runtime before its window can request it and fail closed
  when no runtime exists;
- make authentication rejection terminal while preserving retries for ordinary
  transport loss;
- prove with retained Node integration coverage that independently constructed
  runtimes have independent endpoint/token pairs and reject crossed tokens
  before market or account work starts.

**Non-Goals:**

- changing exchange credentials or Binance API semantics;
- allowing more than one market to be active for a renderer connection;
- using Playwright, a browser, or production exchange traffic for runtime
  isolation verification;
- replacing existing market-specific request validation.

## Decisions

### Backend activation is connection-owned and generation-stamped

The backend owns the accepted active market and mints an activation generation.
Every market-scoped frame is stamped at the renderer transport write boundary,
then checked against the accepted market and generation before channel work can
start. The transport removes the stamp before a channel validates its own
closed request shape. Activation requests are serialized so rapid switches
settle on the last request in receive order.

This keeps correctness independent of React effect ordering and also prevents
an old Spot frame from becoming valid merely because the operator later
returns to Spot.

### Connection cleanup invalidates pending connects

A channel connect attempt belongs to the lifecycle generation that started it.
Cleanup invalidates that generation and tears down sockets, timers, and
handlers. A connect that resolves afterwards is closed and discarded rather
than adopted or allowed to schedule a reconnect.

### Runtime registration precedes window creation

The main process creates and registers the endpoint/token pair for a renderer
before constructing the `BrowserWindow`. Runtime lookup has no default endpoint
and no empty-token result. A renderer without a registration reports a bounded
startup failure and makes no connection attempt.

### Authentication rejection is terminal for one issued runtime

The local server rejects a foreign token before registering the connection or
dispatching any market/account frame. The renderer treats that close as
terminal for the issued runtime, surfaces the reason once, and retries only
after explicit operator action or receipt of a newly issued runtime. Other
transport closures retain the existing reconnect behaviour.

### Runtime isolation is proved at the real local transport boundary

The retained integration test creates two independent main/renderer runtime
compositions on separately bound loopback endpoints and uses real Node
WebSocket clients. It proves both own-token success directions and both
cross-token rejection directions, while exchange adapters are spies so the
test can assert zero market/account work without external traffic. Tokens are
compared in memory and never printed or recorded.

## Risks / Trade-offs

- **A stale async result can race a later activation.** Generation checks are
  applied before work and again where late results could otherwise be adopted.
- **Accepting a socket only to close it for authentication could expose a
  handler briefly.** The server authenticates before connection registration
  or frame dispatch and uses the stable `4401 invalid-token` close result.
- **Dynamic loopback ports can race between reservation and bind.** Each test
  composition owns a separately reserved endpoint, closes all controllers in
  cleanup, and is exercised repeatedly in the archive audit.
- **Terminal authentication handling could suppress recovery from an ordinary
  outage.** Only the explicit authentication result is terminal; other losses
  follow the existing retry path.

## Migration Plan

1. Ship the main-process activation/runtime changes and renderer stamping and
   terminal-auth handling as one compatible unit.
2. Run retained unit/integration suites and the production boundary guards.
3. If rollback is required, roll back both sides together so the activation
   envelope and runtime bootstrap contract remain aligned.
