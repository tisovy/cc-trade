# Phase 8.0–8.2 USDⓈ-M Futures workstation threat model

Date: 2026-07-14

Status: accepted for implementation

Historical status: superseded in part on 2026-07-16 by retirement of Futures
Testnet. The Testnet trust boundaries below document the former system and are
not active runtime guarantees. See
[the retirement plan](./futures_live_performance_and_testnet_retirement_plan.md).

Browser-driven automation was removed on 2026-08-10. References below to an
E2E session guard, Playwright evidence, or automated screenshots describe the
former verification system and are retained only as historical evidence.

Related ADR: `docs/futures_phase8_workstation_adr.md`

## Assets and safety properties

The milestone protects:

- the operator's unambiguous knowledge of Testnet versus real-money production;
- the integrity, freshness and symbol ownership of displayed market data;
- the Phase 6 and Phase 7 execution boundaries, caps, kill switch and durable recovery;
- Spot availability and priority;
- exact decimal values and lossless exchange identities;
- backend-only origins, paths, network policy and future credential material;
- bounded CPU, memory, queues, sockets and timers during hostile market bursts;
- the guarantee that no chart, order-book or tape gesture submits or prepares an order.

The renderer is not trusted to choose environment, transport, host, capability, freshness, continuity or execution success. Binance responses and stream frames are untrusted external input. Local renderer WebSocket clients are untrusted even though the listener is loopback-only and token-bound.

## Trust boundaries

1. **Binance public network → environment-specific backend transport.** Exact origin/path, redirect, content-length, timeout and schema checks apply before normalization.
2. **Backend transport → generation-owned read-model reducer.** Only exact normalized events for the current symbol generation can mutate state.
3. **Read-model reducer → local renderer WebSocket.** Fixed channel identity, revision, frame and row budgets apply. No raw exchange payload is forwarded.
4. **Renderer container → pure shared presentation.** Immutable data and local-draft callbacks only.
5. **Presentation → Phase 6/7 safety drawers.** There is no callback edge from chart/book/tape to an execution action. The existing tickets retain their own exact protocols.
6. **Testnet composition ↔ production composition.** There is no shared host, protocol, environment option, credential, transport instance, clock, cache, storage or recovery namespace.
7. **Futures ↔ Spot.** Phase 8 does not import Spot `DataContext`, command builders, legacy request aliases or global shortcuts.

## Threat inventory and controls

| Threat | Failure mode | Required control | Evidence |
|---|---|---|---|
| Environment confusion | Production data/action is shown under blue Testnet identity or vice versa | distinct channels, protocols, containers and CSS roots; exact environment validation; permanent banner at every width | cross-channel rejection and desktop/narrow screenshots |
| Host substitution | Caller supplies alternate Binance, proxy, redirect or DNS-like URL | compile-time exact origins and paths; no caller network options; redirect and final-URL rejection | route/host scan and transport tests |
| Proxy bypass or split routing | Chromium/Spot honors the operator proxy while Node Futures REST/WSS silently connects directly or times out | each environment transport resolves one backend-only bounded agent for both exact HTTPS and WSS origins; invalid proxy configuration fails closed; teardown destroys the agent | proxy REST/WSS identity, caller-option rejection, invalid-config, redirect and body-bound tests |
| Shared-proxy noisy neighbor | an unrelated local collector opens dozens of simultaneous Binance tunnels and starves the workstation before a Binance response exists | active-workspace-only lifecycle; one workstation REST request at a time; one reusable backend proxy connection; fixed 99-row/weight-1 candle reads; no automatic HTTP retry fan-out | lazy lifecycle, single-flight failure cancellation, proxy-agent bounds and exact request registry tests |
| Automated production escape | a fake-backed test unexpectedly reaches Binance | fail-fast fetch/WebSocket tripwire plus E2E session guard; fake compositions are explicit | escape-guard tests and zero-attempt assertion |
| Renderer network authority | compromised renderer opens Binance directly | CSP plus static scan; exactly one bounded loopback connector with runtime-owned access and no caller URL; no Binance `fetch`, socket, URL or host in the renderer closure | renderer scan, connector tests and bundle scan |
| Protocol confusion | Testnet request is accepted by production service or generic action aliases a Futures command | exact channel/action/version/environment keys; no generic Futures handler | bidirectional confusion tests |
| Execution smuggling | chart/book/tape gesture or Enter creates an execution intent | local draft callback only; forbidden execution fields in read protocol; no generic Enter listener | click/key tests and action-spy assertions |
| Late symbol event | delayed BTC event mutates an ETH view | monotonic backend generation and renderer request/generation ownership | rapid switch and teardown tests |
| Book gap | missing/reordered diff displays a false order book | snapshot bootstrap, `U/u/pu` validation and full rebuild before `live` | gap/reorder/overlap/resync tests |
| Book bootstrap race | deltas arrive around the REST snapshot and are applied incorrectly | bounded pre-snapshot buffer and exact first-event rule | before/during/after snapshot race tests |
| Duplicate event | repeated delta/trade/candle corrupts quantity or rows | update-ID/idempotency checks and replacement by exact identity | duplicate tests |
| Buffer exhaustion | burst consumes unbounded memory or starves Spot | hard byte/item limits; authoritative depth overflow discards uncertain state and resyncs, while the non-authoritative bounded tape evicts oldest pre-bootstrap rows without repeating REST bootstrap; separate rate budget | overflow/burst tests and Spot regression |
| Bootstrap request amplification | one timed-out request leaves queued siblings running, consumes the local budget and hides the first failure behind `READ_WEIGHT_EXHAUSTED` | wait for both WSS handshakes; create each request only after its predecessor succeeds; suppress every later read on first failure; explicit deadline code | readiness, deadline and first-failure single-flight tests in both environments |
| Cancellation confusion | an active request deadline is mistaken for intentional generation teardown and leaves the renderer permanently `loading` | only an aborted generation owner is silent; active `AbortError` and mapped deadlines terminate visibly as `unavailable` | symmetric active-AbortError state tests |
| Malformed/schema-drift input | coercion admits floats, out-of-range uint64, COIN-M or extra data | exact-key validators including non-rendered fields and all seven filters; canonical decimal strings; unsigned-int64 identity strings; `st=1`; bounded JSON | schema and fuzz matrices |
| Clock regression | stale data appears newer | fake monotonic clock gate; regression marks stale and starts a generation | fake-clock regression tests |
| Reconnect optimism | reconnected socket immediately looks live while snapshot is old | stale on disconnect; authoritative REST/bootstrap required before `live` | reconnect state tests |
| Partial resource failure | header is live while depth failed but whole screen looks healthy | per-resource state and timestamps plus aggregate status | UI state matrix |
| Secret leakage | credential/signature/listen key/private response reaches renderer/log/storage | this slice is public-only; exact schemas; sanitizer inheritance; forbidden-token scans | source/bundle/log/storage tests |
| Financial precision loss | decimal or int64 is converted through JavaScript `Number` | canonical decimal strings and decimal-string comparisons; identities are strings | boundary tests with >2^53 IDs |
| Stale renderer replay | an old event with valid channel overwrites a later revision | active request ID, generation and strictly increasing revision checks | duplicate/out-of-order renderer tests |
| Multiple-window cross-talk | one window's symbol generation mutates another | service instance and request ownership per renderer connection | two-session isolation tests |
| Timer/socket leak | symbol churn or terminal bootstrap leaves old reconnects or sockets active | generation-owned abort, terminal halt, reset reconnect budget, bounded local handshake/reconnect timers and idempotent stop | fake-timer teardown tests |
| UI truncation | narrow layout hides environment identity or state | sticky full-width banner and duplicated environment label inside workspace rail | narrow Playwright screenshot/assertion |
| Shared presentation escalation | pure component imports authority later | production closure static scan forbids network, storage, environment and execution protocols | `check:futures-production` expansion |
| Phase 5/6 mutation | new functionality weakens frozen services | new modules only; production closure import ban | GitNexus changes plus static isolation scan |
| Phase 7 bypass | a new production write path appears with the workstation | Phase 8 protocols contain only read actions; endpoint registry contains only GET public routes | route/action/write scans |
| Spot starvation/regression | Futures burst changes the CRITICAL Spot limiter or UI | separate bounded workstation budgets; existing Spot limiter untouched | Git diff/GitNexus plus full regression |
| Hidden Spot depth ownership | switching to Futures leaves Spot trade/depth streams active behind the workspace | `marketMode` is an explicit dependency of the Spot depth effect; both Futures modes send `disable_depth_view`, returning to Spot re-enables it | App mode-switch lifecycle regression |

## Adversarial state transitions

The initial healthy path for a symbol generation is:

`loading → live`

Permitted degradation paths are:

- `live → stale → resynchronizing → live` after a recoverable deadline or reconnect;
- `loading|resynchronizing|live → disconnected` after local/backend connection loss;
- any non-idle state → `unavailable` after schema rejection, exhausted reconnects or an unrecoverable bootstrap;
- any state → teardown, after which no event is deliverable.

There is no direct `disconnected → live`, `stale → live` or `unavailable → live` transition without a new authoritative generation. A header becoming live cannot upgrade a stale book. A stale book remains visibly stale even if trades continue.

## Abuse cases

The implementation must reject or safely degrade when an attacker:

- sends duplicate JSON keys or more than the exact request fields;
- supplies lowercase, whitespace-padded, non-USDⓈ-M, non-catalog or oversized symbols;
- supplies an undocumented interval or an `environment`, `host`, `url`, `headers`, `proxy`, `agent` or credential field;
- switches symbols repeatedly while old REST promises and sockets resolve late;
- gives a snapshot `lastUpdateId` above all buffered deltas;
- sends `U/u/pu` as strings with signs, leading zeros or values above unsigned-int64; valid identities above `2^53` remain lossless strings;
- sends an internally crossed book, duplicate prices, noncanonical decimals or zero/negative prices;
- floods more than the depth/trade/candle/frame/queue budget;
- sends `st=2`, a mismatched `s`/`ps`, or a combined-stream name for another symbol;
- regresses event time or fake clock time;
- causes redirect, alternate final URL, slow body, oversized body or bad content type;
- closes during bootstrap, between snapshot and buffered replay, or during reconnect;
- clicks chart/book rapidly, double-clicks, presses Enter, or focuses an execution ticket while market events arrive;
- replays a Testnet event on the production channel or a production event on Testnet;
- inserts credential-like fields into fake payloads hoping they are forwarded.

## Residual risks accepted for 8.0–8.2

- Public market data can be wrong at the exchange or network source; the workstation proves protocol continuity, not economic truth.
- A single official source does not provide Byzantine redundancy. Cross-venue validation is outside this milestone.
- Browser chart rendering uses numeric coordinates because `lightweight-charts` requires them. Canonical strings remain the read-model source, and numeric conversion is presentation-only; no financial decision or execution input is derived from it.
- The local price draft is visually useful but is not persisted or connected to an execution intent in this milestone.
- Drawings and alerts are renderer-local presentation aids. They are not durable financial records and cannot trigger execution.
- Production public reads are implemented behind an explicit separately composed reviewed transport, but automated verification remains fake-only and does not authorize invoking that transport.

## Exit conditions

This threat model is satisfied only if:

1. every exact protocol and transport boundary has deterministic positive and negative tests;
2. gap, race, overflow, reconnect, clock and teardown matrices pass;
3. no renderer or bundle scan finds network, credential, write or financial-storage authority;
4. blue/red identity and degraded states remain visible at desktop and narrow widths;
5. the old Phase 6 and Phase 7 tickets still pass unchanged;
6. the full Spot/Phase 5/6/7 suite passes;
7. no real production request or credential is used; and
8. no new Live execution action exists.
