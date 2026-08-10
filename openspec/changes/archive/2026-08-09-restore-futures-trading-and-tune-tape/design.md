## Context

See `proposal.md` for motivation and the three capability specs for the behavior contract.

The current backend selects mock mode from `!process.env.BK`, reads the secret independently, and deletes every `FUTURES_TESTNET_*`, `FUTURES_READ_*`, and `FUTURES_PRODUCTION_*` value before exposing any diagnostic. That single flag controls synthetic Spot/Futures orders, balances, tickers, candles, filters, seeded positions, and recurring fake stream timers. The renderer also initializes Spot chart/filter state from synthetic constants before live data arrives. These are runtime application paths, not merely test fixtures.

`AppShell` always initializes `marketMode` to Spot, while `DataProvider` wraps the entire application and starts Spot-oriented local-WebSocket subscriptions, cache work, and analytics regardless of the visible workspace. Futures therefore cannot be restored as the first workspace without first mounting the Spot data path. Market mode is not currently persisted.

The repository's ignored `.env.futures-live` currently declares only retired `FUTURES_PRODUCTION_*` names, while `npm run e` does not load that file. Under the revised contract the application is production-only: absent, partial, or retired-only credentials must stop before any Binance market/account initialization and must remain visible as a configuration error through a minimal local diagnostic shell.

Initial futures account refresh runs signed balance, regular-order, and position reads. Each failure is logged only in the Electron process; no failure state is broadcast. The renderer treats `balances === null` as perpetual `SYNC`, replaces its entire order array whenever `futures_orders` arrives, and has no representation for per-resource freshness. Refreshes after placement/cancel may request regular orders for one symbol even though the renderer treats the response as account-wide.

The chart already understands `REGULAR` versus `ALGO` identity and intentionally makes unsupported algorithmic orders display-only, but production composition forces every normalized order to `REGULAR`. The adapter calls only the regular open-orders endpoint and not Binance's current open-algorithmic-orders endpoint.

The market-data service retains a bounded raw trade array and emits the newest renderer rows on every aggregate-trade frame. The renderer can pause its displayed rows but cannot reduce backend emission, JSON parsing, hook state updates, or React render frequency. Separately, the chart builds and updates a MARK candle series and a horizontal MARK line.

The checkout already contains uncommitted futures latency and interaction-feedback work. Those edits are user-owned baseline work and must be preserved and integrated rather than overwritten. GitNexus classifies account refresh and trade emission changes as CRITICAL and readiness/workstation-view changes as HIGH.

## Goals / Non-Goals

**Goals:**

- Remove every non-test runtime mock/fallback data path from both Spot and Futures.
- Fail startup before Binance initialization when the supported credential pair is unavailable, with a sliding alert and blocking recovery screen.
- Restore the last explicitly active Spot/Futures workspace before market mount and lazy-load only the selected market path.
- Establish one structured source of truth for credential readiness, account-resource state, readiness, and safe diagnostics.
- Preserve account-wide state while deriving symbol-specific presentation.
- Represent both Binance regular and algorithmic open-order namespaces without identity collisions.
- Reduce bounded-tape IPC and renderer work under burst traffic while keeping a current trailing snapshot.
- Remove only the obstructive MARK chart presentation without weakening mark-price-dependent account or risk behavior.
- Make each high-risk boundary independently testable with deterministic clocks and mocked Binance transports.

**Non-Goals:**

- Bypassing Binance API permissions, IP restrictions, timestamp validation, operator pause, or the optional local notional cap.
- Restoring the retired arming/passphrase/intent-token safety subsystem.
- Providing public/read-only application operation when production credentials are missing.
- Defaulting to Spot when persisted market selection is absent or invalid.
- Removing mocks, fixtures, fake clocks, or injected transports that exist only in tests and cannot enter a production build.
- Importing or rewriting secret values in `.env.futures-live`; migration of local secrets remains an operator action.
- Adding source-aware algorithmic order creation, amendment, or cancellation where those operations are not already supported.
- Placing a real exchange order as part of automated or acceptance testing.
- Changing Spot trading behavior or the authoritative execution command format beyond shared diagnostics that are intentionally versioned.

## Decisions

### 1. Make startup production-only and remove the runtime mock layer

Introduce a pure credential preflight that reads only presence metadata, never secret contents, before constructing any Binance client, adapter, stream manager, or market-specific renderer provider:

```text
READY         supported BK + supported BS
CONFIG_ERROR  neither value, a partial pair, or retired-only credentials
```

The Electron process may still start its loopback-authenticated local diagnostic server so the renderer can receive a bounded startup envelope. On `CONFIG_ERROR`, it constructs no Binance client, opens no Binance REST/WebSocket transport, and rejects any command with `EXECUTION_NOT_CONFIGURED`. The renderer mounts only its notification/bootstrap shell, emits one sliding error alert, and shows a blocking configuration screen. Restart with a complete credential pair is the recovery path.

Remove `USE_MOCK`, runtime fake-data generators and intervals, seeded Futures state, simulated Spot/Futures order execution branches, and renderer initial fake candles/filters. Empty/loading/error values replace synthetic initial data. Production order success is emitted only from an authenticated adapter response. A build/static regression test prevents known runtime mock symbols or imports from re-entering production artifacts; test files may continue using isolated mocks and fixtures.

The supported pair remains `BK` / `BS`. Legacy names are inspected before scrubbing so the diagnostic can explain migration without reading values. `FUTURES_MAX_ORDER_USDT` remains an independent optional risk setting.

Alternative considered: keep public charts available without credentials. Rejected by the operator's fail-fast requirement. Accepting retired credential names implicitly was also rejected because those names belonged to a different, retired execution model and silent reinterpretation could unexpectedly authorize real trading.

### 2. Bootstrap the persisted market before market-specific providers

Move market selection above Spot/Futures providers into a minimal bootstrap shell under the shared notification provider. Startup ordering is:

```text
Electron credential preflight
  -> renderer startup envelope
  -> CONFIG_ERROR screen, or read persisted market selection
  -> persisted Spot/Futures: lazy import + mount that workspace only
  -> missing/invalid selection: neutral selector, no market mount
```

Use the existing bounded storage helper with a dedicated versioned key. Read and validate it in a lazy state initializer before the first market render. Persist only an explicitly and successfully activated `spot` or `futures-live` value. Missing, unreadable, or invalid storage maps to an internal `UNSELECTED` bootstrap state; it never maps to Spot.

Extract the lightweight authenticated local WebSocket/control ownership from the Spot-specific data provider, or equivalently place it in a neutral gateway provider. Refactor the current Spot body into a lazy `SpotWorkspace` whose provider starts Spot subscriptions/cache/analytics only while active. Load `FuturesProductionWorkstation` through its own lazy boundary. Switching unmounts or generation-stops the active market-specific provider before the next starts; already imported JavaScript may remain cached, but inactive requests, subscriptions, polling, and timers do not.

Alternative considered: persist `marketMode` inside the current `AppShell` while leaving `DataProvider` mounted. Rejected because Spot work would still initialize before the stored Futures choice is known. A hard-coded Spot fallback was explicitly rejected by the operator.

### 3. Replace fire-and-forget snapshots with resource envelopes and alert transitions

Maintain backend state for `balances`, `positions`, `regularOrders`, `algoOrders`, and `userDataStream`. Each resource carries `status`, `data`, `updatedAt`, and an optional sanitized error `{ code, category, message, retryable }`. Status transitions are explicit:

```text
idle -> loading -> ready
ready -> loading -> ready
ready -> loading -> stale   (refresh failed; last data retained)
idle/loading -> error       (no confirmed data exists)
```

`refreshFuturesAccountState` broadcasts loading before work and uses independent settlement so one failed endpoint cannot hide successful resources. A central error mapper translates HTTP/Binance/transport failures into stable categories such as credentials, permission, clock, network/proxy, rate limit, and exchange. It emits bounded text only and never the request URL, signed query, signature, key, or secret.

The renderer hook consumes one versioned account-state envelope and treats data and freshness as inseparable. A stale balance remains visible for diagnosis but cannot enable percentage sizing or exposure-increasing submission. Zero available USDT is represented as valid ready data, not as missing data.

Bridge error transitions into the existing `NotificationProvider`/`NotificationToast`, which already supplies the requested slide-in presentation. Fingerprint active errors by market, resource/action, and stable code. Emit once when a fingerprint becomes active, suppress identical retry repeats, clear the fingerprint after recovery, and alert again if it later recurs. The toast remains transient/dismissible; the structured error and Retry control remain in the blocking screen or ticket so dismissal never erases diagnosis.

Alternative considered: continue broadcasting the existing three untyped payloads and add one `lastError`. Rejected because concurrent reads can partially succeed, a single error cannot identify freshness of each resource, and an empty array cannot distinguish "no orders" from "orders unavailable." Creating a second notification system was rejected because the existing toast already provides the required animation, stacking, timing, and history.

### 4. Keep order sources separate and combine them through selectors

The adapter adds a signed read for Binance's current `/fapi/v1/openAlgoOrders` endpoint and normalizes it into the same domain shape as regular orders while retaining `orderKind: REGULAR | ALGO`. Internally the account model stores two independently fresh maps keyed by a source-qualified key such as:

```text
REGULAR:<symbol>:<orderId-or-clientOrderId>
ALGO:<symbol>:<algoId-or-clientAlgoId>
```

REST account refreshes request orders without a symbol so the authoritative snapshot is account-wide; rate-limiter weights are updated to the official all-symbol costs. Symbol selection remains a renderer selector only. User-data updates merge into the appropriate source when the event contract provides a stable identity; reconnects, ambiguous events, and post-action refreshes trigger REST reconciliation rather than guessing.

`FuturesProductionWorkstation` passes selected-symbol orders to the chart and ticket without forcing the kind. Existing chart safeguards remain: supported regular limit orders may use the existing confirmed cancel-and-replace gesture, while ALGO orders remain visible but non-draggable until a source-aware amendment contract is designed. The sidebar and chart share the same selector and surface partial/stale source state.

Alternative considered: concatenate two endpoint arrays and keep numeric `orderId` as the key. Rejected because regular and algorithmic identifiers are separate namespaces and can collide.

### 5. Derive readiness from structured reason codes

Move readiness to a pure selector over successful credential preflight, local transport, operator pause, selected-contract status and filters, account resource states, available USDT, draft validity, and the backend notional cap. The selector returns one primary blocking code plus details; labels, disabled controls, gesture feedback, notifications, and submit guards all consume that result.

The order of precedence is safety-first: configuration/mode, connection, operator pause, contract/filter metadata, account freshness, funds/sizing, draft validation, then notional ceiling. Backend enforcement remains authoritative even when the renderer believes the draft is ready.

Alternative considered: keep `balances === null` as the account gate and add more strings in the component. Rejected because it cannot distinguish loading, configuration failure, resource error, stale data, or zero balance and would continue duplicating enforcement logic.

### 6. Remove MARK presentation at the chart boundary

Delete creation, updates, price-format changes, and price-line creation for the MARK chart series. Keep current premium-index/mark-price data in the workstation header and account/risk pipelines. Keep the INDEX reference and main contract candles unchanged. Historical mark-candle transport can remain temporarily if another consumer is found during implementation impact analysis; if GitNexus and tests show it is visual-only, remove that unused bootstrap/stream lane in the same change to avoid needless work.

Alternative considered: hide the MARK series with transparent styling. Rejected because it retains series updates, autoscale interactions, and inaccessible labels while pretending the feature is gone.

### 7. Configure tape filtering and throttling through the bounded protocol

Add a validated `CONFIGURE_TAPE` workstation request carrying:

```text
throttleEnabled: boolean
timeoutMs: finite integer in [16, 5000]
minNotionalUsdt: finite decimal >= 0
```

The initial effective settings are throttle enabled, `timeoutMs = 250`, and `minNotionalUsdt = 0`. They are scoped to the active renderer workstation, survive symbol/interval selection during that component lifetime, and reset on application restart. This avoids hidden persistence while providing an anti-lag default that does not hide trades.

The service continues to ingest a bounded authoritative raw tape. Before renderer delivery it filters rows using `abs(price) * abs(quantity) >= minNotionalUsdt`, then applies the existing renderer row bound. With throttling enabled, the first eligible state may emit immediately, subsequent events inside the window only mark a trailing update pending, and the timer emits the newest eligible bounded state at most once per window. A config change recomputes and emits the effective view without restarting market sockets.

The service session owns the pending timeout handle and generation. Teardown, resync, symbol change, unsubscribe, and disposal clear or invalidate the timer. Freshness bookkeeping continues from incoming valid trades, not only from rendered trades, so a high notional threshold does not falsely mark the market stream stale. Renderer Pause remains a local freeze of the latest delivered rows.

Alternative considered: filter and debounce only in React. Rejected because it would still send and parse every IPC/WebSocket message and update hook state. Dropping below-threshold frames before normalization was also rejected because the service needs valid trade arrival for freshness and may need to recompute after configuration changes.

### 8. Extend existing protocol limits and tests rather than adding a side channel

The new action uses the existing bounded workstation JSON parser, version/environment/channel validation, local WebSocket authorization, generation checks, and injected clock. Request byte/depth/node bounds are adjusted only as much as the three scalar fields require. Unit tests use a fake clock to prove emission ceilings, trailing delivery, invalid-input handling, and timer cleanup.

Alternative considered: keep tape preferences exclusively in renderer state and send ad hoc messages. Rejected because an unvalidated side channel would bypass the protocol's bounds and make service behavior harder to test.

## Risks / Trade-offs

- **[Production-only startup is intentionally unavailable without keys]** Operators lose the previous synthetic/public fallback when credentials are absent. → Fail before external networking, show the exact supported names and restart guidance, and never imply that the application is usable with fake data.
- **[Runtime MOCK removal crosses Spot and Futures]** Deleting shared branches can regress Spot subscriptions, order handling, E2E startup, or empty-state rendering. → Separate production runtime from test injection explicitly, add empty/loading-state tests, and retain mocks only behind test-owned modules and dependencies.
- **[Lazy market bootstrap changes provider ownership]** Moving mode selection above the current Spot `DataProvider` can leak subscriptions or briefly mount both markets. → Keep one minimal shared gateway, use lazy imports plus market-scoped providers, verify teardown/generation guards, and assert zero inactive-market requests.
- **[No fallback for absent/corrupt storage]** A first run cannot infer a previous workspace. → Present a neutral selector and persist the first explicit choice; never invent a Spot selection.
- **[CRITICAL account-refresh blast radius]** Changes can affect placement, cancellation, cancel-all, typed commands, and user-data startup. → Preserve backend enforcement, introduce the envelope behind focused adapter/connection tests, and run all d=1 process tests before integration tests.
- **[CRITICAL tape-emission blast radius]** Timer changes can affect bootstrap, reconnect, interval selection, freshness, and teardown. → Use the injected clock, store timer ownership in the generation session, and test each caller identified by GitNexus.
- **[HIGH renderer blast radius]** Readiness and workstation composition reach `AppShell` and `App`. → Keep selectors pure, update hook/component contracts atomically, and add regression tests for Spot/Futures navigation.
- **[Higher all-symbol request weight]** Account-wide open-order reads cost more than symbol-scoped reads. → Use official endpoint weights, the dedicated futures limiter, in-flight deduplication, user-stream merges, and reconciliation only on startup/reconnect/operator refresh/post-action events.
- **[Partial order visibility]** One order source may be stale while the other is current. → Preserve source-level state and show a partial-sync indicator; never collapse partial failure to an empty list.
- **[Last-known balance may be misleading]** Retaining stale data improves diagnosis but could appear tradable. → Show age/stale state and require ready balances for new exposure.
- **[Throttle adds bounded visual latency]** A 250 ms cadence is less immediate than per-tick rendering. → Keep timeout configurable down to one-frame scale and preserve the latest trailing state.
- **[Legacy configuration migration]** Existing launchers using retired names will stop at `CONFIG_ERROR`. → Detect names before scrubbing, document the exact `BK`/`BS` migration, never print values, and perform no Binance initialization until the supported pair is present.
- **[Existing dirty changes overlap]** Applying from a clean specification could overwrite user feedback/latency work. → Treat the current diff as baseline, inspect it before each patch, and avoid reset/checkout operations.

## Migration Plan

1. Record the existing dirty diff and run GitNexus impact for every symbol that will be edited across Electron startup, Spot, Futures, notifications, and market-provider ownership; stop and report any new HIGH/CRITICAL surface not covered here.
2. Add credential-preflight/startup-envelope tests, then make the backend fail before Binance initialization for absent, partial, or retired-only credentials.
3. Remove all production runtime MOCK generators, branches, seed states, timers, simulated executions, and renderer fake initial data while preserving explicitly test-only fixtures/injection.
4. Introduce the neutral bootstrap/gateway boundary, persisted market selection, no-fallback selector, lazy Spot/Futures workspaces, and inactive-market cleanup tests.
5. Add resource-state/error helpers, bridge deduplicated transitions into the existing sliding toast, and wire account/user-stream state through the Electron connection and renderer hook.
6. Add account-wide regular/ALGO adapter reads and source-qualified normalization; update rate weights and adapter tests against recorded fixtures.
7. Update readiness, ticket, identity heading, sidebar, and chart selectors; verify config-stop, first-run selection, restored Spot/Futures, zero-funds, stale, partial-order, and ready states.
8. Extend the bounded workstation protocol, service, hook, and UI controls; prove timer cleanup and emission bounds with fake-clock tests.
9. Remove MARK chart presentation and update visual/accessibility tests while retaining required mark-price consumers.
10. Update operator documentation with mandatory supported credentials, no-MOCK behavior, persisted/lazy market startup, diagnostics, tape semantics/defaults, and no-secret logging guarantees.
11. Run focused tests, production artifact checks for runtime mock code, the repository QA target, GitNexus change detection, and a public `TUTUSDT` metadata smoke check after credentials pass startup. Run authenticated read-only smoke tests only with explicit operator approval and never place a live order as an automated check.

Rollback is a code rollback plus removal or ignoring of the versioned local market-selection key; the change adds no database migration and does not alter existing Binance orders. On rollback, clear pending market/tape timers during provider/service disposal. Local credential files are not modified automatically, so the operator can restore launcher configuration independently.
