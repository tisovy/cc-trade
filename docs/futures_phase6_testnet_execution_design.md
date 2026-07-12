# Phase 6 Testnet Futures Execution Design

Date: 2026-07-12

Planning base: `81ea13291e328ab57be88121236a09ee72d68034` (`Complete futures read-only Phase 5`)

Decision status: accepted for planning; no implementation is present

Phase status: Planning complete; implementation not started

## 1. Decision summary

The first futures write checkpoint will be narrower than the Phase 6 sketch that preceded this review. It will eventually support exactly one Binance USDⓈ-M Futures Testnet order shape:

- regular `LIMIT` with `GTC`;
- one-way position mode only;
- `positionSide: "BOTH"`;
- isolated margin only;
- `reduceOnly: true` only;
- one existing, non-zero position whose signed direction is reduced by the order;
- quantity no greater than the entire currently reducible position;
- no current regular or algo open order for the symbol;
- current observed leverage asserted, never changed, and capped at 3x;
- current observed margin type asserted, never changed;
- fixed `https://demo-fapi.binance.com` transport only.

This is the minimum defensible write. A persistent exposure-increasing `GTC` order would be unsafe as the first path because the checkpoint deliberately has no cancellation path. Hedge mode is also excluded because Binance does not permit `reduceOnly` on hedge-mode new orders. A one-way reduce-only order lets the exchange independently enforce the core invariant that the order cannot increase exposure.

The completed Phase 5 facade remains frozen. A later implementation must introduce a separately named execution risk reader, a two-method testnet execution facade, and a backend execution service. It must not add write methods to `createFuturesReadOnlyTransport`, `FuturesTradingAdapter`, or `FuturesReadOnlyService`.

The following remain out of scope until separately reviewed checkpoints:

- exposure-increasing orders;
- hedge-mode orders;
- market, IOC, FOK, GTD, conditional, algo, trailing-stop, batch, and modification paths;
- cancellation, including cancel-all;
- leverage, margin-type, position-mode, and auto-add-margin changes;
- transfers or any other account write;
- production hosts, production credentials, production configuration, and real accounts;
- generic SDK clients, endpoint names, base-URL overrides, proxy/agent options, arbitrary parameters, raw bodies, or request passthrough;
- Phase 7 production controls or rollout.

## 2. Architecture decision record

### Context

Phase 5 deliberately exposes seven read-only methods and one public mark-price subscription. Its V3 position snapshot does not authoritatively provide current leverage, margin type, empty-account position mode, account trading permission, multi-assets mode, or isolated auto-add-margin state. Those omissions make it unsuitable as the complete preflight source for a write.

The current shared spot limiter also has retry behavior appropriate to reads. A futures write cannot inherit an automatic retry after dispatch because a lost response can hide an accepted order.

### Decision

A later implementation will add three separate boundaries:

1. `FuturesTestnetExecutionRiskReader`
   - Testnet-only and read-only.
   - Uses the same captured futures credential pair and fixed host as the execution facade.
   - Exposes only server time, exchange information, mark price, account configuration, symbol configuration, V3 position risk, V3 USDT balance, symbol regular open orders, and symbol algo open orders.
   - Produces one generation-owned, timestamped preflight bundle; it does not mutate or extend the Phase 5 facade.

2. `FuturesTestnetExecutionFacade`
   - Exposes exactly `placeReduceOnlyLimitGtcOrder(args)` and `queryOrderByOriginalClientOrderId(args)`.
   - Uses fixed endpoints, fixed argument schemas, fixed signing, and no write retry.
   - Does not expose a client, endpoint, method, URL, headers, body, retry count, timestamp, `recvWindow`, or transport options.

3. `FuturesTestnetExecutionService`
   - Process/account singleton that owns the feature gate, connection/session binding, exact validation, rate admission, durable idempotency journal, one-command mutex, state machine, reconciliation, and renderer-safe acknowledgements.
   - A renderer connection may observe its owned attempt, but renderer lifetime does not own a dispatched order.

### Consequences

- Phase 5 remains a pure read-only subsystem.
- Production execution is absent structurally, not merely hidden by UI state.
- The first order path can only reduce a known one-way isolated position.
- The app cannot change account configuration to make a requested order fit.
- Unknown execution results block further writes until reconciliation reaches an exchange-confirmed terminal or observable state.
- Additional write capabilities require new architecture and contract reviews rather than new strings passed through a generic client.

## 3. Current-boundary inventory and unresolved decisions

GitNexus status was checked before any edit. Repository `cc-trade`, Git `HEAD`, and the index were all exactly `81ea13291e328ab57be88121236a09ee72d68034`; the branch was `fix/long-running-stability`; the worktree was clean.

GitNexus `query` and `context` were used for these boundaries:

| Boundary | Current contract | Phase 6 consequence |
| --- | --- | --- |
| Phase 5 transport | `createFuturesReadOnlyTransport` resolves only `mock` or fixed-host `testnet` and exposes seven frozen read methods | Do not add a write; create separately named facades |
| Phase 5 lifecycle | `FuturesReadOnlyService.handleRequest`, `readResource`, and `stopSession` own generation, abort, timeout, backoff, stale, teardown, and late-delivery guards | Bind future preflight to an equivalent owned generation; transfer ownership after dispatch |
| Typed protocol | `validateTypedTradingCommand` accepts the spot trading protocol and rejects explicit futures with `UNSUPPORTED_MARKET_TYPE` | Add a different versioned action only at a later route-install checkpoint; preserve this rejection |
| Legacy protocol | `validateLegacyOrderCommand`, legacy cancel validation, and connection routing reject outer or nested futures identities | Preserve all legacy rejection permanently |
| Spot orchestration | `SpotTradingAdapter.placeOrder` keeps existing `LIMIT/GTC`, refresh, cancellation, and `0.999` reduction behavior | No reuse or modification for futures |
| Rate limiting | `RateLimiter.reserve` is shared by five spot/account processes; default network/timestamp retry count is two | Do not modify the critical spot limiter for write retries; add separate order-count admission and zero-retry facade |
| Renderer ownership | `AppShell` owns the Spot/Futures switch; `DataContext` ignores `futures-readonly` | Future ticket uses a separate channel/hook and never writes spot context |
| Channel boundary | Main-process loopback WebSocket routing validates action/channel/market identity | Add an exact new channel only after the backend is complete; no generic trading channel fallback |
| Credentials | `setupBinanceConnection` captures and deletes `FUTURES_TESTNET_API_KEY` and `FUTURES_TESTNET_API_SECRET` before `BrowserWindow` creation | Reuse the captured main-only values; never send them to the renderer or reread inherited environment |
| Tests | Transport, service, protocol, connection, renderer, E2E, isolation, and spot regression suites are deterministic | Extend with injected fakes only; optional live testnet smoke remains manual and separately authorized |

No existing function, class, method, or component is changed by this planning checkpoint. Upstream symbol impact analysis is therefore not applicable to the documentation-only edits. Before future source edits, the implementer must run `impact(..., direction: "upstream")` on every existing symbol and report any HIGH or CRITICAL result first.

Every previously unresolved design choice is resolved here:

| Question | Decision |
| --- | --- |
| First order shape | One-way, isolated, reduce-only regular `LIMIT/GTC` only |
| Opening exposure | Deferred; no opening order without a separately reviewed cancellation and risk model |
| Hedge mode | Rejected because `reduceOnly` cannot be sent in hedge mode |
| Leverage/margin writes | Never implicit; command values are assertions against current state |
| Missing risk fields | New exact execution-owned read-only risk reader; Phase 5 remains frozen |
| Decimal arithmetic | Native `BigInt` fixed-point utility; no dependency and no JavaScript floating point |
| Client identity | Request ID is 32 lowercase hex; client ID is exactly `cc6-<requestId>` |
| Duplicate safety | Integrity-anchored durable journal, cross-process exclusive ownership, and permanent ID tombstones |
| Lost response | No POST retry; classify as unknown and reconcile by exact original client order ID |
| Renderer teardown | Abort before dispatch; never cancel or reinterpret after dispatch |
| Session ownership | Connection-owned before dispatch; process-owned durable attempt after dispatch; stale generations cannot receive updates |
| Working type/price protection | Explicitly non-applicable (`null`/`false`), not regular LIMIT transport fields |
| Warning acknowledgement | None; every Phase 6 warning threshold is a hard backend block |
| SDK use | No SDK dependency; current generated client is broader and retry-enabled |
| Renderer | No UI in planning; later one compact unmistakable testnet reduce-only ticket |
| Production | No host, mode, credential path, or route exists in Phase 6 |

## 4. Official Binance contract review

Review date: 2026-07-12. Only public documentation and public generated source were read. No API key was used, no authenticated call was made, and no order or account request was submitted.

### 4.1 Reviewed operations

| Purpose | Current contract used by the design | Weight/admission |
| --- | --- | --- |
| Testnet REST | Product General Information specifies `https://demo-fapi.binance.com` | Fixed constant; never caller-configurable |
| Server time | `GET /fapi/v1/time` | IP weight 1 |
| Exchange metadata | `GET /fapi/v1/exchangeInfo` | IP weight 1 |
| Mark/index/funding input | `GET /fapi/v1/premiumIndex` for one exact symbol or the owned mark stream | IP weight 1 for the reviewed REST read |
| Account mode/permission | Signed `GET /fapi/v1/accountConfig` | IP weight 5 |
| Symbol leverage/margin state | Signed `GET /fapi/v1/symbolConfig?symbol=...` | IP weight 5 |
| Position/liquidation/notional | Signed `GET /fapi/v3/positionRisk?symbol=...` | IP weight 5 |
| USDT balance | Signed `GET /fapi/v3/balance` | IP weight 5 |
| Regular open orders | Signed `GET /fapi/v1/openOrders?symbol=...` | IP weight 1 with a symbol |
| Algo open orders | Signed `GET /fapi/v1/openAlgoOrders?symbol=...` | IP weight 1 |
| Place reviewed order | Signed `POST /fapi/v1/order` | +1 `X-MBX-ORDER-COUNT-10S`, +1 `X-MBX-ORDER-COUNT-1M`, IP weight 0 |
| Exact reconciliation | Signed `GET /fapi/v1/order` with symbol and `origClientOrderId` | IP weight 1 |
| Change leverage | Signed `POST /fapi/v1/leverage` | A write, reviewed only to confirm it is separate; deferred |
| Change margin type | Signed `POST /fapi/v1/marginType` | IP weight 1; separate write; deferred |
| Change position mode | Signed `POST /fapi/v1/positionSide/dual` | Separate account write; deferred |

The first path does not need leverage-bracket reads to calculate opening risk because it cannot open or increase exposure. `symbolConfig.maxNotionalValue`, the mandatory app cap, and current V3 position notional are still enforced. A future exposure-increasing path must separately review leverage brackets, maintenance margin, fees, and post-order liquidation calculations.

### 4.2 Signing and parameter contract

- Private operations require `X-MBX-APIKEY` and a signed request.
- The signature is HMAC-SHA256 of the exact transmitted parameter serialization before `signature`.
- Parameters may be sent in query or form body under the product rules, but this design uses one deterministic form-body order for the POST and query parameters for signed GETs.
- The facade appends `recvWindow=5000`, then a fresh server-adjusted safe-integer millisecond `timestamp`, and finally `signature`.
- The caller cannot supply or override timestamp, `recvWindow`, signature, API key, host, parameter order, or encoding.
- The request must satisfy `timestamp < serverTime + 1000` and `serverTime - timestamp <= recvWindow` at Binance. A stale or high-RTT time sample blocks dispatch.
- Secrets, signatures, the complete signed query/body, authentication headers, and raw credential-bearing request objects are never logged or journaled.

### 4.3 New Order and Query Order

For regular `POST /fapi/v1/order`, the reviewed subset sends only:

```text
symbol=<allowlisted symbol>
side=BUY|SELL
type=LIMIT
timeInForce=GTC
quantity=<validated original decimal string>
price=<validated original decimal string>
positionSide=BOTH
reduceOnly=true
newClientOrderId=cc6-<32 lowercase hex request id>
newOrderRespType=ACK
recvWindow=5000
timestamp=<fresh adjusted safe integer>
signature=<HMAC over every preceding transmitted field>
```

The implementation must preserve this canonical order. It must not send `workingType`, `priceProtect`, `priceMatch`, self-trade-prevention mode, `goodTillDate`, or any conditional/algo field.

`GET /fapi/v1/order` requires the exact symbol and either `orderId` or `origClientOrderId`. Phase 6 reconciliation always uses the deterministic `origClientOrderId`; an exact exchange `orderId` from a valid response is stored as an additional cross-check, never as a replacement for that lookup. A plain `JSON.parse` number is not acceptable for int64 identity. The transport must retain `orderId` as a lossless decimal string and timestamps as verified safe integers.

### 4.4 Position mode, position side, and reduce-only

- One-way mode uses `positionSide: "BOTH"`.
- Hedge mode requires `LONG` or `SHORT`, and Binance forbids sending `reduceOnly` in hedge mode.
- Phase 6 therefore requires `accountConfig.dualSidePosition === false`, command `positionSide === "BOTH"`, and exchange position `positionSide === "BOTH"`.
- A positive one-way position may only be reduced by `SELL`; a negative one-way position may only be reduced by `BUY`.
- Quantity must be no greater than the absolute current position amount.
- Zero regular and zero algo open orders are required to avoid a race with another app-owned or external reducer. A later design may account for outstanding quantities, but checkpoint one does not.
- Any mode mismatch or mode change during preflight rejects before dispatch.

### 4.5 Working type and price protection

Binance currently defines `MARK_PRICE` and `CONTRACT_PRICE` as supported working types. `priceProtect` applies to conditional/algo triggers: when true, the mark/contract price divergence at trigger time must not exceed the symbol's `triggerProtect` value.

The current regular New Order product contract and generated `newOrder` method do not accept `workingType` or `priceProtect`; the generated `testOrder` surface still contains the older conditional fields, while `newAlgoOrder` contains the current trigger fields. Phase 6 resolves this discrepancy as follows:

- command `workingType` is required to be JSON `null`, explicitly meaning not applicable to this regular order;
- command `priceProtect` is required to equal `false` because the reviewed order is not conditional;
- neither field is transmitted to regular New Order;
- the risk evaluator independently and unconditionally uses the fresh mark price for notional and liquidation checks; it does not infer that choice from `workingType`;
- any future conditional/algo order must use the separately documented algo endpoint and a new review.

The live regular New Order enum still lists conditional order types even though New Algo Order and error `-4120` direct current conditional behavior to `/fapi/v1/algoOrder`. This product-versus-product inconsistency is irrelevant to the fixed `LIMIT` subset and is resolved conservatively: the facade accepts only `LIMIT`; any conditional path must re-review the then-current product contract rather than extend this method.

### 4.6 Client order ID and duplicate behavior

Binance documents `newClientOrderId` as unique among open orders and constrained by `^[\.A-Z\:/a-z0-9_-]{1,36}$`. The first path uses exactly `cc6-${requestId}`, which is 36 characters and matches the documented grammar. The local rule is intentionally stronger:

- no caller-selected prefix or arbitrary client ID;
- no reuse of any journaled ID: full terminal records may compact, but permanent request-ID/client-ID/digest tombstones remain;
- an identical request/digest returns its existing state without another POST;
- a request-ID or client-ID collision with a different digest is rejected;
- Binance duplicate code `-4116` enters exact reconciliation; it never causes an automatic retry or immediate failure claim.

### 4.7 Filters and precision

The backend validates exchange `status === "TRADING"`, `contractType === "PERPETUAL"`, quote/margin asset `USDT`, and support for `LIMIT` and `GTC`. It requires all applicable filters and never substitutes `pricePrecision` or `quantityPrecision` for filter arithmetic.

- `PRICE_FILTER`: each zero min/max bound is disabled under the official rule; Phase 6 requires positive `tickSize` and rejects metadata with disabled/zero tick size; enabled bounds and `(price - minPrice) % tickSize === 0` must pass exactly.
- `PERCENT_PRICE`: the official rule is side-specific—BUY has the upper bound and SELL has the lower bound. Phase 6 intentionally applies the opposite bound too, creating the stricter local band `markPrice * multiplierDown <= price <= markPrice * multiplierUp`, with fresh mark price and exact `multiplierDecimal` normalization.
- `LOT_SIZE`: `minQty <= quantity <= maxQty` and `(quantity - minQty) % stepSize === 0`.
- `MIN_NOTIONAL`: `price * quantity` meets the exchange minimum.
- `MAX_NUM_ORDERS`: the exact safe-integer limit exists and is at least one; the zero regular/algo-order rule keeps the proposed order within it.
- Configured max notional: `quantity * max(limitPrice, freshMarkPrice)` does not exceed the mandatory app cap.
- Symbol max: the same conservative notional does not exceed `symbolConfig.maxNotionalValue`.

The current primary Common Definition explicitly uses the minimum-relative modulo formulas above. It also says zero `tickSize` disables the exchange interval rule; Phase 6 fails closed instead of accepting an ungridded limit price. `LOT_SIZE` must have positive min/max/step values in a locally consistent schema. The official error text notes a reduce-only exemption for minimum notional (`-4164`). Phase 6 deliberately does not use that exemption: dust reductions below the published minimum remain rejected locally. This is more restrictive but eliminates a special-case path in the first write checkpoint.

### 4.8 Relevant response and error identity

The implementation preserves exact HTTP status, bounded Binance body code/message, headers, and transport cause internally, but maps them to fixed renderer-safe codes.

| Condition | Internal meaning for this path |
| --- | --- |
| `-1006` unexpected response, `-1007` timeout | Unknown after dispatch; reconcile; never POST again |
| HTTP `408`, connection loss, malformed/truncated `2xx` | Always unknown after durable intent; reconcile. Before intent the facade is never invoked and rejection is local |
| HTTP `503` variant A (`Unknown error...`) | Unknown; reconcile |
| Any other HTTP `5xx`, including documented 503 variants B/C or code `-1008` | Unknown after dispatch under the stricter Phase 6 rule; no retry |
| HTTP `418` / `429` with a valid Binance rate-limit response | Confirmed rate rejection; close admission until the ban/pause expires; no write retry |
| `-1021` timestamp, `-1022` signature | Confirmed rejection; invalidate time/auth preflight before any later admission |
| `-2010` new-order rejected, `-2015` key invalid, `-2019` margin insufficient | Confirmed rejection; auth failures close the gate |
| `-2022` reduce-only rejected, `-2023` liquidation, `-2024` position insufficient | Confirmed rejection; refresh all risk state |
| `-4002`, `-4013`, `-4014`, `-4016`, `-4024` | Price/filter rejection; refresh metadata/mark |
| `-4004`, `-4005`, `-4023` | Quantity/step rejection; refresh metadata/position |
| `-4015`, `-4116` | Client-ID invalid/duplicate; duplicate enters reconciliation |
| `-4028` leverage, `-4031` working type | Confirmed contract/state rejection; close admission pending fresh config |
| `-4046`, `-4047`, `-4048`, `-4060`, `-4061`, `-4062` | Configuration/position-mode family; no automatic configuration write |
| `-4118` reduce-only margin conflict | Confirmed rejection; refresh position/orders/balance |
| `-4120` conditional order must use algo | Protocol drift; the facade must never emit such a request |
| Query `-2013` after an ambiguous POST | Not proof that the POST failed; keep reconciling and then remain unknown |

A confirmed error does not need fields that Binance error bodies do not provide. It requires the single owned in-flight POST to return a complete HTTP response plus a valid bounded `{code,msg}` schema whose status/code is on the reviewed deterministic-rejection allowlist. Malformed/truncated error, unrecognized code, `408`, any `5xx`, or ambiguous `418`/`429` after intent remains unknown. Exact identity matching is mandatory for success and Query Order objects. Anything else ambiguous after the dispatch boundary remains unknown.

The fake error matrix also covers `-1002`, `-1015`, validation family `-1100` through `-1136`, balance/order family `-2018` through `-2028`, and configuration/filter family `-4140`, `-4141`, and `-4164`. None of these codes authorizes a retry, configuration write, or renderer-visible raw message.

### 4.9 Product documentation versus generated JavaScript SDK

The current public generated artifact reviewed on 2026-07-12 is `@binance/derivatives-trading-usds-futures` `32.0.0` (release commit `fdfcb2089d5145bffdeaa97074152b331c8a12f1`), with `@binance/common` `2.4.1` and generated OpenAPI version `1.0.0`. This is newer than the `26.0.2` artifact recorded in the historical Phase 5 exit audit; the Phase 5 record remains unchanged because it was correct at that checkpoint.

| Generated artifact observation | Resolution |
| --- | --- |
| Package description incorrectly calls the USDⓈ-M package COIN-M/COINN-M | Treat as generated metadata defect; product documentation and endpoint identity govern |
| README defaults to production `https://fapi.binance.com` and exposes arbitrary `basePath` | Do not instantiate the SDK; future facade contains only fixed demo host |
| README/default client advertises three retries; current common retry loop is limited to GET/DELETE, not POST | The generic policy is still broader than required and could change independently; future facade owns an explicit zero-write-retry contract and a separate bounded reconciliation schedule |
| Generic configuration defaults to a 1000 ms timeout and permits caller timeout changes | The narrow facade owns the reviewed 10,000 ms operation deadlines; callers cannot override them |
| README calls `https://testnet.binancefuture.com` the testnet surface, while product General Information specifies `https://demo-fapi.binance.com`; common exports both TESTNET and DEMO constants | Product General Information and the already reviewed Phase 5 host govern; freeze DEMO and expose no override |
| Generic client exposes all REST writes, WebSocket trading, streams, proxy/agent, auth, timeout, and raw configuration | Capability exceeds reviewed scope; use a purpose-built two-method facade |
| Generated `newOrder` accepts `quantity` and `price` as JavaScript `number` | Financial strings must not cross floating point; preserve original decimal strings in the narrow facade |
| Generated responses model `orderId` and time as `number | bigint`, but plain JSON decoding can round int64 | Use a schema-aware lossless parser and expose order ID as string; do not rely on TypeScript type declarations to make JSON lossless |
| Generated `queryOrder` permits both optional IDs and does not enforce exactly one | Phase 6 always sends only exact `origClientOrderId` |
| Generated `QueryOrderResponse` omits current product response fields `priceMatch`, `selfTradePreventionMode`, and `goodTillDate` | Validate the current product response contract; generated response types are not authority |
| Product Symbol Configuration presentation is singular, while its example and generated response are an array of optional rows | Require an array, select exactly one identity-matching symbol row, and reject missing, duplicate, or incomplete rows |
| Generated `newOrder` omits `workingType`/`priceProtect`; generated `testOrder` retains legacy conditional fields; `newAlgoOrder` has current trigger fields | Current product New Order contract governs; regular LIMIT sends neither field |
| Models mark nearly every response member optional | The risk reader and facade require the exact Phase 6 fields; a missing or wrong-type field is a hard parse failure |
| Generic 5xx handling can replace the Binance body with a generic `ServerError`, and successful HTTP bodies are not sufficient evidence that `{code,msg}` was inspected | Narrow facade preserves bounded HTTP/body identity internally and validates success and error schemas itself |

No SDK dependency, source copy, lockfile change, or runtime client is justified for the two reviewed operations.

### 4.10 Primary sources

- [USDⓈ-M Futures General Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info)
- [USDⓈ-M Futures Common Definition](https://developers.binance.com/docs/derivatives/usds-margined-futures/common-definition)
- [USDⓈ-M Futures Error Codes](https://developers.binance.com/docs/derivatives/usds-margined-futures/error-code)
- [Current New Order and Query Order catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade)
- [Current Account catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account)
- [Current Market Data catalog](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)
- [Official generated JavaScript USDⓈ-M client](https://github.com/binance/binance-connector-js/tree/master/clients/derivatives-trading-usds-futures)
- [Generated trade module](https://github.com/binance/binance-connector-js/blob/master/clients/derivatives-trading-usds-futures/src/rest-api/modules/trade-api.ts)
- [Generated common URL constants](https://github.com/binance/binance-connector-js/blob/master/common/src/constants.ts)

## 5. Backend-owned feature gate

Execution is disabled by default. A future implementation may resolve a non-secret capability only when every condition below is true at final dispatch admission:

1. Existing `FUTURES_READ_MODE` is exactly `testnet`; missing values resolve to the existing safe `mock` default.
2. New `FUTURES_TESTNET_EXECUTION_ENABLED` is exactly the four ASCII bytes `true`; there is no trimming, case folding, numeric/boolean coercion, or alternate enabled value.
3. The facade's compiled environment is exactly `testnet` and its only REST origin is `https://demo-fapi.binance.com`.
4. Captured `FUTURES_TESTNET_API_KEY` and `FUTURES_TESTNET_API_SECRET` satisfy existing non-empty validation. Every `FUTURES_TESTNET_EXECUTION_*` value and both credentials are parsed/frozen in main and deleted from `process.env` before `BrowserWindow` creation.
5. A fresh signed account preflight succeeds on the fixed testnet host. API key text has no trustworthy environment marker; the read proves only authenticated demo-account access, not the key's TRADE permission. Production-only credentials fail the demo read and no production host exists to receive them.
6. `FUTURES_TESTNET_EXECUTION_ALLOWED_SYMBOLS` is 2 through 335 ASCII bytes and matches `^[A-Z0-9]{2,20}(,[A-Z0-9]{2,20}){0,15}$`; it contains 1 through 16 unique symbols, no whitespace, empty member, escape, or duplicate, and the command symbol is present.
7. `FUTURES_TESTNET_EXECUTION_MAX_NOTIONAL_USDT` is a canonical positive fixed-point string under the command's 40-total-digit/18-fractional-digit bound and no greater than the non-raiseable Phase 6 ceiling `10000` USDT.
8. `FUTURES_TESTNET_EXECUTION_MAX_LEVERAGE` is exactly one ASCII digit `1`, `2`, or `3`; 3x is a non-raiseable Phase 6 ceiling.
9. `FUTURES_TESTNET_EXECUTION_MIN_LIQUIDATION_DISTANCE_BPS` is canonical ASCII integer text from `1000` through `10000`, with no sign or leading zero; 1000 bps is a non-lowerable floor.
10. `FUTURES_TESTNET_EXECUTION_MIN_AVAILABLE_BALANCE_USDT` is a canonical positive decimal under the same bound and the fresh USDT available balance meets it. This is a conservative fee/funding buffer even though the order is reduce-only.
11. The renderer has already been hardened to `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`, with a narrow preload bridge, restrictive CSP/navigation/window-open policy, and no filesystem/process/userData capability.
12. The app owns the Electron single-instance lock and the exclusive regular-file journal lock; the integrity anchor and journal validate completely.
13. The exact versioned command validates with no coercion or extra fields and uses the current backend-issued one-use intent ID.
14. The renderer connection owns the current futures read session for the same environment and symbol, and the backend maps it to the current execution generation.
15. All required risk observations are complete, current, from the same testnet credential/account identity and owned generation, and fresh under the stricter execution window.
16. Account `canTrade` is true, one-way and single-asset modes are current, symbol margin is isolated, auto-add margin is false, and observed leverage exactly matches the command and cap.
17. Pure backend financial and safety validation passes.
18. No nonterminal command or app-owned open order exists, no unresolved unknown exists in any Phase 6 testnet credential namespace, no rate pause/ban is active, and every required state transition can be durably fsynced.

Invalid, duplicate, oversized, missing, or unrecognized configuration does not partially enable execution. The app remains read-only and exposes only a fixed, non-secret disabled reason. Mock mode, any production-like string, production credentials, missing preflight, renderer state, and renderer market mode can never satisfy the gate. Disabled/mock/no-session startup creates no new risk reader, timer, or network work unless a durable nonterminal journal requires the reconciliation-only recovery worker.

Credential rotation never creates a fresh namespace that bypasses an old unknown. A non-renderer credential binding is persisted; a mismatch prevents queries and dispatch, leaves the old attempt globally blocking, and reports reconciliation unavailable until the original credentials return or a separately reviewed recovery action exists.

The renderer receives capability status but cannot set it, weaken it, choose a host, or make a stale session current.

## 6. Versioned command protocol

The future route is a new action and a new channel. Existing typed and legacy futures commands remain rejected until the route-install checkpoint deliberately registers it.

The request/client IDs are not renderer randomness. After a current-session status/prepare handshake, main generates 128 bits with `node:crypto.randomBytes(16)`, lower-hex encodes them, binds the one-use pair to the connection/symbol/generation, and expires the unused intent after 30 seconds. `Math.random`, the existing Spot request-ID helper, caller-chosen IDs, and ID reuse are prohibited. The command must return exactly that active pair.

```json
{
  "action": "futures.execution.placeOrder",
  "version": 1,
  "requestId": "0123456789abcdef0123456789abcdef",
  "marketType": "futures",
  "environment": "testnet",
  "symbol": "BTCUSDT",
  "side": "SELL",
  "orderType": "LIMIT",
  "quantity": "0.001",
  "price": "70000.0",
  "timeInForce": "GTC",
  "positionSide": "BOTH",
  "marginType": "ISOLATED",
  "leverage": 3,
  "reduceOnly": true,
  "workingType": null,
  "priceProtect": false,
  "clientOrderId": "cc6-0123456789abcdef0123456789abcdef"
}
```

Validation is exact and fail-closed:

- The complete raw UTF-8 command is at most 4096 bytes. A command-specific duplicate-key-aware tokenizer enforces one top-level object, scalar values only, no nested object/array, and maximum nesting depth one before ordinary JSON conversion; plain `JSON.parse` alone is insufficient.
- Input is one ordinary plain object with exactly the listed own enumerable data properties; no inherited values, accessors, symbols, arrays, aliases, or extra fields.
- Malformed UTF-8/JSON, duplicate keys, overlong strings, unsupported escapes, or resource-limit failures reject before any `BigInt`, power-of-ten, journal, or transport work.
- `version` is the safe integer `1`.
- `requestId` is exactly the current backend-issued 32-lowercase-hex one-use intent.
- `marketType`, `environment`, `orderType`, `timeInForce`, `positionSide`, `marginType`, `reduceOnly`, `workingType`, and `priceProtect` equal the literals shown; `workingType` is exactly JSON `null`.
- `symbol` matches `^[A-Z0-9]{2,20}$`, is one exact backend-allowlisted symbol, and matches the current owned session.
- `side` is exactly `BUY` or `SELL`; later risk validation requires the reducing direction.
- `quantity` and `price` are canonical positive fixed-point strings with at most 40 total digits, at most 18 fractional digits, and at most 42 ASCII bytes each: ASCII digits with at most one decimal point, no sign, whitespace, exponent, separator, leading zero except `0.x`, trailing decimal point, negative zero, `NaN`, or `Infinity`.
- `leverage` is a safe integer, exactly equals fresh observed leverage, and is within both configured and hard caps.
- `clientOrderId` is exactly the backend-issued 36-character concatenation `cc6-${requestId}`; no independently chosen value is accepted.
- No timestamp, order ID, session/generation, endpoint, URL, option, header, signature, `recvWindow`, retry, cancellation, or account-mutation field is accepted.
- No risk-warning acknowledgement is accepted in checkpoint one. Liquidation and other warnings are hard blocks; a future override would require a separate one-use backend token design and review.

Financial strings remain strings across every renderer/backend boundary. Exchange `orderId` is a decimal string. Renderer-visible timestamps are safe integers only after bounds checking; unsafe upstream timestamps remain internal parse errors.

## 7. Acknowledgement protocol

The future renderer channel is exactly `futures-execution`. It does not reuse the spot trading or Phase 5 read-only channel.

```json
{
  "channelId": "futures-execution",
  "action": "futures.execution.ack",
  "version": 1,
  "revision": "7",
  "requestId": "0123456789abcdef0123456789abcdef",
  "marketType": "futures",
  "environment": "testnet",
  "symbol": "BTCUSDT",
  "clientOrderId": "cc6-0123456789abcdef0123456789abcdef",
  "acknowledgement": "pending",
  "state": "queued",
  "code": "FUTURES_EXECUTION_PENDING",
  "message": "Testnet reduce-only order is pending.",
  "observedAt": 1783814400000,
  "order": null
}
```

When present, `order` has exactly:

```json
{
  "orderId": "22542179",
  "status": "NEW",
  "originalQuantity": "0.001",
  "executedQuantity": "0",
  "averagePrice": "0.00000",
  "updateTime": 1783814400123
}
```

Semantics are fixed:

- `pending`: only `queued`, `dispatched`, or `reconciling`; never success.
- `accepted`: a valid identity-matching exchange response or exact reconciliation proves the order exists; states are `exchange_accepted`, `confirmed_open`, `confirmed_filled`, or `confirmed_canceled`.
- `rejected`: local rejection before dispatch or an exchange response proves rejection; no order success is implied.
- `unknown`: only `result_unknown` or `reconciliation_unavailable`; never rendered as failure or success.

`revision` is a canonical non-negative decimal string backed by the monotonic journal/status sequence; it is not a JavaScript number. For a valid parsed command, request ID, symbol, and client ID are non-null and exact. If rejection occurs before those untrusted fields validate, the same envelope sets all three to JSON `null`, uses `state: "locally_rejected"`, `acknowledgement: "rejected"`, `code: "FUTURES_EXECUTION_PROTOCOL_REJECTED"`, `order: null`, and never echoes malformed text. `observedAt` is a safe integer from main's local wall-clock anchor advanced with monotonic elapsed time; server adjustment is required only for signed transport/freshness.

| State | Acknowledgement | Order member | Allowed code family |
| --- | --- | --- | --- |
| `locally_rejected` | `rejected` | `null` | protocol/gate/session/risk/filter/notional/leverage/margin/position/reduce/liquidation/duplicate/interrupted/busy/rate/auth |
| `queued`, `dispatched`, `reconciling` | `pending` | `null` until a validated order exists | `FUTURES_EXECUTION_PENDING` |
| `exchange_rejected` | `rejected` | `null` | rate/auth/exchange rejected |
| `exchange_accepted`, `confirmed_open`, `confirmed_filled`, `confirmed_canceled` | `accepted` | required validated safe order summary | `FUTURES_EXECUTION_CONFIRMED` |
| `result_unknown`, `reconciliation_unavailable` | `unknown` | last validated summary or `null`; never speculative | result unknown/reconciliation unavailable |

Every post-intent state transition is fsynced before an acknowledgement for it is emitted. If persistence fails after dispatch, the service releases no ownership and emits no new transition or acknowledgement: the renderer retains the last durable pending view, the execution status channel closes/disables, and the global block plus repair/reconciliation continue. Only after repair or restart successfully fsyncs `result_unknown` may a greater revision emit unknown. A terminal query whose transition cannot be persisted is treated the same way; delivery loss can never produce success or failure.

Allowed order status values are `NEW`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `EXPIRED`, `EXPIRED_IN_MATCH`, and `REJECTED`. Any unknown upstream status is internal protocol drift and yields an unknown result, not an invented mapping.

Fixed renderer-safe codes are:

- `FUTURES_EXECUTION_PENDING`
- `FUTURES_EXECUTION_CONFIRMED`
- `FUTURES_EXECUTION_PROTOCOL_REJECTED`
- `FUTURES_EXECUTION_DISABLED`
- `FUTURES_EXECUTION_ENVIRONMENT_REJECTED`
- `FUTURES_EXECUTION_CREDENTIALS_REJECTED`
- `FUTURES_EXECUTION_SESSION_REJECTED`
- `FUTURES_EXECUTION_SYMBOL_REJECTED`
- `FUTURES_EXECUTION_RISK_DATA_REJECTED`
- `FUTURES_EXECUTION_FILTER_REJECTED`
- `FUTURES_EXECUTION_NOTIONAL_REJECTED`
- `FUTURES_EXECUTION_LEVERAGE_REJECTED`
- `FUTURES_EXECUTION_MARGIN_REJECTED`
- `FUTURES_EXECUTION_POSITION_REJECTED`
- `FUTURES_EXECUTION_REDUCE_ONLY_REJECTED`
- `FUTURES_EXECUTION_LIQUIDATION_REJECTED`
- `FUTURES_EXECUTION_DUPLICATE_REJECTED`
- `FUTURES_EXECUTION_INTERRUPTED_BEFORE_DISPATCH`
- `FUTURES_EXECUTION_BUSY`
- `FUTURES_EXECUTION_RATE_LIMITED`
- `FUTURES_EXECUTION_AUTH_REJECTED`
- `FUTURES_EXECUTION_EXCHANGE_REJECTED`
- `FUTURES_EXECUTION_RESULT_UNKNOWN`
- `FUTURES_EXECUTION_RECONCILIATION_UNAVAILABLE`

Messages are static and contain no HTTP status, Binance message/body, URL, headers, stack, signature, credential, or transport cause. Full identity remains bounded and redacted in main-process diagnostic state only.

### 7.1 Status, prepare, and reconnect protocol

The dedicated channel also accepts only two read-only session-bound actions:

```json
{"action":"futures.execution.subscribeStatus","version":1,"marketType":"futures","environment":"testnet","symbol":"BTCUSDT"}
{"action":"futures.execution.prepareIntent","version":1,"marketType":"futures","environment":"testnet","symbol":"BTCUSDT"}
```

They contain exactly those fields, are accepted only from the connection's current owned Phase 5 futures session, and cannot choose an account, generation, request ID, client ID, query, or reconciliation operation. Unsubscribe is the same exact identity with action `futures.execution.unsubscribeStatus`. Prepare creates at most one 30-second one-use intent and performs no new account/network/write call, but issues nothing unless backend capability is enabled and a valid current server-time sample already exists. Its `expiresAt` uses the safe local monotonic-derived wall anchor.

The backend emits an exact current snapshot on subscribe, prepare, reconnect, and every durable transition:

```json
{
  "channelId": "futures-execution",
  "action": "futures.execution.status",
  "version": 1,
  "revision": "7",
  "marketType": "futures",
  "environment": "testnet",
  "symbol": "BTCUSDT",
  "capability": {"enabled": false, "code": "FUTURES_EXECUTION_DISABLED"},
  "intent": null,
  "attempt": null
}
```

When issued, `intent` contains exactly the backend-generated request ID, deterministic client ID, and safe-integer `expiresAt`. `attempt` is the latest acknowledgement-shaped safe snapshot. The credential binding, internal generation, raw errors, journal path, and account material never cross the boundary. Renderer state accepts only a strictly greater decimal revision for the same backend-owned connection/session identity; stale/lower revisions and old-generation late delivery are ignored. Delivery failure never changes journal state, retries a POST, or cancels monitoring. An old unknown blocks status capability globally even after credentials rotate.

## 8. Exact-decimal and backend safety contract

### 8.1 Decimal strategy

Use a small project-owned fixed-point utility backed by native `BigInt`:

- parse an accepted string into `{ coefficient: BigInt, scale: number, original: string }`;
- align scales using powers of ten for comparisons and subtraction;
- multiply coefficients and add scales for notional;
- evaluate tick/step congruence using scaled integer modulo;
- compare basis-point ratios by cross multiplication without division;
- preserve the original string for transport and acknowledgements.

No financial value passes through `Number`, `parseFloat`, unary `+`, implicit numeric coercion, `Math.*`, exponential notation, or binary floating point. No new dependency is necessary. The transitive presence of a decimal package in a lockfile would not make it a supported direct capability.

### 8.2 Metadata and filter checks

The final backend preflight must prove:

- the allowlisted symbol matches the command and current session exactly;
- exchange status is `TRADING`;
- contract type is perpetual and quote/margin assets are USDT;
- `LIMIT` and `GTC` are supported;
- `PRICE_FILTER`, `PERCENT_PRICE`, `LOT_SIZE`, `MIN_NOTIONAL`, and `MAX_NUM_ORDERS` exist with exact types; the execution reader normalizes `PERCENT_PRICE` because the frozen Phase 5 metadata intentionally does not;
- price is within min/max and exactly on tick size;
- the official side-specific percent-price condition and the intentionally stricter opposite local bound both pass using fresh mark price and exact arithmetic;
- quantity is within min/max and exactly on step size;
- price times quantity meets the local exchange-minimum rule;
- conservative notional `quantity * max(limitPrice, markPrice)` is at or below both the mandatory configured cap and fresh symbol maximum;
- the locally owned selected-metadata digest, version, and generation have not changed and remain fresh at dispatch. Remote exchange changes can still race the reads; exchange `reduceOnly` is the final exposure guard.

### 8.3 Account, position, margin, and liquidation checks

The same-generation signed preflight must prove:

- `canTrade === true`;
- `dualSidePosition === false`;
- `multiAssetsMargin === false`;
- observed symbol `marginType === "ISOLATED"` and command assertion matches;
- `isAutoAddMargin === false`;
- observed leverage exactly equals command leverage and is no greater than configured cap or hard 3x ceiling;
- exactly one `BOTH` record describes the non-zero signed position;
- `marginAsset === "USDT"` and the position/balance records have consistent symbol/account identity;
- side is opposite the signed position and quantity is no greater than its absolute amount;
- regular open orders and algo open orders are both empty for the symbol;
- current position notional and `symbolConfig.maxNotionalValue` are valid exact decimals;
- exactly one balance row has `asset === "USDT"`; `marginAvailable === true`; its exact `availableBalance` is at least the mandatory configured positive buffer;
- `isolatedWallet`, `isolatedMargin`, `initialMargin`, `maintMargin`, `positionInitialMargin`, and `openOrderInitialMargin` are present canonical non-negative decimals. No undocumented arithmetic equality is invented among those fields;
- liquidation price is present and greater than zero;
- mark price is greater than zero and current.

Because the order can only reduce exposure, Phase 6 does not claim to calculate new initial margin. The positive available-balance buffer is a conservative fee/funding guard, not a projected-margin formula. A negative/malformed balance, margin-unavailable asset, malformed isolated margin state, or incomplete snapshot blocks the order.

Liquidation distance is exact:

- long position: `(markPrice - liquidationPrice) / markPrice`;
- short position: `(liquidationPrice - markPrice) / markPrice`.

The numerator must be positive. Compare `numerator * 10000` with `markPrice * configuredBps` after exact scale alignment. Equality passes; below the configured threshold blocks. There is no warning override.

### 8.4 Freshness and ownership

Execution freshness is intentionally stricter than the Phase 5 UI stale window:

- mark receipt age: at most 5 seconds;
- every signed account/symbol/position/balance/order snapshot completion age: at most 5 seconds;
- server-time sample age: at most 5 seconds with measured round-trip no greater than 1 second;
- final pure validation-to-dispatch interval: at most 1 second; otherwise rerun the entire preflight;
- exchange timestamps may not regress and may not be implausibly future-dated relative to the bounded server offset;
- all observations carry the same credential identity, environment, symbol, connection identity, and internal generation.

Missing, partial, stale, disconnected, future-dated, regressing, malformed, cross-generation, or mixed-account data is a hard rejection before dispatch.

The exact preflight pipeline, while holding the execution ownership lock, is:

1. Resolve replay/collision/busy state; do not create a queued record for a busy request.
2. Prove local order-count readiness and request shared-IP low-priority admission within 1000 ms. The complete uncached reviewed preflight is 25 IP weight and the current maximum Spot account-refresh batch is 23, so execution starts only with no Spot waiter and at least 48 units of shared local capacity remaining.
3. Read server time first. Capture monotonic `t0`, wall `w0`, and monotonic `t1`; require `t1-t0 <= 1000 ms`; estimate local midpoint as `w0 + floor((t1-t0)/2)` and store `serverTime - midpoint`. Later timestamps derive from `w0 + (monotonicNow-t0) + offset`, not a potentially jumping wall clock.
4. Through the same process-wide IP limiter, with Spot priority, exact per-call atomic reservations, and `maxRetries: 0`, acquire exchange info, account config, symbol config, V3 position, V3 balance, regular open orders, and algo open orders. Every GET has a transport-owned 10,000 ms whole-operation deadline, but the bundle still fails if any final age exceeds 5 seconds.
5. Normalize arrays by exact identity: reject empty, wrong-symbol/asset, mixed-symbol, duplicate, case-mismatched, extra-identity, missing-field, or wrong-type rows. Source order and harmless extra response fields do not select identity or weaken required-field validation.
6. Read the mark exactly once and last, bringing the complete preflight to exactly 25 IP weight; then run the pure evaluator, recheck command/session/generation/metadata digest, and append/fsync `dispatch_intent` within 1 second.

The shared limiter extension must preserve existing Spot weights, 500 ms spacing, priority, and refresh scheduling. Future reads are lower priority and fail the preflight rather than leave queued work that could delay Spot; every orchestrator retry re-admits and reserves weight again. A separate Phase 6 IP limiter is prohibited because it would undercount aggregate Spot/Phase 5 traffic. External orders or configuration can still race after the last read; the exchange's one-way `reduceOnly` enforcement is the final exposure guard.

## 9. Leverage and margin-mode decision

`leverage` and `marginType` in the command are assertions, not instructions:

- the backend reads current symbol configuration;
- requested leverage must equal current observed leverage and remain at or below both caps;
- requested margin type must be `ISOLATED` and equal current observed margin type;
- mismatch rejects the order;
- the placement flow never calls `POST /fapi/v1/leverage`, `POST /fapi/v1/marginType`, or a position-mode endpoint;
- the UI later displays both as read-only facts and provides no mutation control.

If a future workflow needs either change, it must define a separate action, facade method, feature gate, idempotency model, acknowledgement, risk refresh, tests, and independent review checkpoint. A placement command must never make an account configuration write as a side effect.

The reviewed write semantics are recorded only to keep them excluded:

- signed `POST /fapi/v1/leverage`, IP weight 1, requires symbol and integer leverage from 1 through 125 and returns symbol, leverage, and maximum notional value;
- signed `POST /fapi/v1/marginType`, IP weight 1, requires symbol plus exact `ISOLATED` or `CROSSED` and returns code/message;
- signed `POST /fapi/v1/positionSide/dual`, IP weight 1, changes the shared account mode across every symbol and, after current UM/CM migration, affects both UM and CM; open orders/positions cause `-4067`/`-4068` rejection.

None is an ordinary New Order parameter, none is exposed by either Phase 6 facade method, and no “already set” response such as `-4046` authorizes a hidden write.

## 10. Ambiguous-write, idempotency, and state machine

### 10.1 Dispatch boundary

The single point of no return is the durable `dispatch_intent`, not a byte-level network guess. Under the exclusive execution lock the exact sequence is: final session/generation/freshness check; append and fsync intent; transfer ownership irrevocably to the process recovery attempt; invoke the POST facade exactly once. Before the intent, teardown/timeout is a local rejection. After the intent, teardown cannot abort dispatch, and every outcome is unknown unless a complete classified HTTP/Binance response proves acceptance or rejection. A crash in the intentional intent-before-send gap is conservatively unknown and reconciles only.

There is no automatic futures order POST retry for timeout, connection loss, `408`, `418`, `429`, any `5xx` including a documented failure-looking variant, body parse failure, unknown Binance result, renderer reconnect, process restart, or any other reason.

### 10.2 Durable journal

Current `userData` is not outside renderer access: the Phase 5 window has Node integration. No journal or execution route may be installed until the renderer-isolation prerequisite in checkpoint 2 is complete. After that hardening, the main process owns these exact storage rules:

- Acquire Electron's OS-backed single-instance lock before credential/execution setup. Refusal to acquire exits or leaves execution disabled before opening the journal. Hold a second exclusive journal/account lease for the process lifetime.
- Packaged testnet path is `userData/futures-testnet-execution/v1/journal.bin`; development uses `futures-testnet-execution-dev/v1`; E2E receives an injected temporary directory and can never open the packaged path. Future production may not reuse any namespace.
- Parent directories are owner-only `0700`; journal/key/anchor are owner-only `0600`. Open with no-follow/exclusive semantics, verify regular-file type, owner, link count, and mode before use, and reject symlink, replacement, wrong owner/mode, or lock loss.
- Generate an integrity key in main and persist it only through Electron `safeStorage`; fail execution closed when secure storage is unavailable. Store a separately sealed latest `{sequence, recordHash}` anchor so a valid old journal rollback is detected.
- Each record is at most 16,384 bytes: 4-byte big-endian payload length, fixed-order UTF-8 versioned payload, and 32-byte HMAC-SHA256 chaining previous hash, sequence, and payload. Sequence is a canonical positive decimal with exact increment one.
- The command digest is lowercase SHA-256 over UTF-8 `cc-trade/futures-testnet-command/v1` followed by length-prefixed exact fields in protocol order, preserving the lexical quantity/price strings. No delimiter ambiguity or generic object serialization is permitted.
- Store the complete non-secret canonical command, digest, request/client IDs, environment/symbol, opaque `HMAC(integrityKey, demoOrigin + NUL + apiKey)` credential binding, generation lineage, timestamps, rate/ban state, safe transition, and lossless exchange identity. This supplies every field needed for restart reconciliation and a safe renderer summary.
- Append and fsync `queued`; append and fsync `dispatch_intent`; append and fsync every later transition before external acknowledgement. File creation/replacement and compaction also fsync the parent directory.
- Only a provably incomplete final record beyond the sealed last-good anchor may be truncated to that anchor and fsynced. Unknown version, anchor rollback, HMAC/sequence failure, mid-file corruption, missing anchored data, or unexplained truncation disables execution and leaves the account globally blocked.
- Compaction writes a same-directory temporary file, fsyncs it, atomically renames it, fsyncs the directory, and updates the sealed anchor. Unknown/accepted/open records remain complete. After 90 days, terminal detail may compact only to a permanent `{requestId, clientOrderId, digest, terminalState, safeCode}` tombstone; tombstones never expire and identical collision returns that terminal safe state while any changed collision rejects.
- Never store credentials, signatures, signed URLs/bodies, headers, raw responses, or unredacted errors.

A journal/fsync failure before `dispatch_intent` rejects locally and proves no POST was committed. A startup `queued` record without intent is deterministically transitioned and fsynced to `locally_rejected` with `FUTURES_EXECUTION_INTERRUPTED_BEFORE_DISPATCH`; identical replay returns that terminal rejection and a new order needs a newly prepared ID. Any intent without a durable proven result becomes `result_unknown` and reconciles only.

If any state/result append fails after intent, the service cannot release ownership or report the unpersisted success/failure. It closes/disables status delivery at the last durable pending revision, keeps the global block, and starts reconciliation/repair. Unknown is emitted only after its own durable transition. Terminal-query persistence failure follows the same rule.

### 10.3 Duplicate and concurrency rules

- Under the process-wide exclusive lease and in-process critical section, resolve identical replay and collisions first, reject busy second, then append/fsync exactly one `queued` active attempt. Busy rejections are not active journal attempts and do not dispatch.
- Same request ID and identical canonical digest returns the existing stored state without dispatch.
- Same request ID with a different digest rejects.
- Same client ID with another request/digest rejects.
- Only one nonterminal Phase 6 attempt exists globally, including `exchange_accepted`, `confirmed_open`, unknown, and credential-mismatched recovery—not merely per renderer or current credential.
- Distinct concurrent requests receive `FUTURES_EXECUTION_BUSY` before dispatch.
- An unresolved unknown result blocks every later Phase 6 write across credential rotation.
- Reconstruct one-per-10-second/five-per-minute counters from durable dispatch intents; count at intent regardless of response. Persist 418/429 deadlines. In-process ages use monotonic time; persisted deadlines use bounded server-adjusted time and fail closed on clock rollback until a new server-time sample proves safety.

### 10.4 State machine

```text
received -> locally_rejected
received -> queued -> locally_rejected
                   -> dispatched -> exchange_rejected
                                 -> exchange_accepted -> reconciling
                                 -> result_unknown -> reconciling -> exchange_rejected
                                                            -> confirmed_open -> reconciling
                                                            -> confirmed_filled
                                                            -> confirmed_canceled
                                                            -> reconciliation_unavailable
```

- `locally_rejected`: no POST facade invocation occurred.
- `queued`: journaled, waiting for preflight/rate/mutex admission.
- `dispatched`: durable dispatch intent exists and the POST facade was invoked.
- `exchange_accepted`: a valid identity-matching response proves acceptance; it does not invent fill state.
- `exchange_rejected`: a valid response proves rejection.
- `result_unknown`: dispatch occurred or may have occurred, but neither acceptance nor rejection is proven.
- `reconciling`: exact read-only query is active.
- `confirmed_open`: query proves `NEW` or `PARTIALLY_FILLED`; it remains nonterminal and returns to monitoring/reconciling.
- `confirmed_filled`: query proves `FILLED`.
- `confirmed_canceled`: query proves `CANCELED`, `EXPIRED`, or `EXPIRED_IN_MATCH`; the app did not necessarily initiate cancellation.
- `reconciliation_unavailable`: fast reads cannot prove a result; the durable unknown, slow backend recovery ownership, and write block remain.

`REJECTED` returned as an order status maps to exchange rejection only when the identity and response are valid. No renderer acknowledgement reports success merely because local validation or transport dispatch completed.

### 10.5 Reconciliation

Every valid ACK is followed by Query Order; ambiguity is not the only query owner. Fast reconciliation calls only `queryOrderByOriginalClientOrderId({ symbol, originalClientOrderId })` immediately, then after 1, 2, 5, 10, and 30 seconds, paused by server ban/rate signals. Each GET has a 10,000 ms whole-operation deadline; one deadline consumes only that scheduled read and never triggers an unscheduled transport retry.

- Reconciliation GETs may retry only under this explicit schedule.
- A successful ACK/query must contain exact client ID, symbol, side, `positionSide: "BOTH"`, `type: "LIMIT"`, `origType: "LIMIT"`, `timeInForce: "GTC"`, `reduceOnly: true`, `closePosition: false`, command-equivalent `origQty` and price, canonical non-negative executed quantity/average price, recognized status, safe update time, supported response working type, `priceProtect: false`, and a positive lossless order ID no greater than signed-int64 maximum. Quantity and price compare by exact fixed-point numeric equality after scale alignment (`1.0` equals `1.00`) with no rounding. One missing/wrong field or malformed/truncated success after intent is unknown.
- A returned exchange order ID is retained as a lossless string and must remain stable.
- Query `-2013` is not evidence of failed placement after an ambiguous dispatch.
- Binance's query retention limits mean an unfilled `CANCELED`/`EXPIRED` order may become unavailable after three days and other orders after 90 days. Absence inside or outside those windows never converts a durable unknown into failure.
- Fast exhaustion produces `reconciliation_unavailable`, then a backend-only query every 5 minutes while the original credential binding is available and the order is within the 90-day query horizon. Beyond that horizon it remains blocked/unavailable until a separately reviewed recovery action; absence never proves failure.
- A confirmed open order is queried by exact original client ID every 60 seconds until `FILLED`, `CANCELED`, `EXPIRED`, `EXPIRED_IN_MATCH`, or validated `REJECTED`. Monitoring survives restart, renderer teardown, and soft disable; bans pause it. The external Binance Testnet interface is the only cancellation mechanism in checkpoint one.
- Query status `REJECTED` transitions to `exchange_rejected`. `confirmed_filled`, `confirmed_canceled`, `exchange_rejected`, and `locally_rejected` are terminal; all other states retain process ownership.

## 11. Transport and rate-limit design

### 11.1 Exact facade arguments

`placeReduceOnlyLimitGtcOrder` accepts one frozen ordinary object with only:

```text
symbol, side, quantity, price, clientOrderId
```

All other upstream fields are facade constants. `queryOrderByOriginalClientOrderId` accepts only:

```text
symbol, originalClientOrderId
```

The backend service, not the facade caller, owns the validated command, but the facade still independently checks this reduced schema and allowed symbol to prevent misuse.

Immediately before I/O, the facade asserts exact HTTPS origin and path, forbids URL credentials, proxy, agent/dispatcher, redirect callback, and caller headers, and uses `redirect: "error"`. HTTP 301, 302, 303, 307, or 308 is an error with zero follow-up request, so an API key, signature, or POST can never escape the demo origin.

The POST and each Query Order GET have a transport-owned 10,000 ms whole-operation deadline including body read. After durable intent, POST deadline/abort/late delivery is unknown; renderer teardown does not own that abort signal. A Query Order deadline is one failed scheduled read. All timers/listeners are cleared once and late responses cannot mutate a later attempt.

Response parsing limits are exact: 65,536 body bytes while streaming, 64 response headers, 4096 bytes per header value, 32,768 aggregate header bytes, 512 UTF-8 bytes for Binance `msg`, and 4096 sanitized bytes of retained body diagnostic plus a SHA-256 body digest. Oversized/chunked overflow aborts parsing; after intent it is unknown. The facade recognizes a 2xx `{code,msg}` error body rather than treating HTTP status alone as success.

Do not call `response.json()`. A project-owned schema-specific duplicate-key-aware JSON tokenizer captures integer tokens before JavaScript numeric conversion: `orderId` is 1–19 ASCII digits parsed to `BigInt`, bounded by `9223372036854775807`, and exposed as its original decimal string; timestamp tokens must be non-negative safe integers; financial fields must be JSON strings and pass the fixed-point parser. Unknown/duplicate identity fields, unsafe integers, floats/exponents for integer fields, or wrong top-level shape fail the response schema.

### 11.2 Admission

- Every Phase 6 GET uses the existing process-wide IP-weight admission shared with Spot and Phase 5, with Spot priority, exact atomic reservation per transport attempt, and `maxRetries: 0`. The orchestrator alone owns scheduled query retries and re-reserves each time.
- POST uses a separate process-wide testnet-account order-count limiter and never the generic retry wrapper. The shared IP admission extension must preserve Spot's existing weights, 500 ms delay, and scheduling semantics.
- Local policy permits at most one placement attempt per 10 seconds and five per rolling minute, both stricter than or equal to the documented header dimensions.
- The one-nonterminal-command mutex and zero-current-open-order rule are additional limits.
- Parse Binance order-count and used-weight headers internally for conservative future admission; never expose raw headers. Advertised lower limits reduce local admission. Missing/malformed/negative/overflow order-count or used-weight headers close new writes for at least 120 seconds rather than assuming capacity.
- `Retry-After` accepts only a canonical non-negative integer number of seconds or a syntactically valid HTTP date relative to server-adjusted time, is clamped safely to the documented three-day maximum, and never uses an untrusted wall-clock rollback. Missing/malformed `429` uses a 120-second floor; missing/malformed `418` uses a three-day fallback. The later of valid server value and local floor is persisted across restart.
- Body `-1003`, lower advertised order limits, HTTP `401`/`403`/WAF, and malformed/missing rate headers all close admission conservatively and never authorize retry.
- Reconciliation remains required but waits while the server says the IP is banned.

### 11.3 Errors and redaction

- Preserve exact HTTP status, Binance code/message, bounded body identity, network cause, dispatch phase, and retry/ban headers internally.
- Renderer sees only the fixed code, static message, state, and safe order summary.
- Redaction happens before logs, metrics, journal, exception serialization, and test snapshots.
- Execution transport errors are purpose-built safe records and never retain request config, headers, body, URL query, raw cause/config objects, or authentication material. Install one structured process-wide sanitizer before `console`, `uncaughtException`, and `unhandledRejection` sinks; test raw and encoded keys, rotated values, signatures, signed URLs/bodies, nested `cause`/`config`, analytics, metrics, journal, and snapshots.
- Never log API key, secret, signature, HMAC input, complete signed URL/body, auth headers, raw configuration, or an error object that may contain them.
- Soft flag disable stops new admission but always starts a reconciliation/open-order-monitoring-only worker when the journal is nonterminal, even if the enable flag is false. Missing/mismatched credentials leave recovery unavailable and globally blocking.
- Binary downgrade to code that cannot read and reconcile the current journal is prohibited while any nonterminal record exists. A deployable rollback must retain a backward-compatible recovery worker until every attempt is terminal; rollback never erases the journal, cancels an order, or converts unknown into failure.

## 12. Lifecycle and session ownership

`FuturesTestnetExecutionService` must mirror Phase 5's exact ownership discipline without modifying it:

- A successful Phase 5 futures subscribe establishes the renderer connection's current read session; a parallel execution-session record binds connection identity, symbol, environment, credential identity, and an internal generation.
- The command never carries a caller-selected generation or session token.
- Preflight child reads have abort controllers, timeouts, attempt IDs, and generation checks.
- A newer subscribe invalidates queued/pre-dispatch work from an older generation.
- Renderer unsubscribe, mode switch, socket close, or window teardown aborts work only before dispatch.
- After durable `dispatch_intent`, ownership transfers to the process-wide testnet attempt. Teardown is not cancellation and cannot stop or retry the POST, exact reconciliation, or confirmed-open monitoring.
- A dispatched attempt may update its durable journal with no renderer connected.
- Reconnect receives the exact revisioned status snapshot only after backend identity binding; old generations never emit into a newer or different symbol session.
- Graceful shutdown stops admitting writes, completes or times out the current journal fsync, persists recovery ownership, and closes readers. It never aborts a post-intent POST or performs best-effort cancellation. Restart resumes unknown and accepted/open monitoring before enabling new writes.

## 13. Renderer plan

No renderer execution component is part of this planning checkpoint.

After backend protocol, risk, journal, state machine, facade, gate, and fake-transport tests pass independently, add at most one compact ticket:

- visible only in the existing Futures mode;
- unmistakable label `USDⓈ-M TESTNET · REDUCE ONLY` and a distinct execution-enabled indicator owned by backend capability state;
- reduce-long/reduce-short presentation derived from the current signed position; no opening Long/Short choice;
- exact-string quantity and price fields; `LIMIT/GTC`, one-way `BOTH`, isolated margin, current leverage, working type not applicable, and price-protect false shown as fixed/read-only facts;
- no leverage, margin-mode, position-mode, reduce-only toggle, cancel, modify, transfer, production, or mock execution control;
- preview of fresh mark age, current position, max reducible quantity, conservative notional, configured cap, liquidation distance, and deterministic client ID;
- disabled for gate-off, mock, stale/incomplete/disconnected data, mismatched account state, existing orders, busy state, or unresolved unknown result;
- backend pending/rejected/accepted/unknown acknowledgements displayed verbatim through safe mappings; never invent success;
- unknown result remains prominent and blocks another submission;
- renderer unmount or mode switch never implies order cancellation.

No existing Spot/global shortcut, generic Enter handler, or legacy channel may submit this command. The ticket synchronously disables double submission before sending, then derives all pending/recovered state from the backend revisioned snapshot rather than local optimism. Futures execution command, capability, acknowledgement, and intent data are prohibited from Spot `DataContext`, localStorage/sessionStorage, analytics, telemetry, clipboard, and generic error reporting. The external Binance Futures Testnet interface is the only cancellation mechanism for a confirmed-open checkpoint-one order, and the ticket says so without presenting cancellation as an app capability.

The ticket uses a dedicated hook/channel and remains outside `DataContext`. Spot appearance, shortcuts, LIMIT/GTC behavior, cancellation, refresh timing/weights, and exact `0.999` quantity reduction remain unchanged.

## 14. Deterministic implementation test matrix

All automated tests use injected deterministic fakes. Default tests must fail if they can resolve a production or testnet network socket. Optional testnet smoke testing is manual, separately authorized, excluded from CI/default scripts, and never uses a real account.

### 14.1 Protocol and gate

- safe default disabled;
- exact `mock`, `testnet`, missing, malformed, and attempted `production` selection matrix;
- execution flag missing/false/malformed/exact true;
- missing, whitespace, invalid, production-only, and valid-on-fixed-testnet credential behavior;
- malformed/empty/duplicate allowlist and every cap boundary;
- exact config byte/count/delimiter/case/whitespace/leading-zero grammar and delete-before-window behavior;
- no renderer state can enable the backend gate;
- strict object/prototype/accessor/extra-field/duplicate-key/oversize rejection;
- exact 4096-byte command and 40-digit/18-scale boundaries at limit, minus one, and plus one;
- main `crypto.randomBytes` intent issuance, 30-second expiry, connection/generation binding, and no Spot/`Math.random` reuse;
- malformed-command rejection with null untrusted identities and no echo;
- exact status/prepare/subscribe/unsubscribe schemas, monotonic decimal revisions, reconnect replay, and stale-revision rejection;
- exact version, request ID, environment, symbol, side, fixed order fields, and deterministic client ID;
- decimal lexical extremes and safe identifier/timestamp behavior;
- existing typed and every legacy futures command reject both before and after the exact dedicated route is deliberately installed.

### 14.2 Secret and capability isolation

- futures credentials captured/deleted before `BrowserWindow`;
- no secret, signature, raw body/header, internal error, or generic client crosses to renderer/log/journal;
- renderer sandbox/preload has no `fs`, `process`, environment, Electron main API, or `userData` access; CSP/navigation/window-open policy rejects escape;
- raw/encoded/rotated keys, signatures, signed URLs/bodies, nested error cause/config, process-level crash handlers, analytics, metrics, and snapshots are sanitized;
- exact facade export list contains only two methods;
- arbitrary endpoint, URL, method, options, base override, retry, cancellation, modification, leverage, margin, mode, transfer, and batch access are impossible;
- production hostname/configuration is absent and unreachable;
- every 301/302/303/307/308 to production/arbitrary origin follows zero redirects and forwards zero credential/signature bytes;
- packaged, development, E2E-temp, and future-production journal namespaces cannot open one another;
- mock can exercise orchestration fakes but can never satisfy execution admission.

### 14.3 Transport contract

- exact demo origin, path, HTTP verb, content type, form/query location, field set, order, encoding, header, `recvWindow`, timestamp offset, and signature bytes;
- caller cannot override any transport-owned value;
- exact 10,000 ms POST/query deadline, late delivery suppression, timer/listener cleanup, 65,536-byte body, header, message, and diagnostic bounds;
- documented weight reservation for every preflight/reconciliation endpoint;
- shuffled concurrent Spot/Phase5/Phase6 shared reservations, 23-weight Spot headroom, Spot priority, and exactly one `maxRetries: 0` GET per schedule point;
- placement increments both order-count dimensions and no IP-weight assumption;
- persisted local 10-second/minute windows, global execution mutex, and open-order admission;
- exact original-client-ID reconciliation and lossless order ID parsing;
- ACK/query required-field mismatch one field at a time, scale-equivalent decimal equality, and order IDs at `2^53-1`, `2^53`, and signed-int64 maximum;
- `-1003`, 401/403/WAF, lower advertised limits, and missing/malformed/negative/overflow order-count, used-weight, `Retry-After`, and ban values;
- no POST retry under any transport/status/body outcome.

### 14.4 Decimal and risk boundaries

- exact tick/step equality, one unit either side, min/max equality, and scale alignment;
- side-specific official percent-price rules plus the intentional opposite local bound; zero min/max, zero-tick fail-closed, positive LOT_SIZE, and `MAX_NUM_ORDERS` missing/zero/malformed cases;
- minimum notional equality and deliberate reduce-only dust rejection;
- configured and symbol maximum notional equality and one unit over;
- limit-below/above-mark conservative max selection;
- exchange status/contract/assets/order type/TIF/filter presence and metadata drift;
- observed leverage equality, mismatch, cap equality/over-cap;
- isolated/crossed, auto-add, single/multi-assets, can-trade states;
- one-way valid long/short reductions, zero position, wrong side, oversize quantity, hedge-mode rejection, non-`BOTH` position;
- regular/algo existing-order rejection;
- fresh/missing/stale/future/regressing mark, position, balance, account config, symbol config, server time, and order snapshots;
- empty/wrong/mixed/duplicate/case-mismatched array identities and harmless source-order/extra-field variations for every reader normalizer;
- exact monotonic midpoint server offset, wall-clock jump/rollback, high RTT, metadata digest/generation drift, and each field age boundary;
- configured available-balance buffer and exact required non-negative isolated margin fields;
- liquidation-distance equality, below/above, wrong side, zero/missing liquidation, and exact cross-multiplication.

### 14.5 Idempotency, ambiguity, and lifecycle

- duplicate request ID with identical digest returns stored state without dispatch;
- changed-payload request collision and client-ID collision reject;
- simultaneous renderer/process submissions serialize and later requests get busy;
- pre-intent journal open/append/fsync failures prove no dispatch;
- journal byte truncation at every offset, HMAC/sequence/version/anchor corruption, rollback/replacement/symlink/wrong-mode, lock loss, crash around each fsync, atomic compaction, and replay after 90-day tombstoning;
- two child processes contend for the single-instance/journal lease; only one can admit;
- queued-only restart becomes durable local rejection; credential rotation/mismatch preserves global unknown block;
- post-intent transition/terminal fsync failures emit unknown, retain ownership, and acknowledge only after durable state;
- restart before dispatch remains local; restart after dispatch intent becomes unknown and reconciles only;
- teardown/race injection at every await around final generation check, intent fsync, ownership transfer, facade invocation, and response;
- timeout/abort before dispatch versus every uncertain error after dispatch;
- valid ACK, confirmed exchange body rejection, `-1006`, `-1007`, `-1008`, duplicate `-4116`, malformed `2xx`, `408`, `418`, `429`, every `5xx`, and network loss;
- every 503/5xx variant classified unknown after dispatch and zero POST retries;
- exact reconciliation schedule, identity mismatch, repeated `-2013`, temporary read errors, ban delay, terminal statuses, and exhaustion;
- ACK-to-query, `NEW`/`PARTIALLY_FILLED` 60-second monitoring to later fill/cancel/reject, restart-open, teardown-open, long-lived open, and soft-disabled recovery-only startup;
- five-minute slow unknown recovery, 3-day/90-day retention boundary, missing credentials, binary downgrade guard, and graceful shutdown;
- unresolved unknown remains durable and account-wide blocking;
- persisted dispatch counters and 418/429 deadlines survive restart and wall-clock rollback;
- teardown before dispatch aborts; teardown after dispatch continues backend reconciliation;
- reconnect restores safe attempt state; stale generation delivery is suppressed;
- renderer-safe pending/accepted/rejected/unknown mappings never invent success/failure.

### 14.6 Regression and UI

- zero futures facade calls from existing typed/legacy futures rejection paths before route installation;
- zero futures facade calls from generic typed/legacy paths after the dedicated route is installed;
- zero spot adapter calls for every futures path;
- full spot adapter, connection, DataContext, App mode, build, and E2E regression behavior;
- spot LIMIT/GTC, cancellation, refresh weights/timing, shortcuts, appearance, and `0.999` unchanged;
- future ticket disabled under every backend gate/risk/session failure;
- TESTNET and execution-enabled state unmistakable; mock/production execution impossible;
- no Spot/global shortcut or Enter handler submits futures; synchronous double-submit suppression plus backend lock;
- no execution data enters `DataContext`, local/session storage, analytics, telemetry, clipboard, or generic errors;
- unknown and backend-recovered state remain explicit across unmount/reconnect, with external Testnet UI identified as the only checkpoint-one cancellation path.

## 15. Security, trust boundaries, and rollout

### Trust boundaries

- Renderer input is hostile/untrusted. Execution cannot be installed until renderer filesystem/process access is removed by the sandbox/preload prerequisite; afterward it receives only a non-secret capability projection plus safe acknowledgements.
- Main-process protocol validation is the first authority boundary.
- `FuturesTestnetExecutionService` owns authorization, state, risk, idempotency, and session decisions.
- The narrow facade owns exact signing and fixed transport identity.
- Binance Testnet is an external untrusted network whose responses require schema and identity validation.
- The local journal is sensitive integrity state, is HMAC/rollback anchored in main, and contains no exchange authentication material.

### Security invariants

- Secrets remain main-process-only and are deleted from inherited environment before renderer creation.
- Every Phase 6 runtime boundary is named `FuturesTestnet...`; the module contains no production origin, rejects redirects, and accepts no origin/proxy/dispatcher input.
- Renderer state never enables execution or supplies current risk facts.
- Every command is replay/duplicate protected before dispatch.
- Financial validation is exact and backend-owned.
- A write is never automatically retried after dispatch.
- Unknown is a first-class nonterminal safety result, not success or failure.
- Teardown is not cancellation.
- Soft disable stops new writes but preserves recovery/monitoring; binary downgrade is prohibited unless it retains a compatible recovery worker.
- Typed and legacy futures execution remain rejected until the exact new route is installed, and legacy futures remains rejected afterward.

### Rollout separation

Phase 6 contains no production enablement, production credentials, production account limits, daily production notional, production kill switch, production cancel-all, or production audit rollout. Those are Phase 7 concerns and do not become implied requirements or hidden branches of the testnet implementation.

Phase 7 may not add a `production` enum to, parameterize, or reuse the Phase 6 host resolver, credentials, channel, protocol action, journal namespace, or facade. It requires a new production ADR, separately named composition, credential source, protocol/channel, storage namespace, safeguards, and rollout review.

The Phase 6 safety journal is solely idempotency/recovery state. It is not the Phase 7 production audit log.

## 16. Planned implementation checkpoints

Each checkpoint requires fresh GitNexus impact analysis, focused tests, and independent review before the next begins.

1. Add only the strict command/ack schemas, native exact-decimal utility, pure risk evaluator, and deterministic tests. Do not install a route, transport, credential reader, or renderer control.
2. Complete the renderer-isolation prerequisite: disable Node integration, enable context isolation and sandboxing, expose only a narrow preload bridge, restrict navigation/window creation/CSP, and retain complete Spot regression behavior. Do not install an execution route.
3. Add the separately named read-only `FuturesTestnetExecutionRiskReader` plus the shared-IP admission extension, injected fakes, freshness bundle, session/generation ownership, and Spot-priority tests. Keep Phase 5 frozen.
4. Add single-instance/exclusive ownership, the durable journal, global execution mutex, state machine, status snapshots, and reconciliation/open-order monitoring against fakes. Register only the three read-only `subscribeStatus`, `unsubscribeStatus`, and `prepareIntent` actions; there is still no write route or POST facade.
5. Add the exact two-method `FuturesTestnetExecutionFacade` with fake transport, fixed-host/signature/weight/error/redirect tests. Still no registered execution route.
6. Deliberately install `futures.execution.placeOrder` as the only action capable of network write, behind the complete backend gate. Preserve the three reviewed read-only status actions plus generic typed and legacy futures rejection.
7. Repeat independent safety, documentation/SDK/test, and isolation/security/Spot audits. Only after all backend findings are fixed, add the compact testnet reduce-only ticket.
8. Treat every additional order shape or write as a separate reviewed checkpoint. Do not roll into Phase 7.

## 17. Planning audit and validation record

Three independent read-only audits were completed before this planning document was committed:

1. futures execution safety, ambiguous-result, and lifecycle;
2. official documentation, generated SDK contract, and test strategy;
3. isolation, security, production exclusion, renderer, and Spot regression.

Initial safety/lifecycle review found the unsandboxed renderer/journal trust error, missing cross-process ownership, incomplete journal framing/recovery/account binding, ambiguous dispatch boundary, queued/post-intent fsync cases, accepted-open and slow-unknown ownership, reconnect protocol, shared-IP retry accounting, exact deadlines/bounds, and rate persistence. All were fixed. Its closure pass caught and then verified fixes for five residual contradictions: a byte-proof exception after intent, non-durable unknown acknowledgement, a possible second mark read, status time before a server sample, and installation timing for the read-only status actions. Final result: PASS.

Initial official-doc/SDK/test review corrected side-specific `PERCENT_PRICE`, zero-tick semantics, `MAX_NUM_ORDERS`, exact write semantics, current regular/algo inconsistency, deadlines/resource bounds, response identity/lossless IDs, config grammar, shared limiter ownership, and missing deterministic cases. Final result: PASS with current endpoint, weight, signing, host, error, and SDK statements verified.

Initial isolation/security/renderer/Spot review required sandbox/preload hardening, integrity-anchored storage, redirect rejection, soft-disable recovery, binary-downgrade guard, revisioned status, credential-rotation blocking, structured redaction, Spot priority, journal namespaces, backend crypto IDs, and explicit Phase 7 non-reuse. Final result: PASS.

No auditor edited files. The final planning validation also records GitNexus working/staged/base/main comparisons, circular-import results, focused unchanged-boundary tests, docs-only diff scope, final commit/index equality, and a clean worktree.

Pre-commit validation record:

- Scope is exactly this new design plus the Phase 6/Start Here roadmap update. No source, test, dependency, lockfile, renderer component, or transport file changed; Phase 5 status is untouched.
- Focused unchanged-boundary suites passed `50/50`: typed/legacy futures-command rejection `11/11`, Phase 5 protocol `8/8`, Phase 5 service `18/18`, and connection/composition `13/13`.
- `git diff --check` passed. Targeted lint was correctly not run because no executable source/test changed.
- GitNexus working scope was LOW: `1 tracked file / 5 Markdown symbols / 0 processes`; the new untracked design was not graph-attributed until staging.
- GitNexus staged and exact Phase 5-base comparison were each LOW: `2 files / 5 Markdown symbols / 0 processes`.
- The cumulative comparison against `main` was CRITICAL: `59 files / 1116 symbols / 165 processes`, inherited from the complete Phase 1–5 branch history rather than this docs-only delta. The result was reported and retained explicitly.
- Pre-commit circular-import check found zero cycles.

Post-index results, repeated after the documentation amend against the final indexed commit:

- Exact Phase 5-base comparison: LOW `2 files / 66 indexed Markdown symbols / 0 execution processes`.
- Cumulative `main` comparison: CRITICAL `59 files / 1179 indexed symbols / 166 execution processes`; the additional attribution is the newly indexed design headings plus inherited branch history, not executable change in this checkpoint.
- Circular-import check: zero cycles.
