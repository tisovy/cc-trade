## Why

The audit found that neither the active market nor the local runtime is
isolated, and that the recurring `invalid token` episode is a bootstrap race in
this application rather than a Binance failure.

- Futures commands and subscriptions are accepted before `activate_market` and
  after a switch back to Spot, so the backend performs work for a market the
  operator is not on.
- On a warm lazy switch, child effects issue refresh and subscribe calls before
  the parent activation has run, so ordering depends on effect scheduling.
- In the Spot channel manager an unfinished `connect` can resolve after cleanup
  and revive a WebSocket that was already torn down.
- The `invalid token` flood is a confirmed race: the `BrowserWindow` is created
  before the runtime is registered for its sender, the preload asks for the
  runtime synchronously, and an unregistered sender permanently receives the
  fallback `127.0.0.1:14477` with an empty token. `src/hooks/useWebSocket.js:194`
  then reconnects every 500 ms with no terminal handling for an authentication
  failure, so a fatally misconfigured renderer retries forever.
- The observed episode was amplified by a parallel audit E2E run whose renderer
  reached the development backend. The E2E process was stopped and no restart of
  the development application is required, but the absence of isolation between
  a verification run and a development runtime is a real defect.

This change closes the race and the isolation gaps. It does not restate the
existing `futures-live-readiness` guarantee that verification entry points
carry no production credentials; it adds the transport-level separation that
guarantee assumes.

## What Changes

- A market-scoped command, subscription or refresh is accepted only while that
  market is the activated one; anything arriving before activation or after a
  switch is rejected with a stable reason and starts no work.
- Activation is generation-isolated: work scheduled by a child of the workspace
  cannot reach the backend before its parent activation, and work belonging to a
  superseded activation is discarded.
- A connect that resolves after its channel was cleaned up is discarded instead
  of reviving the connection.
- The renderer runtime endpoint and token are registered before the window that
  will request them exists. An unregistered sender receives no runtime at all
  and the renderer fails closed with a stated reason; the fallback endpoint with
  an empty token is removed.
- An authentication failure on the renderer transport is terminal: the retry
  loop stops, the failure is surfaced, and reconnection resumes only on an
  explicit operator action or a new runtime registration.
- One renderer runtime cannot address another runtime: endpoint and token are
  separated per runtime instance.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the inactive market is quiescent at the
  backend boundary as well, and activation is generation-isolated against child
  effects and late connects.
- `futures-live-readiness`: the renderer runtime is issued before any window can
  request it, no fallback endpoint or empty token exists, an authentication
  failure is terminal, and each runtime is addressable only by its own renderer.

## Impact

- Main process: `electron/main.js` (runtime registration ordering),
  `electron/env-setup.js`, `electron/services/binance-connection.js` (market
  activation gate, Spot channel manager cleanup).
- Renderer: `src/hooks/useWebSocket.js` (terminal authentication handling),
  `src/context/GatewayContext.jsx`, `src/context/DataContext.jsx`,
  `src/App.jsx` (activation ordering across lazy workspaces).
- Verification: retained integration coverage constructs independently issued
  runtimes and proves that their endpoint/token pairs cannot cross;
  `package.json` scripts and `scripts/` checks follow.
- Operator-visible change: a renderer that cannot obtain a runtime shows a
  stated failure instead of an endless reconnect.
- Blocks live Futures.
