# ADR: Phase 8.0–8.2 USDⓈ-M Futures read-only workstation

Date: 2026-07-14

Status: accepted for the Phase 8.0–8.2 milestone

Planning checkpoint: `b597f67fd61f3b4bb8e4ccd6bf4d2cd8e6e19fc5`

Production execution base: `dcd2260c5aed73b268a6e1f12cac2c3cb8849873`

## Decision

Phase 8.0–8.2 adds two separately composed, public-read-only USDⓈ-M market-data workstations:

- `FuturesTestnetWorkstation`, rendered with permanent blue Testnet identity;
- `FuturesProductionWorkstation`, rendered with permanent red Live identity.

They share only immutable presentation models and pure presentation components. They do not share an environment selector, host option, credential option, protocol identifier, channel, transport, storage namespace or recovery owner. The renderer sends only separately named subscribe, switch-symbol, switch-interval and unsubscribe requests to the local Electron backend. It never connects to Binance.

The Phase 5 read-only subsystem, Phase 6 Testnet reduce-only subsystem and Phase 7 production safety kernel stay intact. Their modules are not imported into either Phase 8 market-data backend composition. The Phase 6 and Phase 7 tickets remain mounted as explicit safety drawers. Chart, depth and tape interactions can set a renderer-local price draft but cannot create an execution intent or submit an order.

## Official contract freeze

The following contract was rechecked only against the current official Binance developer documentation on 2026-07-14. Binance documentation reported a 2026-07-13 update and a completed 2026 WebSocket routing migration.

Official references:

- [USDⓈ-M general information](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/general-info)
- [WebSocket connection contract](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Connect)
- [WebSocket routing migration](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice)
- [Local order-book procedure](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly)
- [USDⓈ-M common definitions and exact symbol filters](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/common-definition)
- [REST market-data catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)
- [WebSocket market-stream catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/websocket-api/public)

### Exact origins

| Composition | HTTPS origin | WSS origin | Authority |
|---|---|---|---|
| Testnet workstation | `https://demo-fapi.binance.com` | `wss://demo-fstream.binance.com` | public read only |
| Production workstation | `https://fapi.binance.com` | `wss://fstream.binance.com` | public read only |

Origins are compile-time constants in separately named backend modules. A caller cannot provide a URL, origin, hostname, path, redirect policy, proxy, agent, dispatcher, socket factory, headers or timeout. Every HTTP response with `redirected === true` or a final URL outside the exact origin and path is rejected. Automated and E2E compositions use deterministic fakes; a network escape to any frozen Futures host is a fail-fast test error.

An operator-configured `HTTPS_PROXY`/`https_proxy` (falling back to `HTTP_PROXY`/`http_proxy`) is backend process configuration, not a workstation request option. Each reviewed environment transport independently resolves one bounded HTTP(S) or SOCKS tunnel agent and uses that same private agent for its exact HTTPS origin and routed WSS origin. The agent permits at most two sockets, retains at most one idle socket and serializes workstation REST reads so the catalog and bootstrap can reuse one established proxy/TLS path instead of opening a CONNECT tunnel per endpoint. The proxy cannot replace the Binance URL, TLS target, route, redirect policy, headers or timeout, and it is never returned through the read model. Unsupported or malformed proxy configuration fails closed as `INVALID_PROXY_CONFIGURATION`; transport teardown destroys the agent. This explicit Node transport ownership is required because Electron `session.setProxy()` configures Chromium traffic and does not configure the main-process `globalThis.fetch` or `ws` client used here.

### Public-read activation checkpoint

The 2026-07-14 post-milestone checkpoint activates both reviewed public-read transports in the normal operator composition. The default `npm run e` and production build therefore use real Binance public market data after the operator opens the corresponding Futures workspace. These transports remain credential-free and expose only the frozen `GET` routes and public streams below.

Safe development and automated verification do not select those compositions. `safe-dev`, `smoke`, `e2e` and Vitest builds source-replace each environment composition with its separately named deterministic verification composition. This is a build-time module boundary, not a renderer field, runtime enum, environment/host option or caller-supplied transport. The fail-fast network guards remain active in every verification entry.

The checkpoint re-reviewed the official origins, route weights, routed WebSocket contract and local-book sequence on 2026-07-14 without making a Binance API request. The subsequent manual-acceptance corrections added only backend-owned proxy tunnelling, explicit socket-readiness ownership, staged bootstrap cancellation and bounded Spot depth release for those already frozen origins. Activating public reads and proxy support adds no credential, private read, execution action or write authority.

### REST registry

All routes below use `GET`, require no credential and are classified `PUBLIC_READ`. No Phase 8.0–8.2 route is a private read or write.

| Route | Fixed use | Parameters | Request weight |
|---|---|---|---|
| `/fapi/v1/exchangeInfo` | Futures-only instrument catalog, status, assets and exact filters | none | 1 |
| `/fapi/v1/depth` | authoritative local-book bootstrap | `symbol`, fixed `limit=1000` | 20 |
| `/fapi/v1/klines` | contract-candle bootstrap | `symbol`, reviewed interval, fixed `limit=99` | 1 |
| `/fapi/v1/markPriceKlines` | mark overlay bootstrap | `symbol`, reviewed interval, fixed `limit=99` | 1 |
| `/fapi/v1/indexPriceKlines` | index overlay bootstrap | `pair`, reviewed interval, fixed `limit=99` | 1 |
| `/fapi/v1/premiumIndex` | initial mark, index and funding state | `symbol` | 1 |
| `/fapi/v1/ticker/24hr` | initial 24-hour statistics | `symbol` | 1 |

The reviewed kline limit brackets are `[1,100)=1`, `[100,500)=2`, `[500,1000]=5`, and `>1000=10`; this milestone fixes `99`, weight `1`, giving the 80-row renderer a 19-candle bootstrap margin. The reviewed depth weights are `5/10/20/50 → 2`, `100 → 5`, `500 → 10`, and `1000 → 20`; this milestone keeps the official local-book snapshot size `1000`, weight `20`.

The route classifier also reserves these categories, all absent from this milestone:

- `PRIVATE_READ`: account, balance, position, order and user-stream reads;
- `EXECUTION_WRITE`: order placement, cancel, amend and position reduction;
- `SAFETY_WRITE`: kill switch, cancel-all and emergency close;
- `ACCOUNT_CONFIGURATION_WRITE`: leverage, margin type and position mode.

Adding any absent category requires a new ADR, exact protocol, separately authorized backend action and the inherited durable Phase 7 gates where production is involved.

### WebSocket registry

Legacy unrouted production market paths were permanently decommissioned on 2026-04-23. Phase 8 therefore compiles the routed combined-stream paths below and rejects `/ws`, `/stream`, an alternate routed prefix or any caller suffix.

| Routed prefix | Exact stream | Cadence | Authority |
|---|---|---|---|
| `/public/stream?streams=` | `<lower-symbol>@depth@100ms` | 100 ms | public read |
| `/market/stream?streams=` | `<lower-symbol>@aggTrade` | 100 ms aggregation | public read |
| `/market/stream?streams=` | `<lower-symbol>@kline_<interval>` | 250 ms | public read |
| `/market/stream?streams=` | `<lower-symbol>@markPrice@1s` | 1 s | public read |
| `/market/stream?streams=` | `<lower-symbol>@ticker` | 2 s | public read |

The connection lifetime is bounded to 24 hours. The server sends a ping every 3 minutes and requires a pong within 10 minutes. The client budget is below the documented 10 incoming messages per second and far below 1024 streams per connection. Each generation opens at most one public depth socket and one market socket containing four streams. Both handshakes must report open before any snapshot/candle bootstrap REST request is dispatched; an error or close before open fails the readiness barrier and enters bounded resynchronization. Symbols are lowercase in stream names and uppercase in normalized models.

After the USDⓈ-M/COIN-M stream integration, normalized events require `st=1` when `st` is present. `st=2` and a mismatched `ps` are rejected. This milestone never admits a COIN-M contract.

### Frozen message schemas

The backend accepts only exact bounded objects after the combined-stream `{stream,data}` envelope is removed:

- depth: `e,E,T,s,U,u,pu,b,a` with optional reviewed `ps,st`; update IDs are lossless decimal strings;
- aggregate trade: `e,E,s,a,p,q,nq,f,l,T,m` with optional reviewed `st`; `a,f,l` are lossless decimal strings and `p,q,nq` remain decimal strings;
- kline: `e,E,s,k`, where `k` contains `t,T,s,i,f,L,o,c,h,l,v,n,x,q,V,Q,B`; identities remain strings and decimals remain strings;
- mark price: `e,E,s,p,i,P,r,ap,T` with optional reviewed `st`;
- ticker: `e,E,s,p,P,w,c,Q,o,h,l,v,q,O,C,F,L,n` with optional reviewed `ps,st`.

Unknown event kinds, unsafe integers, floating-point identities, non-canonical decimal strings, extra nesting, malformed JSON, oversized frames and schema drift never update the visible model. They transition the affected resource to stale/resynchronizing or unavailable according to the recovery table below.

All seven current USDⓈ-M symbol filters are normalized and displayed: `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, `MAX_NUM_ORDERS`, `MAX_NUM_ALGO_ORDERS`, `PERCENT_PRICE` and `MIN_NOTIONAL`. Unknown, missing or duplicate filter kinds fail closed. The three `PRICE_FILTER` decimal fields may be zero exactly as documented; quantity maxima and step sizes remain positive. Frozen-but-unrendered fields in REST klines, premium index, 24-hour ticker, stream klines, mark price and ticker messages are validated before the message can update any visible field.

## Order-book sequencing decision

Each symbol generation follows the official procedure exactly:

1. Open the diff-depth stream and buffer bounded deltas.
2. Fetch `/fapi/v1/depth?symbol=<SYMBOL>&limit=1000`.
3. Drop buffered events whose final update ID `u` is less than the snapshot `lastUpdateId`.
4. Require the first applied event to satisfy `U <= lastUpdateId && u >= lastUpdateId`.
5. Require every subsequent event's `pu` to equal the preceding event's `u`.
6. Apply absolute quantities; quantity `0` removes a level, including an already absent level.
7. On gap, reorder, buffer overflow, malformed update, socket loss or generation change, mark the book `resynchronizing`, discard the uncertain book and rebuild from a new snapshot before returning to `live`.

Duplicates entirely behind the current update ID are ignored. A partial overlap that violates the exact first-event rule or subsequent `pu` rule is rejected. The UI never labels depth live merely because a socket is connected.

The six post-handshake bootstrap reads run in one fixed sequence: depth, contract candles, mark candles, index candles, premium index, then ticker. No later request promise exists until the preceding request succeeds. With backend-owned keep-alive, successful requests can reuse the same bounded proxy/TLS connection. A failure therefore prevents every later request from dispatching without a cancellation race. A 10-second child deadline is reported as `REQUEST_DEADLINE_EXCEEDED`; only an aborted generation owner is treated as silent teardown. One attempt weighs exactly `26` including exchange info, down from `29`, and a failed attempt cannot drain queued reads after its terminal cause is known.

## Immutable read-model protocols

The two renderer protocols have fixed identities and cannot parse one another:

| Property | Testnet | Production |
|---|---|---|
| channel | `futures-testnet-workstation` | `futures-production-workstation` |
| protocol version | `4` | `4` |
| market type | `USD_M_FUTURES` | `USD_M_FUTURES` |
| environment | `TESTNET` | `PRODUCTION` |
| subscribe action | `futures.testnet.workstation.subscribe` | `futures.production.workstation.subscribe` |
| symbol action | `futures.testnet.workstation.select-symbol` | `futures.production.workstation.select-symbol` |
| interval action | `futures.testnet.workstation.select-interval` | `futures.production.workstation.select-interval` |
| unsubscribe action | `futures.testnet.workstation.unsubscribe` | `futures.production.workstation.unsubscribe` |

Requests have exact keys, a maximum UTF-8 length of 1024 bytes, an opaque request ID no longer than 96 bytes, an allowlisted symbol no longer than 20 ASCII bytes and one of `1m,5m,15m,1h,4h,1d`. A symbol is either 1–20 uppercase alphanumeric bytes or an uppercase alphanumeric prefix followed by the exact dated-delivery suffix `_YYMMDD`, with the same 20-byte total bound. A pair remains 1–20 uppercase alphanumeric bytes and never accepts the delivery suffix. Requests have no host, URL, credential, account, execution, order, side, quantity, notional, leverage or network-option field.

Every emitted resource event contains the exact channel identity, protocol version, environment, request ID, symbol, generation, monotonically increasing revision, resource kind, lifecycle state, observation time and immutable payload. Protocol version `4` retains the version-3 catalog and dated-delivery corrections and records the current exchange-catalog compatibility contract, including optional per-symbol algo limits. The renderer accepts only the active request/generation, increasing revisions and an exact schema. A model from one channel cannot be reused on the other.

Resource kinds are `catalog`, `header`, `candles`, `depth`, `trades` and `status`. Lifecycle states are `loading`, `live`, `stale`, `disconnected`, `resynchronizing` and `unavailable`. A new generation clears every prior-generation resource. Disconnect, resynchronization and terminal failure transition every cached resource out of `live`; only new authoritative resource events can restore `live`.

## Ownership, clocks and bounds

All authority and memory are bounded:

| Resource | Backend bound | Renderer bound | Freshness deadline |
|---|---:|---:|---:|
| request frame | 1024 bytes | n/a | immediate rejection |
| Binance WS frame | 64 KiB | n/a | immediate rejection |
| REST headers | 16 KiB | n/a | immediate rejection |
| exchange-info body | 2 MiB | n/a | 24 h |
| depth body | 512 KiB | n/a | bootstrap only |
| kline body | 1 MiB | n/a | bootstrap only |
| catalog | 1024 contracts / 8 per 15 KiB frame | 128 filtered rows | 24 h |
| candles per series | 500 | 80 | 2 stream periods or 5 s minimum |
| depth levels per side | 1000 snapshot / 500 retained | 24 | 3 s |
| buffered depth events | 2048 events / 8 MiB | n/a | bootstrap deadline 10 s |
| aggregate trades | 512 | 32 | 5 s |
| outbound resource frame | 15 KiB | 15 KiB | immediate rejection |
| pre-bootstrap non-depth events | 128 rolling latest | n/a | oldest tape/presentation event is evicted; no authority transition |
| timers per generation | 8 | 2 | teardown owned |
| reconnect attempts | 8, exponential 500 ms–30 s | 8, exponential 250 ms–5 s | then unavailable |

The backend owns generation, Binance transport, authoritative snapshot, continuity state, reconnect budget and freshness. Each separately named environment container owns a narrow Phase 8 hook backed by one shared, environment-neutral loopback connector. That connector reads only the main-process-injected loopback host/port/token, accepts no caller URL or network option, limits requests to 1024 bytes, expires a pending handshake after 10 seconds and never connects to Binance. It is not sourced from Spot `DataContext`. The renderer otherwise owns only the currently accepted immutable display model, search text, selected UI tab, pause state for the tape, local price draft, local drawing coordinates and local alert drafts. No financial state is persisted in browser storage.

Production and Testnet use separate injected fake clocks in tests. Clock regression never decreases `observedAt`; it marks the affected resource stale and requires a new generation. Production fake time and Testnet fake time are independent.

## Pure presentation boundary

Shared React modules may import React, `lightweight-charts`, CSS and pure formatting helpers. They receive deeply immutable normalized props and callback props. They may not import environment protocols, environment containers, Electron services, `DataContext`, Spot commands, the Phase 5/6/7 services, WebSocket/fetch, browser storage, analytics, telemetry, clipboard or crash reporting.

The shared chart renders contract candles, volume, mark and index overlays, plus renderer-local drawing and alert markers. A chart or depth click invokes only `onDraftPriceChange(exactDecimalString)`. No shared component can construct or dispatch an execution intent. Enter has no Futures binding.

## Rejected alternatives

- Extending the Spot `DataContext`, `ChartWrapper`, `OrderBook` or `TradesPanel`: rejected because those components own Spot subscriptions, commands, storage and execution affordances.
- Adding `environment` to the Phase 5 service: rejected because it would merge a frozen trust boundary.
- One generic Futures workstation protocol with an environment field: rejected because a caller could select host and authority through data.
- Direct renderer Binance sockets: rejected because CSP and renderer compromise would gain network authority and sequencing ownership.
- Displaying a socket-connected book before snapshot continuity: rejected because connected is not authoritative.
- Reusing chart/book clicks as Phase 7 prepare-intent actions: rejected because a market-data gesture is not explicit execution authorization.

The rejection of `ChartWrapper` does not prohibit pure presentation reuse. The Futures chart uses the same bounded volume-presentation helper as Spot and follows the same viewport lifecycle rule: initial authoritative data may fit once, while subsequent stream updates never override operator pan/zoom.

## Verification obligations

The milestone is acceptable only when deterministic tests cover protocol exactness, route and redirect pinning, schema losslessness, generation races, teardown, depth bootstrap/gap/reorder/duplicate/overflow/resync, malformed and oversized data, bursts, stale deadlines, clock regression, environment isolation, secret/storage/network absence, responsive UI state rendering and production network escape. Full Spot and Phase 5/6/7 regression remains mandatory.
