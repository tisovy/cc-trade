# Futures And Hardening Roadmap

This document is the implementation roadmap for stabilizing the current spot terminal and adding futures support safely.

## Guardrails

- Do not change the existing `0.999` quantity reduction behavior unless explicitly approved later.
- Do not remove or remap existing keyboard/mouse shortcuts unless explicitly approved later.
- UI changes must be incremental, small, and reviewed before expanding the surface area.
- Prefer non-UI safety and contract work before adding new visible futures controls.
- Futures must not be added by extending spot order handlers with ad hoc fields.

## Current State

- Frontend: React/Vite/Electron renderer.
- Backend: Electron main process plus Node services using `@binance/spot`.
- No Python service is present in this workspace.
- Market data is partly on the newer channel protocol.
- Renderer trading commands use the versioned typed protocol; the legacy WebSocket protocol (`buyOrder`, `sellOrder`, `cancelOrder`) remains available for compatibility.
- Spot order execution is currently limited to `LIMIT` + `GTC`.
- E2E builds keep DevTools closed by default; remaining E2E work should focus on deterministic state and selectors.

## Product Direction

The terminal should keep the current fast spot workflow, then add futures as a distinct trading mode:

- Spot and futures instruments must be separate domain entities.
- Futures UI must make leverage, margin mode, position side, reduce-only state, funding, and liquidation risk explicit.
- Futures execution should first ship as read-only, then testnet execution, then guarded production.

## Phase 1: Non-UI Safety Hardening

Goal: reduce operational and security risk without changing the visible workflow.

1. [x] Remove analytics secret exposure from the renderer bundle and localStorage.
2. [x] Gate `openDevTools()` behind a development flag so packaged and E2E builds do not open DevTools by default.
3. [x] Add local WebSocket access control:
   - bind explicitly to localhost;
   - validate origin where possible;
   - add a per-session token/nonce between Electron main and renderer.
4. [x] Add command-level validation and rejection messages in the backend for malformed order/cancel requests.
5. [x] Keep current spot order behavior unchanged, including the `0.999` quantity reduction.

Acceptance:

- `npm run lint`
- `npm test`
- `npm run build`
- No visual UI changes.
- Existing spot order payload behavior remains unchanged.

## Phase 2: E2E Stabilization

Goal: make regression checks reliable before larger architecture work.

1. [x] Update E2E app-window selection to ignore DevTools windows.
2. [x] Disable DevTools in E2E unless explicitly requested.
3. [x] Reset or control persisted localStorage state in tests (`currentView`, mock WS URL, chart config).
4. [x] Update stale selectors for current UI structure.
5. [x] Ensure mock WebSocket messages cover both legacy and channel protocol paths where tests need them.

Acceptance:

- `npm run test:e2e` passes locally.
- E2E failures indicate product regressions, not harness/window-selection issues.

## Phase 3: Trading Command Contract

Goal: replace legacy stringly-typed trading requests with a typed command surface.

Introduce a versioned command protocol:

```js
{
  action: "trade.placeOrder",
  version: 1,
  marketType: "spot",
  accountId: "default",
  clientOrderId: "...",
  symbol: "BTCUSDT",
  side: "BUY",
  orderType: "LIMIT",
  timeInForce: "GTC",
  price: "50000.00",
  quantity: "0.010000"
}
```

Required command families:

- `trade.placeOrder`
- `trade.cancelOrder`
- `trade.replaceOrder`
- `trade.cancelAll`
- `account.refresh`

Rules:

- Keep legacy protocol during migration.
- Add typed commands behind adapter functions first.
- Do not change UI flows in this phase.

Progress:

- [x] Add typed spot command builders and legacy adapters for current place/cancel flow.
- [x] Add backend validation/dispatch for `trade.placeOrder`, `trade.cancelOrder`, and `account.refresh`.
- [x] Define `trade.replaceOrder` and `trade.cancelAll` with explicit disabled-command backend rejection.
- [x] Migrate the spot UI wire protocol from legacy messages to typed command messages after the adapter path is proven.

Acceptance:

- Existing spot UI can place/cancel orders through the adapter path.
- Legacy protocol remains available until tests and UI are migrated.

## Phase 4: Spot Adapter Boundary

Goal: isolate current spot behavior before adding futures.

Create a spot adapter with this shape:

```js
class SpotTradingAdapter {
  getExchangeInfo(symbol) {}
  getAccountState() {}
  getOpenOrders(symbol) {}
  getTradeHistory(symbol) {}
  placeOrder(command) {}
  cancelOrder(command) {}
}
```

Move spot-specific assumptions into the adapter:

- spot account balances;
- spot exchange filters;
- spot open orders;
- spot user-data stream normalization;
- `LIMIT/GTC` default handling.

Progress:

- [x] Map current spot backend responsibilities in `electron/services/binance-connection.js`:
  - spot account balances: REST `getAccount`, nonzero free/locked filtering, renderer `{ balances }` payloads;
  - spot exchange filters: REST `exchangeInfo`, `MIN_NOTIONAL` / `PRICE_FILTER` / `LOT_SIZE` parsing, global `{ filters }` payloads;
  - spot open orders: REST `getOpenOrders`, renderer `{ orders }` payloads;
  - spot trade history: REST `myTrades({ limit: 500 })`, renderer `{ history }` payloads;
  - spot order execution: validated `LIMIT/GTC` `newOrder`, `FULL` response normalization, post-order account refresh;
  - spot order cancellation: validated `deleteOrder`, cancellation execution normalization, post-cancel account refresh;
  - spot user-data stream normalization: `executionReport`, `outboundAccountPosition`, and `balanceUpdate` broadcasts;
  - non-spot concerns still in the service: local WebSocket access control, renderer connection lifecycle, ticker streams, market chart/depth/trade streams, mock mode.
- [x] Add the first `SpotTradingAdapter` seam for current spot exchange/account/order REST operations while preserving legacy and typed command behavior.
- [x] Move spot user-data stream normalization behind adapter-owned helpers while preserving renderer `execution_update` / `balance_update` payloads and REST balance-refresh triggers.
- [x] Move spot account-refresh payload construction and refresh operation weights behind adapter-owned helpers while preserving renderer `balances` / `orders` / `history` payloads, rate-limit weights, and post-place/post-cancel sequencing.
- [x] Reuse adapter-owned account snapshot operations for initial detail-channel spot balances / open orders / trade history fetches while preserving renderer payloads and rate-limit weights.
- [x] Move spot user-data stream listen-key creation and renewal behind adapter-owned helpers while preserving stream setup, keep-alive behavior, and rate-limit weights.
- [x] Keep current spot order placement `LIMIT/GTC` defaults owned by the adapter while preserving renderer payloads and REST order parameters.
- [x] Move mock spot order-placement execution report construction behind an adapter-owned helper while preserving the existing renderer payload shape.
- [x] Restore per-operation refresh failure isolation after the account-operation extraction so balances, open orders, and history still run sequentially after an exhausted operation failure.
- [x] Move the spot server-time REST request behind the adapter while preserving clock-drift validation, logging, and startup behavior.
- [x] Move spot user-data WebSocket connection creation behind the adapter without changing reconnect, teardown, or keep-alive timing.
- [x] Reuse adapter-owned balance refresh operation metadata for stream-triggered shared balance refreshes.
- [x] Add service-level orchestration coverage before changing higher-risk subscription or trading flows.

Acceptance:

- Spot behavior remains identical from the user's perspective.
- Order/balance/history parsing is easier to test in isolation.

Phase status: **Complete (2026-07-10).**

Exit audit:

- [x] Verified that `SpotTradingAdapter` owns the declared spot balances, filters, open orders, history, placement/cancellation, listen-key creation/renewal, user-data normalization, server time, account-refresh metadata, and user-data WebSocket creation boundaries.
- [x] Verified that remaining direct Binance behavior in `binance-connection.js` is limited to intentional public market-data transport, client composition, mock data, and service/renderer orchestration.
- [x] Verified that typed and legacy commands converge on the adapter-backed handlers, futures commands remain rejected, and `LIMIT/GTC`, renderer payloads, `10/3/10` refresh weights, sequential refresh isolation, and the renderer's `0.999` quantity reduction remain unchanged.
- [x] Verified listen-key weight `1`, RateLimiter's two active-renderer retries at exact `1000ms` / `2000ms` delays, outer user-data retries at `3s` / `6s` / `9s` / `12s` / `15s`, exact five-second reconnects, prior-socket nulling and teardown ordering, interval clearing, `safeDisconnect`, and zero-renderer guards.
- [x] Added service coverage proving that a listen-key POST which fails with `ECONNRESET` cannot retry after final-renderer teardown while its exact `1000ms` RateLimiter delay is pending. No second adapter/POST call, socket, handlers, keep-alive, renewal, reconnect, or false success/failure log can appear at the boundary or after later five-second and 30-minute advances.
- [x] Passed the Phase 4 completion matrix: service `9/9` at both normal and ambient `LOG_LEVEL=error` invocation, adapter `21/21`, RateLimiter `20/20`, shuffled non-isolated service+adapter `30/30`, full suite `223 passed / 2 skipped`, lint, and build.

Deferred general hardening (not Phase 4 acceptance blockers):

- Renderer-generation cancellation after final teardown and a new session is a separate lifecycle policy; current guards and replacement ordering preserve the Phase 4 ownership contract.
- Cross-generation out-of-order user-data socket resolution is the highest-priority deferred lifecycle risk because a stale generation could overwrite newer shared socket state; it requires explicit generation/attempt ownership rather than an adapter-boundary change.
- Queued renderer-scoped account-refresh REST work can consume rate-limit weight after teardown, but disconnected renderer delivery is already suppressed; cancellation is later efficiency hardening.
- Renewal retry/exhaustion policy deserves exact service-boundary coverage, while current per-attempt ownership checks, weight `1`, and RateLimiter delays already preserve Phase 4 behavior.
- Higher-risk trading and market-subscription orchestration should gain broader end-to-end service coverage before those flows are changed; current UI, validation, adapter, and channel-manager contracts establish Phase 4 acceptance.

## Phase 5: Futures Read-Only Mode

Goal: add futures data without allowing futures execution yet.

Add a futures adapter for read-only endpoints and streams:

- exchange info and futures filters;
- mark price;
- index price;
- funding rate/countdown;
- positions;
- margin balance;
- unrealized PnL;
- liquidation price;
- open futures orders.

Progress:

- [x] Define the first futures-only domain contract and add an isolated read-only `FuturesTradingAdapter` exchange-metadata/filter normalization seam.
- [x] Add isolated USDⓈ-M mark-price/index-price normalization behind the injected read-only futures transport.
- [x] Add isolated current USDⓈ-M funding-rate/countdown normalization from the premium-index source.
- [x] Add isolated USDⓈ-M V3 position-risk normalization behind the injected read-only futures transport.
- [x] Add isolated USDⓈ-M V3 account-balance normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M current-open-order normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M current-algo-open-order normalization behind the injected read-only futures transport.
- [x] Add isolated identifier-scoped USDⓈ-M algo-order query normalization behind the injected read-only futures transport.
- [x] Add isolated identifier-scoped USDⓈ-M regular-order query normalization behind the injected read-only futures transport.
- [x] Add isolated identifier-scoped USDⓈ-M current-open regular-order query normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M regular-order history normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M algo-order history normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M account-trade history normalization behind the injected read-only futures transport.
- [x] Add isolated symbol-scoped USDⓈ-M income-history normalization behind the injected read-only futures transport.
- [x] Compose the minimum current-state contracts through a fixed, explicitly read-only mock/testnet transport and service boundary.
- [x] Add the versioned futures-only renderer protocol, lifecycle ownership, and deterministic mock/public-stream coverage.
- [x] Add the minimal spot/futures mode affordance and compact read-only position/risk panel with no futures execution controls.

First checkpoint contract:

```js
{
  marketType: "futures",
  symbol,
  pair,
  contractType,
  status,
  assets: { base, quote, margin },
  filters: {
    price: { min, max, tickSize } | null,
    quantity: { min, max, stepSize } | null,
    marketQuantity: { min, max, stepSize } | null,
    minimumNotional: string | null
  },
  supportedOrderTypes: string[],
  supportedTimeInForce: string[]
}
```

First checkpoint rules and audit:

- The contract is a distinct futures instrument entity (`marketType: "futures"`) and preserves `symbol` and `pair` independently for perpetual and dated contracts.
- Binance USDⓈ-M `PRICE_FILTER`, `LOT_SIZE`, `MARKET_LOT_SIZE`, and `MIN_NOTIONAL.notional` values remain exact strings; `pricePrecision` and `quantityPrecision` are not substituted for tick or step size.
- Filter lookup is independent of response order. Missing recognized filters remain `null`, unknown filters are ignored, and duplicate or malformed recognized filters fail with a deterministic normalization error.
- The requested symbol is selected from the endpoint's multi-symbol response. Missing symbols, invalid symbol identity, and malformed response shapes have stable error codes; transport and response-body errors propagate unchanged.
- The adapter accepts only an injected read-only transport and instantiates no futures client. It exposes exchange metadata only and has no placement, cancellation, leverage, or margin-mode methods.
- No futures adapter import, client composition, Electron startup, renderer state, or visible UI wiring was added. `SpotTradingAdapter`, its payloads/weights/timing, and the renderer's `0.999` quantity reduction remain unchanged.
- Backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`; futures execution remains disabled.
- Validation passed: futures adapter `25/25`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `46/46`, full suite `248 passed / 2 skipped`, lint, and build.

Second checkpoint contract:

```js
{
  marketType: "futures",
  symbol,
  markPrice: string,
  indexPrice: string,
  estimatedSettlePrice: string,
  time: number
}
```

Second checkpoint rules and audit:

- The contract follows the current official USDⓈ-M `GET /fapi/v1/premiumIndex` fields and accepts its documented single-object and multi-symbol array response variants.
- `markPrice`, `indexPrice`, and `estimatedSettlePrice` remain the exact source strings, including trailing zeroes; `time` remains the endpoint's non-negative safe-integer observation timestamp.
- Requested-symbol selection is exact and case-sensitive. A wrong-symbol object, empty array, or array without the requested symbol raises the established unavailable-symbol identity; malformed identities, required price fields, timestamps, and duplicate requested-symbol entries raise a stable mark-price normalization error.
- The pure normalizer does not mutate or return its source object. Raw payloads and official-client-style async response bodies are supported, while transport and response-body errors propagate unchanged by identity.
- Although the official endpoint also returns funding fields, `lastFundingRate`, `interestRate`, and `nextFundingTime` are intentionally excluded until the separate funding/countdown checkpoint.
- The only adapter surface added is read-only `getMarkPrice(symbol)` over the injected transport. No futures client, service import, Electron/renderer wiring, WebSocket, account state, or execution method was added.
- Spot code and behavior remain unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Validation passed: futures adapter `49/49`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `70/70`, full suite `272 passed / 2 skipped`, lint, and build.

Third checkpoint contract:

```js
{
  marketType: "futures",
  symbol,
  lastFundingRate: string,
  interestRate: string,
  nextFundingTime: number,
  time: number
}
```

Third checkpoint rules and audit:

- The current funding source is the official USDⓈ-M `GET /fapi/v1/premiumIndex` mark-price and funding-rate endpoint. `GET /fapi/v1/fundingRate` is ascending funding history, and `GET /fapi/v1/fundingInfo` is adjustment metadata; both remain outside this checkpoint.
- The normalizer accepts the premium-index endpoint's documented single-object and multi-symbol array variants. `lastFundingRate` and `interestRate` remain exact source strings, including signs and trailing zeroes; `nextFundingTime` and observation `time` remain non-negative safe-integer millisecond timestamps.
- Binance exposes no countdown scalar in this response. The pure contract preserves both timestamps so a later consumer can derive a countdown without consulting wall-clock time during normalization.
- Requested-symbol selection remains exact and case-sensitive. Wrong-symbol objects, empty arrays, and arrays without the requested symbol raise the established unavailable-symbol identity; malformed identities or required fields and duplicate requested-symbol entries raise a stable funding-state normalization error.
- The pure normalizer does not mutate or return its source object. Raw payloads and official-client-style async response bodies are supported, while transport and response-body errors propagate unchanged by identity.
- The only adapter surface added is read-only `getFundingState(symbol)`, which reuses the injected premium-index `getMarkPrice({ symbol })` transport. The completed exchange-info and mark/index-price normalizers and contracts remain unchanged.
- No futures client, service import, Electron/renderer wiring, WebSocket, account state, funding history, or execution method was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Validation passed: futures adapter `82/82`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `103/103`, full suite `305 passed / 2 skipped`, lint, and build.

Fourth checkpoint contract:

```js
{
  marketType: "futures",
  symbol,
  positionSide,
  positionAmt: string,
  entryPrice: string,
  breakEvenPrice: string,
  markPrice: string,
  unRealizedProfit: string,
  liquidationPrice: string,
  isolatedMargin: string,
  notional: string,
  marginAsset: string,
  isolatedWallet: string,
  initialMargin: string,
  maintMargin: string,
  positionInitialMargin: string,
  openOrderInitialMargin: string,
  adl: number,
  updateTime: number
}
```

Fourth checkpoint rules and audit:

- The source is the current official USDⓈ-M Position Information V3 endpoint, signed `GET /fapi/v3/positionRisk`. V2 is still documented but announced for deprecation as a different contract; its `marginType`, `isAutoAddMargin`, `leverage`, and `maxNotionalValue` fields are not borrowed into V3 normalization.
- V3's documented raw response is always an array and includes only symbols with positions or open orders. The adapter calls only the version-explicit injected `getPositionRiskV3({ symbol })` transport; an empty or missing-symbol response remains unavailable and never becomes a synthetic zero position.
- Position identity is the exact, case-sensitive `(symbol, positionSide)` pair. Callers must request `BOTH` for one-way mode or `LONG` / `SHORT` for hedge mode; sides are never inferred or aggregated from signed `positionAmt` values.
- A same-symbol `LONG` and `SHORT` pair is valid, and normalizer policy accepts a single hedge-side identity without requiring its counterpart. Missing requested sides have a stable unavailable-side identity, duplicate composite identities and account-wide mixed `BOTH`/hedge identities are malformed, and invalid requested sides have a stable invalid-side identity.
- All documented position, price, PnL, notional, wallet, and margin decimals remain exact non-empty strings. `adl` and `updateTime` remain non-negative safe integers; normalizer policy accepts `updateTime: 0`. Binance's `bidNotional` and `askNotional` fields are excluded because the endpoint marks them “ignore.”
- The pure normalizer does not mutate or return a source entry. Raw arrays and official-client-style async response bodies are supported, while transport and response-body errors propagate unchanged by identity.
- The only adapter surface added is read-only `getPositionRisk(symbol, positionSide)`. The completed exchange-info, mark/index-price, and current-funding contracts remain unchanged, and no generic futures account state, client composition, service/renderer wiring, WebSocket, balance, open-order, or execution surface was added.
- Spot behavior remains unchanged, backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`, and no dependency was added.
- Validation passed: futures adapter `145/145`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `166/166`, full suite `368 passed / 2 skipped`, lint, and build.

Fifth checkpoint contract:

```js
{
  marketType: "futures",
  accountAlias,
  asset,
  balance: string,
  crossWalletBalance: string,
  crossUnPnl: string,
  availableBalance: string,
  maxWithdrawAmount: string,
  marginAvailable: boolean,
  updateTime: number
}
```

Fifth checkpoint rules and audit:

- The source is the current official USDⓈ-M Futures Account Balance V3 endpoint, signed `GET /fapi/v3/balance` with request weight `5`. V3 is deliberately version-pinned; V2 remains separately visible but was announced for replacement/deprecation without a final retirement date, and V1 is unsupported.
- The documented response is always an account-wide array and has no asset request parameter. The adapter calls only the version-explicit injected `getBalanceV3()` transport with no arguments, then selects one explicitly requested margin asset locally.
- Margin-asset identity is exact and case-sensitive. An empty array, missing asset, or case mismatch raises a stable unavailable-asset identity; invalid requested assets have a stable invalid-asset identity; malformed candidate identities and duplicate asset identities anywhere in the array raise a stable account-balance normalization error.
- Candidate identities and global duplicates validate before selection, while complete field validation applies to the selected asset entry only. Response order and undocumented cross-row account-alias consistency are not assumed.
- `balance`, `crossWalletBalance`, `crossUnPnl`, `availableBalance`, and `maxWithdrawAmount` remain exact non-empty strings, including signs and trailing zeroes. `accountAlias` remains an exact non-empty string, `marginAvailable` remains a boolean with `false` valid, and `updateTime` remains a non-negative safe integer with zero accepted by normalizer policy.
- The pure normalizer does not mutate or return a source entry, and unknown fields are excluded. Raw arrays and established official-client-style async `response.data()` bodies are supported, while transport and response-body errors propagate unchanged by identity.
- The only adapter surface added is read-only `getAccountBalance(marginAsset)`. The completed exchange-info, mark/index-price, current-funding, and position-risk contracts remain unchanged, and balances are not merged with positions or a generic account-state framework.
- No futures client, service import, Electron/renderer wiring, WebSocket, open-order, or execution surface was added. Spot behavior remains unchanged, backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`, and no dependency was added.
- Validation passed: futures adapter `188/188`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `209/209`, full suite `411 passed / 2 skipped`, lint, and build.

Sixth checkpoint contract:

```js
[
  {
    marketType: "futures",
    avgPrice: string,
    clientOrderId: string,
    cumQuote: string,
    executedQty: string,
    orderId: number,
    origQty: string,
    origType: string,
    price: string,
    reduceOnly: boolean,
    side: string,
    positionSide: string,
    status: string,
    stopPrice: string,
    closePosition: boolean,
    symbol: string,
    time: number,
    timeInForce: string,
    type: string,
    activatePrice: string | null,
    priceRate: string | null,
    updateTime: number,
    workingType: string,
    priceProtect: boolean,
    priceMatch: string,
    selfTradePreventionMode: string,
    goodTillDate: number
  }
]
```

Sixth checkpoint rules and audit:

- The source is the current official USDⓈ-M Current All Open Orders endpoint, signed `GET /fapi/v1/openOrders`. Its IP request weight is `1` with one symbol and `40` when `symbol` is omitted; the adapter validates a non-empty requested symbol before calling only the injected `getOpenOrders({ symbol })` transport, so this checkpoint has no account-wide request path.
- The documented response is an array. A valid empty array returns a fresh empty result; non-empty results preserve source order and require every entry to have the exact, case-sensitive requested symbol. An all-wrong or case-mismatched response raises the established unavailable-symbol identity, while mixed-symbol responses and malformed candidate identities raise the stable open-orders normalization error.
- `orderId` is symbol-scoped and `clientOrderId` is unique among current open orders. A duplicate of either identity is malformed; entries are never sorted, merged, aggregated, or deduplicated by choosing one source row.
- `avgPrice`, `cumQuote`, `executedQty`, `origQty`, `price`, and `stopPrice` remain exact non-empty strings. The currently documented trailing-only `activatePrice` and `priceRate` fields remain exact strings when present and normalize independently to `null` when absent; their presence does not trigger, infer, or merge a separate algo-order read.
- `clientOrderId` and all documented enum-like fields remain exact non-empty strings. `orderId`, `time`, `updateTime`, and `goodTillDate` remain non-negative safe integers, including documented `goodTillDate: 0`; `reduceOnly`, `closePosition`, and `priceProtect` remain booleans with both values preserved. Unknown fields are excluded.
- The pure normalizer does not mutate or return its source array or entries. Raw arrays and established official-client-style async `response.data()` bodies are supported, while transport and response-body errors propagate unchanged by identity.
- Current regular orders remain separate from the official signed `GET /fapi/v1/openAlgoOrders` contract for conditional, TP/SL, and trailing-stop algo orders. This checkpoint adds neither an algo transport nor order-history/query behavior.
- The only adapter surface added is read-only `getOpenOrders(symbol)`. The completed exchange-info, mark/index-price, current-funding, position-risk, and account-balance contracts remain unchanged, and orders are not merged with balances, positions, or a generic account-state framework.
- No futures client, service import, Electron/renderer wiring, WebSocket, execution method, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Validation passed: futures adapter `263/263`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `284/284`, full suite `486 passed / 2 skipped`, lint, and build.

Seventh checkpoint contract:

```js
[
  {
    marketType: "futures",
    algoId: number,
    clientAlgoId: string,
    algoType: string,
    orderType: string,
    symbol: string,
    side: string,
    positionSide: string,
    timeInForce: string,
    quantity: string,
    algoStatus: string,
    actualOrderId: string,
    actualPrice: string,
    triggerPrice: string,
    price: string,
    icebergQuantity: string | null,
    tpTriggerPrice: string,
    tpPrice: string,
    slTriggerPrice: string,
    slPrice: string,
    tpOrderType: string,
    selfTradePreventionMode: string,
    workingType: string,
    priceMatch: string,
    closePosition: boolean,
    priceProtect: boolean,
    reduceOnly: boolean,
    createTime: number,
    updateTime: number,
    triggerTime: number,
    goodTillDate: number
  }
]
```

Seventh checkpoint rules and audit:

- The source is the current official USDⓈ-M Current All Algo Open Orders endpoint, signed `GET /fapi/v1/openAlgoOrders`. Its IP request weight is `1` with one symbol and `40` when `symbol` is omitted; the adapter validates a non-empty requested symbol before calling only the injected `getOpenAlgoOrders({ symbol })` transport, so this checkpoint has no account-wide request path.
- The documented response is an array. A valid empty array returns a fresh empty result; non-empty results preserve source order and require every entry to have the exact, case-sensitive requested symbol. An all-wrong or case-mismatched response raises the established unavailable-symbol identity, while mixed-symbol responses and malformed candidate identities raise the stable algo-open-orders normalization error.
- `algoId` and `clientAlgoId` remain independent exact identities. A duplicate of either identity is malformed; entries are never sorted, merged, aggregated, or silently deduplicated.
- `quantity`, `actualPrice`, `triggerPrice`, `price`, `tpTriggerPrice`, `tpPrice`, `slTriggerPrice`, and `slPrice` remain exact non-empty strings, including trailing zeroes. The current official open-algo response does not document `activatePrice`, `callbackRate`, or `priceRate`; unknown fields remain excluded rather than being borrowed from new-algo, query-algo, or regular-order contracts.
- `clientAlgoId` and the documented enum-like fields remain exact strings. The documented empty `actualOrderId` and `tpOrderType` values remain empty strings rather than synthetic nulls. Binance's generated connector fixture uses JSON `null` for `icebergQuantity` while the rendered response example shows the literal string `"null"`; the normalizer preserves JSON null, decimal strings, and the literal string independently without coercion.
- `algoId`, `createTime`, `updateTime`, `triggerTime`, and `goodTillDate` remain non-negative safe integers, including documented zero trigger/good-till timestamps; `closePosition`, `priceProtect`, and `reduceOnly` remain booleans with both values preserved. Unknown fields are excluded.
- The pure normalizer does not mutate or return its source array or entries. Raw arrays and established official-client-style async `response.data()` bodies are supported, while transport and response-body errors propagate unchanged by identity.
- Current algo orders remain separate from regular signed `GET /fapi/v1/openOrders` results. The adapter neither calls the regular transport for algo orders nor converts `algoId` / `clientAlgoId` into regular `orderId` / `clientOrderId` identities.
- The only adapter surface added is read-only `getAlgoOpenOrders(symbol)`. The completed exchange-info, mark/index-price, current-funding, position-risk, account-balance, and regular-current-open-order contracts remain unchanged.
- No futures client, service import, Electron/renderer wiring, WebSocket, history/query, account-wide read, execution method, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Validation passed: futures adapter `362/362`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `383/383`, full suite `585 passed / 2 skipped`, lint, and build.

Eighth checkpoint contract:

```js
{
  marketType: "futures",
  algoId: number,
  clientAlgoId: string,
  algoType: string,
  orderType: string,
  symbol: string,
  side: string,
  positionSide: string,
  timeInForce: string,
  quantity: string,
  algoStatus: string,
  actualOrderId: string,
  actualPrice: string,
  actualType?: string,
  actualQty?: string,
  triggerPrice: string,
  price: string,
  icebergQuantity: string | null,
  tpOrderType: string,
  selfTradePreventionMode: string,
  workingType: string,
  priceMatch: string,
  closePosition: boolean,
  priceProtect: boolean,
  reduceOnly: boolean,
  createTime: number,
  updateTime: number,
  triggerTime: number,
  goodTillDate: number
}
```

Eighth checkpoint rules and audit:

- The source is the current official USDⓈ-M Query Algo Order endpoint, signed `GET /fapi/v1/algoOrder` with IP request weight `1`. The endpoint accepts `algoId` or `clientAlgoId` but no symbol parameter; the adapter deliberately applies a stricter exactly-one lookup invariant, retains the expected symbol as a local response guard, and calls only injected `queryAlgoOrder({ algoId })` or `queryAlgoOrder({ clientAlgoId })`.
- Both adapter entry and pure normalization require a non-empty expected symbol plus exactly one non-negative safe-integer `algoId` or non-empty `clientAlgoId`. Neither, both, invalid identities, and invalid symbols fail deterministically before transport use; unknown lookup keys, the expected symbol, `recvWindow`, and fallback hints never cross the transport boundary.
- The documented response is one object, never an array. Response symbol matching is exact and case-sensitive, and the returned lookup field must equal the requested identifier without canonicalization. Wrong symbols retain the established unavailable-symbol identity, lookup disagreement has a dedicated stable identity, and malformed response identities or fields have a dedicated algo-order normalization identity.
- The query contract adds conditionally present `actualType` (after trigger) and `actualQty` (after partial/full fill) while omitting the current-open-algo array's TP/SL price quartet. Each conditional field remains absent when omitted and remains an exact non-empty string when present; their presence is independent and never inferred from status or from each other. Unknown open-array, trailing, and regular-order fields are excluded.
- `quantity`, `actualPrice`, optional `actualQty`, `triggerPrice`, and `price` remain exact non-empty strings, including lexical scale. `clientAlgoId` and enum-like values remain exact strings, and the documented empty `actualOrderId` and `tpOrderType` values remain empty strings rather than synthetic nulls. Official artifacts disagree between JSON `null` and the literal string `"null"` for `icebergQuantity`, so both representations and decimal strings remain distinct and uncoerced.
- `algoId`, `createTime`, `updateTime`, `triggerTime`, and `goodTillDate` remain non-negative safe integers, including zero; negative `algoId` rejection is an established adapter hardening invariant because Binance describes it as a self-incrementing identifier but publishes no formal minimum. `closePosition`, `priceProtect`, and `reduceOnly` remain booleans with both values preserved.
- The pure normalizer does not mutate or return its source object. Raw objects and established official-client-style async `response.data()` bodies are supported, while transport and response-body errors propagate unchanged by identity.
- Queried algo orders remain strictly separate from regular current-open arrays and current algo-open arrays. The adapter never calls either list transport as a fallback, never borrows their response shapes, and never converts algo identities into regular-order identities.
- The only adapter surface added is read-only `getAlgoOrder(expectedSymbol, lookupIdentity)`. All seven completed futures contracts remain unchanged, and no balances, positions, or orders are merged into a generic account-state framework.
- No futures client, service import, Electron/renderer wiring, WebSocket, history, account-wide read, execution method, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Validation passed: futures adapter `522/522`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `543/543`, full suite `745 passed / 2 skipped`, lint, and build.

Ninth checkpoint contract:

```js
{
  marketType: "futures",
  avgPrice: string,
  clientOrderId: string,
  cumQuote: string,
  executedQty: string,
  orderId: number,
  origQty: string,
  origType: string,
  price: string,
  reduceOnly: boolean,
  side: string,
  positionSide: string,
  status: string,
  stopPrice: string,
  closePosition: boolean,
  symbol: string,
  time: number,
  timeInForce: string,
  type: string,
  activatePrice?: string,
  priceRate?: string,
  updateTime: number,
  workingType: string,
  priceProtect: boolean,
  priceMatch: string,
  selfTradePreventionMode: string,
  goodTillDate: number
}
```

Ninth checkpoint rules and audit:

- The source is the current official USDⓈ-M Query Order endpoint, signed `GET /fapi/v1/order` with IP request weight `1`. It requires `symbol` and either `orderId` or `origClientOrderId`; the adapter validates a non-empty exact symbol and an effective lookup identity before calling only the injected `queryOrder` transport.
- The current rendered REST contract does not state XOR semantics or which identifier wins when both are supplied. Current Binance-generated Python and Java SDKs accept and serialize both, while Binance's first-party hand-written futures connector selects `orderId` and omits `origClientOrderId`; the adapter freezes that deterministic client-side precedence by presence rather than copying the algo query's exactly-one rule or the connector's truthiness bug.
- A present `orderId` must be a non-negative safe integer and takes precedence even at zero. An invalid present `orderId` fails instead of falling back to a valid client identity; a valid selected `orderId` strips any unselected client value. Otherwise `origClientOrderId` must be a non-empty exact string. Unknown keys, `recvWindow`, fallback hints, and the unselected identity never cross the transport boundary.
- The exact requested symbol is sent with only the selected identity. Response symbol matching remains exact and case-sensitive; returned `orderId` must match an order-ID lookup, while returned `clientOrderId` must match an `origClientOrderId` lookup without canonicalization. Symbol unavailability, lookup disagreement, invalid lookups, and malformed response fields have distinct stable identities.
- The documented response is one object, never an array. This checkpoint follows the current rendered 26-field response, including `priceMatch`, `selfTradePreventionMode`, and `goodTillDate`; the current generated response models still expose only the older 23-field shape, so their omission is treated as stale schema evidence rather than a reason to drop live documented fields.
- `avgPrice`, `cumQuote`, `executedQty`, `origQty`, `price`, and `stopPrice` remain exact non-empty strings. The live contract documents `activatePrice` and `priceRate` as strings returned only for `TRAILING_STOP_MARKET`; each remains independently absent when omitted and exact when present, and explicit null is rejected because the endpoint does not document either field as nullable.
- `clientOrderId` and enum-like values remain exact non-empty strings. `orderId`, `time`, `updateTime`, and `goodTillDate` remain non-negative safe integers, including zero; `reduceOnly`, `closePosition`, and `priceProtect` remain booleans with both values preserved. Unknown regular/algo fields are excluded.
- The pure normalizer does not mutate or return its source object. Raw objects and established official-client-style async `response.data()` bodies are supported, while transport and response-body errors propagate unchanged by identity.
- Queried regular orders remain strictly separate from regular current-open arrays, current algo-open arrays, and identifier-scoped algo-order queries. The adapter never calls a list or algo transport as fallback and does not reuse an array normalizer merely because fields overlap.
- The only adapter surface added is read-only `getOrder(symbol, lookupIdentity)`. All eight completed futures contracts remain unchanged; no history, current-open single-order query, account-wide read, client/service/renderer wiring, WebSocket, execution method, or dependency was added.
- Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`. An independent review found no requirement gaps.
- GitNexus pre-edit upstream impact was `LOW`: one direct test-file dependent, zero affected processes, and zero affected modules; constructor impact was zero. The pre-commit staged `detect_changes` audit reported `MEDIUM` across `3 files / 34 symbols / 2 existing exchange-info flows`. After reindexing, the exact checkpoint comparison against `d430dd8` reported `HIGH` across `3 files / 30 symbols / 7 flows`: three are the new normalizer's internal error/string/record paths, while four are existing shared-helper/exchange/algo paths attributed through the expanded file/class. Exact post-index upstream impact for `FuturesTradingAdapter`, `getOrder`, and `normalizeFuturesOrder` remained `LOW`, each with only the focused test file as one direct dependent and zero affected processes or modules. The post-index comparison against `main` reported `CRITICAL` across `41 files / 526 symbols / 89 flows`; that scope is the audited cumulative long-running hardening branch, not this isolated checkpoint, and the full regression matrix passed.
- Validation passed: futures adapter `697/697`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `718/718` with seed `20260711`, full suite `920 passed / 2 skipped`, lint, build, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, and build emitted only the existing large-chunk advisory; no dependency or bundle-policy change was made.

Tenth checkpoint contract:

```js
{
  marketType: "futures",
  avgPrice: string,
  clientOrderId: string,
  cumQuote: string,
  executedQty: string,
  orderId: number,
  origQty: string,
  origType: string,
  price: string,
  reduceOnly: boolean,
  side: string,
  positionSide: string,
  status: string,
  stopPrice: string,
  closePosition: boolean,
  symbol: string,
  time: number,
  timeInForce: string,
  type: string,
  activatePrice?: string,
  priceRate?: string,
  updateTime: number,
  workingType: string,
  priceProtect: boolean,
  priceMatch: string,
  selfTradePreventionMode: string,
  goodTillDate: number
}
```

Tenth checkpoint rules and audit:

- The source is the current official USDⓈ-M Query Current Open Order endpoint, signed `GET /fapi/v1/openOrder` with IP request weight `1`. It requires `symbol` and either `orderId` or `origClientOrderId`; a filled or cancelled order returns `-2013 NO_SUCH_ORDER` / `Order does not exist.` rather than an empty result.
- The rendered REST contract still does not state XOR semantics or server precedence when both identifiers are supplied. Binance's current generated Python SDK accepts and serializes both, while its first-party hand-written futures connector selects `orderId` and omits `origClientOrderId`; the adapter freezes deterministic order-ID precedence by presence, including zero, without copying the connector's truthiness bug.
- A present `orderId` must be a non-negative safe integer. An invalid present value fails instead of falling back to a client identity; otherwise `origClientOrderId` must be a non-empty exact string. The adapter sends the exact requested symbol with only the selected identity, so unknown keys, `recvWindow`, account-wide hints, fallback hints, and the unselected identity never cross the transport boundary.
- The response is exactly one object. Symbol agreement is exact and case-sensitive, and returned `orderId` or `clientOrderId` must equal the selected request identity without canonicalization. Invalid lookups, unavailable symbols, mismatched identities, and malformed response fields have endpoint-specific stable identities.
- The current rendered response contains the same 26 documented fields modeled above. `activatePrice` and `priceRate` are strings returned only for `TRAILING_STOP_MARKET`; each remains independently absent when omitted and exact when present. The endpoint documents no nullable response field, so explicit null is not coerced into absence or a string.
- `avgPrice`, `cumQuote`, `executedQty`, `origQty`, `price`, and `stopPrice` remain exact non-empty strings. `clientOrderId` and enum-like values remain exact non-empty strings; `orderId`, `time`, `updateTime`, and `goodTillDate` remain non-negative safe integers including zero; `reduceOnly`, `closePosition`, and `priceProtect` remain booleans. Unknown fields are excluded.
- `normalizeFuturesCurrentOpenOrder` is a dedicated pure single-object normalizer. It does not call or reuse the broader `GET /fapi/v1/order` normalizer or either current-open array normalizer, and it does not mutate or return its source object.
- Raw response objects and established official-client-style async `response.data()` bodies are supported. Transport and response-body failures propagate unchanged by identity, including the official filled/cancelled `Order does not exist.` failure; no empty result, fallback request, list request, or broader order query is attempted.
- The only adapter surface added is read-only `getCurrentOpenOrder(symbol, lookupIdentity)` over injected `queryCurrentOpenOrder`. All nine completed futures contracts remain unchanged, and the five regular/algo query and current-open transports remain independent.
- No futures client, service import, Electron/renderer wiring, WebSocket, history, account-wide read, execution method, UI, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Two independent reviews found no requirement, contract, isolation, or substantive test gap. GitNexus pre-edit upstream impact was `LOW`: one direct focused-test dependent, zero affected processes, and zero affected modules; no pre-edit HIGH or CRITICAL finding existed. The pre-commit working-diff audit was `MEDIUM` across `3 files / 35 symbols / 2` existing exchange-info flows attributed through the expanded adapter file. Comparison against `main` was `CRITICAL` across `41 files / 526 symbols / 89 flows`; that is the audited cumulative long-running hardening branch rather than this isolated checkpoint.
- Validation passed: futures adapter `874/874`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `895/895` with seed `20260711`, full suite `1097 passed / 2 skipped`, lint, build, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, and build emitted only the existing large-chunk advisory; no dependency or bundle-policy change was made.

Eleventh checkpoint contract:

```js
[
  {
    marketType: "futures",
    avgPrice: string,
    clientOrderId: string,
    cumQuote: string,
    executedQty: string,
    orderId: number,
    origQty: string,
    origType: string,
    price: string,
    reduceOnly: boolean,
    side: string,
    positionSide: string,
    status: string,
    stopPrice: string,
    closePosition: boolean,
    symbol: string,
    time: number,
    timeInForce: string,
    type: string,
    activatePrice?: string,
    priceRate?: string,
    updateTime: number,
    workingType: string,
    priceProtect: boolean,
    priceMatch: string,
    selfTradePreventionMode: string,
    goodTillDate: number
  }
]
```

Eleventh checkpoint rules and audit:

- The source is the current official USDⓈ-M All Orders endpoint, signed `GET /fapi/v1/allOrders` with IP request weight `5`. `symbol` is required; `orderId`, `startTime`, `endTime`, and `limit` are optional endpoint parameters, while `recvWindow` remains deliberately outside this adapter contract.
- Binance's live rendered contract says `limit` defaults to `500`, while current generated connector metadata still says `100`; both say the maximum is `1000`. The adapter relies on neither implicit default: it always sends an explicit locally frozen `limit`, defaulting to the live value `500` and accepting only safe integers from `1` through `1000`.
- `getOrderHistory(symbol, bounds = {})` exposes one bounded policy over only injected `getAllOrders`: default `{ symbol, limit }`, cursor `{ symbol, orderId, limit }`, or window `{ symbol, startTime, endTime, limit }`. `orderId` must be a non-negative safe integer; time bounds must be supplied as a pair, be non-negative safe integers with `startTime <= endTime`, and span strictly less than `604800000` milliseconds. Cursor and time-window modes cannot mix because Binance does not document their interaction.
- The adapter sends only the exact requested symbol plus the normalized cursor/window keys and explicit limit. Unknown keys, a caller-supplied symbol override, `recvWindow`, `timestamp`, account-wide flags, fallback hints, and unselected bounds never cross the transport boundary; invalid selected bounds fail before transport use.
- Without `orderId`, Binance says the most recent orders are returned, and the default query period is the recent seven days. Binance does not document one-sided time defaults, time-bound inclusivity, or response sort direction, so the adapter rejects one-sided bounds and the normalizer preserves wire order without sorting or enforcing monotonic IDs.
- Binance documents two retention exclusions: unfilled `CANCELED` or `EXPIRED` orders become unavailable after three days, and all orders become unavailable after 90 days. The documented response is an array; a retained valid empty array returns a fresh empty result without lookup, current-open, or algo fallback.
- Every non-empty response entry must have the exact, case-sensitive requested symbol. All-wrong or case-mismatched responses use the established unavailable-symbol identity, while mixed symbols, malformed identities, fields, or duplicate symbol-scoped `orderId` values use the endpoint-specific malformed-history identity.
- `clientOrderId` remains an exact non-empty string but is unique only among open orders under Binance's New Order contract. Historical reuse with different `orderId` values is therefore preserved as separate source-ordered rows; the normalizer never merges, drops, chooses a winner, or rejects a row merely because its client ID repeats.
- `avgPrice`, `cumQuote`, `executedQty`, `origQty`, `price`, and `stopPrice` remain exact non-empty strings. `clientOrderId` and enum-like values remain exact non-empty strings; `orderId`, `time`, `updateTime`, and `goodTillDate` remain non-negative safe integers including zero; `reduceOnly`, `closePosition`, and `priceProtect` remain booleans.
- The live contract documents `activatePrice` and `priceRate` only for `TRAILING_STOP_MARKET`. Each stays independently absent when omitted and remains an exact non-empty string when present; no response field is live-documented as wire-nullable, so explicit null is rejected rather than coerced. Unknown regular/algo fields such as `cumQty`, `pair`, `algoId`, and `clientAlgoId` are excluded.
- `normalizeFuturesOrderHistory` is a dedicated pure history-array normalizer. It does not call or reuse the regular current-open array, current-open single-object, broader regular-order query, or algo normalizers, does not mutate or return source entries, and returns fresh detached entries on repeated calls.
- Raw arrays and established official-client-style async `response.data()` bodies are supported. Transport and response-body failures propagate unchanged by identity, and no broader query, current-open list, algo query/list/history, or account-wide fallback is attempted for empty, unavailable, or malformed history.
- The only adapter surface added is read-only `getOrderHistory(symbol, bounds)`. The injected endpoint transport remains `getAllOrders`; `FuturesTradingAdapter` itself exposes no generic `getAllOrders`, algo history, placement, cancellation, leverage, margin-mode, or other execution method. All ten completed futures contracts remain unchanged and the six regular/algo order transports remain independent.
- No futures client, service import, Electron/renderer wiring, WebSocket, account-state merge, UI, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Two independent reviews found no remaining contract, request-isolation, duplicate-identity, error-identity, immutability, transport-independence, or substantive test gap after the mandatory bug audit. GitNexus pre-edit upstream impact was `LOW`: one direct focused-test dependent, zero affected processes, and zero affected modules; no pre-edit HIGH or CRITICAL finding existed. The working-diff audit was `MEDIUM` across `2 files / 32 symbols / 2` existing exchange-info flows, and the complete pre-commit staged audit was `MEDIUM` across `3 files / 36 symbols / 2` existing exchange-info flows; both are conservative whole-file attribution through the expanded adapter and roadmap. Comparison against `main` was `CRITICAL` across `41 files / 545 symbols / 89 flows`; this exactly matches the audited cumulative long-running branch scope from the handoff and is not caused by this isolated checkpoint.
- Validation passed: futures adapter `1022/1022`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `1043/1043` with seed `20260711`, full suite `1245 passed / 2 skipped`, lint, build, targeted lint, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, and build emitted only the existing large-chunk advisory; no dependency or bundle-policy change was made.

Twelfth checkpoint contract:

```js
[
  {
    marketType: "futures",
    algoId: number,
    clientAlgoId: string,
    algoType: string,
    orderType: string,
    symbol: string,
    side: string,
    positionSide: string,
    timeInForce: string,
    quantity: string,
    algoStatus: string,
    actualOrderId: string,
    actualPrice: string,
    triggerPrice: string,
    price: string,
    icebergQuantity: string | null,
    tpTriggerPrice: string,
    tpPrice: string,
    slTriggerPrice: string,
    slPrice: string,
    tpOrderType: string,
    selfTradePreventionMode: string,
    workingType: string,
    priceMatch: string,
    closePosition: boolean,
    priceProtect: boolean,
    reduceOnly: boolean,
    createTime: number,
    updateTime: number,
    triggerTime: number,
    goodTillDate: number
  }
]
```

Twelfth checkpoint rules and audit:

- The source is the current official USDⓈ-M Query All Algo Orders endpoint, signed `GET /fapi/v1/allAlgoOrders` with IP request weight `5`. `symbol` is required; `algoId`, `startTime`, `endTime`, and `limit` are optional endpoint parameters, while protocol-owned `timestamp` and optional `recvWindow` remain outside this adapter contract.
- Binance's actively maintained REST reference says `limit` defaults to `500`, while the current official generated SDK method documentation still says `100`; both state a maximum of `1000`. The adapter freezes the live reference value explicitly and accepts only safe integers from `1` through `1000`, so it relies on neither server nor SDK defaults.
- `getAlgoOrderHistory(symbol, bounds = {})` exposes one bounded policy over only injected `getAllAlgoOrders`: default `{ symbol, limit }`, cursor `{ symbol, algoId, limit }`, or window `{ symbol, startTime, endTime, limit }`. `algoId` must be a non-negative safe integer and remains an inclusive cursor; time bounds must be paired non-negative safe integers with `startTime <= endTime` and a span strictly under `604800000` milliseconds. Cursor and time-window modes cannot mix because Binance does not document their interaction.
- The adapter sends only the exact requested symbol plus selected cursor/window keys and the explicit limit. Caller-supplied symbol overrides, regular `orderId`, `recvWindow`, `timestamp`, account-wide flags, fallback hints, unknown keys, and unselected bounds never cross the transport boundary; invalid selected values fail before transport use.
- Without `algoId`, Binance returns the most recent orders and defaults to the recent seven-day query period. Binance does not document response sort direction, one-sided time defaults, time-bound inclusivity, or cursor/window interaction, so the adapter rejects ambiguous one-sided/mixed modes and the normalizer preserves wire order without sorting or enforcing monotonic IDs.
- Binance excludes unfilled `CANCELED` or `EXPIRED` algo orders after three days and every algo order after 90 days. The endpoint and official generated response model define an array; a valid empty array returns a fresh empty result without current-open, single-query, regular-history, or other fallback.
- Every non-empty row must have the exact, case-sensitive requested symbol. All-wrong and case-mismatched responses use the established unavailable-symbol identity; mixed symbols, malformed identities/fields, or duplicate `algoId` values use the endpoint-specific malformed-history identity.
- Binance describes `algoId` as self-incrementing per symbol and uses it as the single-order identity and inclusive history cursor, so duplicate history IDs are malformed. `clientAlgoId` is documented as unique only among open orders; historical reuse across distinct algo IDs remains valid, source ordered, and unmerged.
- The independently reviewed 30-field history contract includes the open-array-style `tpTriggerPrice`, `tpPrice`, `slTriggerPrice`, and `slPrice` quartet. It excludes single-query-only `actualType` / `actualQty`, new-order-only trailing fields, regular-order fields, rejection-reason fields, and unknown execution/current-open fields.
- `quantity`, `actualPrice`, `triggerPrice`, `price`, and the TP/SL quartet remain exact non-empty strings. `clientAlgoId` and enum-like values remain exact strings; documented empty `actualOrderId` and `tpOrderType` remain empty strings. The official algo-status vocabulary is `NEW`, `CANCELED`, `TRIGGERING`, `TRIGGERED`, `FINISHED`, `REJECTED`, and `EXPIRED`, and values are preserved rather than remapped.
- Official artifacts still disagree on `icebergQuantity`: the live response table/example model it as a string and render the literal string `"null"`, while Binance's generated SDK fixture supplies JSON `null` and its model permits it. JSON null, decimal strings, and the literal string therefore remain distinct and uncoerced.
- `algoId`, `createTime`, `updateTime`, `triggerTime`, and `goodTillDate` remain non-negative safe integers including zero; `closePosition`, `priceProtect`, and `reduceOnly` remain booleans with both values preserved. Unknown fields are excluded.
- `normalizeFuturesAlgoOrderHistory` is a dedicated pure array normalizer. It does not call or reuse current algo-open, single algo-query, regular-history, regular current-open, or regular query normalizers; it does not mutate or return source entries and returns fresh detached results on repeated calls.
- Raw arrays and established official-client-style async `response.data()` bodies are supported. Transport and response-body failures propagate unchanged by identity, and empty/unavailable/malformed history never triggers another read.
- The only adapter surface added is read-only `getAlgoOrderHistory(symbol, bounds)`. The injected endpoint transport remains `getAllAlgoOrders`; `FuturesTradingAdapter` exposes no generic `getAllAlgoOrders`, placement, cancellation, leverage, margin-mode, or other execution method. All eleven earlier futures contracts and all seven regular/algo order transports remain independent.
- No futures client, service import, Electron/renderer wiring, WebSocket, account-state merge, UI, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Three independent reviews found no remaining implementation, contract, isolation, identity, immutability, error-propagation, or substantive test gap. GitNexus pre-edit upstream impact was `LOW`: one direct focused-test dependent and zero affected processes/modules; no pre-edit HIGH or CRITICAL finding existed. The working-diff audit was `MEDIUM` across `2 files / 35 symbols / 2` existing exchange-info flows, and the complete staged audit was `MEDIUM` across `3 files / 39 symbols / 2` existing exchange-info flows; both are conservative whole-file attribution through the expanded adapter and roadmap. Comparison against `main` was `CRITICAL` across `41 files / 568 symbols / 91 flows`; this exactly matches the audited cumulative long-running branch scope in the session handoff and is not caused by this isolated checkpoint.
- Validation passed: futures adapter `1183/1183`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `1204/1204` with seed `20260711`, full suite `1406 passed / 2 skipped`, lint, build, targeted lint, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, and build emitted only the existing large-chunk advisory; no dependency or bundle-policy change was made.

Thirteenth checkpoint contract:

```js
[
  {
    marketType: "futures",
    buyer: boolean,
    commission: string,
    commissionAsset: string,
    id: number,
    maker: boolean,
    orderId: number,
    price: string,
    qty: string,
    quoteQty: string,
    realizedPnl: string,
    side: string,
    positionSide: string,
    symbol: string,
    time: number
  }
]
```

Thirteenth checkpoint rules and audit:

- The source is the current official USDⓈ-M Account Trade List endpoint, signed `GET /fapi/v1/userTrades` with IP request weight `5`. `symbol` and signing-layer `timestamp` are required; `orderId`, `startTime`, `endTime`, `fromId`, `limit`, and `recvWindow` are optional endpoint parameters, but protocol-owned `timestamp` and `recvWindow` remain outside this adapter contract.
- Binance's actively maintained REST reference says `limit` defaults to `500`, while current generated SDK method documentation still says `100`; both state a maximum of `1000`. The adapter always sends the live value explicitly by default and accepts only safe integers from `1` through `1000`.
- `getAccountTradeHistory(symbol, bounds = {})` exposes one bounded policy over only injected `getAccountTrades`: default `{ symbol, limit }`, order-filter `{ symbol, orderId, limit }`, inclusive trade cursor `{ symbol, fromId, limit }`, or paired window `{ symbol, startTime, endTime, limit }`. IDs must be non-negative safe integers; windows must be paired non-negative safe integers with `startTime <= endTime` and may span exactly `604800000` milliseconds because this endpoint says the interval cannot be longer than seven days.
- Known selector modes cannot mix, and one-sided time bounds are rejected because Binance does not document their behavior or the interaction between `orderId`, `fromId`, and time bounds. The adapter sends only the exact requested symbol, the selected reviewed bounds, and explicit limit; caller symbol overrides, `recvWindow`, timestamp overrides, account-wide flags, fallback hints, unknown keys, and unselected bounds never cross the transport boundary.
- With no time bounds Binance returns the recent seven-day period, and only trades from the past six months are queryable. Binance does not define six months as a fixed millisecond interval, so the adapter invents no local retention cutoff and preserves a retention-driven empty response.
- The live reference does not document response sort direction, time-bound inclusivity, one-sided-time defaults, or selector precedence. Current generated SDKs label `fromId` inclusive but incorrectly call it an aggregate-trade ID; the adapter preserves the inclusive cursor evidence while the normalizer preserves wire order without sorting, local filtering, or monotonicity assumptions.
- The live page's schema heading renders the response item as an object, while its example and current generated models define an array. A valid empty array returns a fresh empty result without another page, order, position, income, balance, current-trade, or other fallback read.
- Every non-empty row must have the exact, case-sensitive requested symbol. All-wrong and case-mismatched arrays use the established unavailable-symbol identity; mixed symbols, malformed identities/fields, or duplicate symbol-scoped trade `id` values use the endpoint-specific malformed-history identity.
- Duplicate trade-ID rejection is an evidence-backed normalizer invariant: `id` is the endpoint's trade identity and inclusive symbol-scoped cursor, although Binance does not publish a formal uniqueness statement. Repeated `orderId` values across distinct trade IDs remain valid because one parent order can produce multiple partial-fill executions; rows are preserved separately and never merged or deduplicated by order ID.
- The independently reviewed response contract contains exactly `buyer`, `commission`, `commissionAsset`, `id`, `maker`, `orderId`, `price`, `qty`, `quoteQty`, `realizedPnl`, `side`, `positionSide`, `symbol`, and `time`. Modern generated JS/Python artifacts include the live `orderId` parameter, while the legacy hand-written futures connector omits it; the live endpoint reference governs this checkpoint.
- `commission`, `price`, `qty`, `quoteQty`, and `realizedPnl` remain exact non-empty strings, including signs and trailing zeroes. `commissionAsset`, `side`, and `positionSide` remain exact non-empty strings; `id`, `orderId`, and `time` remain non-negative safe integers including zero; `buyer` and `maker` remain booleans with both values preserved.
- No response field is live-documented as nullable or conditional. Missing, null, coerced, or malformed documented fields are rejected, while undocumented fields such as `marginAsset`, public-market `isRPITrade`, order fields, balance/position fields, and spot-history fields are excluded.
- `normalizeFuturesAccountTradeHistory` is a dedicated pure array normalizer. It does not call or reuse regular/algo history, current/query order, position, balance, or spot trade-history normalizers; it does not mutate or return source entries and returns fresh detached results on repeated calls.
- Raw arrays and established official-client-style async `response.data()` bodies are supported. Transport and response-body failures propagate unchanged by identity, and empty, unavailable, or malformed account-trade history triggers no fallback read.
- The only adapter surface added is read-only `getAccountTradeHistory(symbol, bounds)`. The injected endpoint transport remains `getAccountTrades`; `FuturesTradingAdapter` exposes no raw `getAccountTrades` / `accountTradeList`, placement, cancellation, leverage, margin-mode, or other execution method. All twelve earlier futures contracts and all prior transports remain independent.
- No futures client, service import, Electron/renderer wiring, WebSocket, account-state merge, UI, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Three independent reviews found no remaining implementation, requirements, isolation, identity, immutability, fallback, error-propagation, or substantive test gap after one low-severity malformed-response no-fallback coverage omission was fixed.
- GitNexus pre-edit upstream impact was `LOW`: `FuturesTradingAdapter` had one direct focused-test dependent and zero affected processes/modules, while its constructor had no upstream dependent; no pre-edit HIGH or CRITICAL finding existed. The complete working and staged diff audits were `MEDIUM` across `3 files / 41 symbols / 2` existing exchange-info flows, a conservative whole-file attribution through the expanded adapter and roadmap. The pre-index comparison against `main` was `CRITICAL` across `41 files / 590 symbols / 94 flows`; that is the audited cumulative long-running hardening branch supplied in the session handoff, not this isolated checkpoint.
- After reindexing, the exact checkpoint comparison against `2935f2d` was `HIGH` across `3 files / 31 symbols / 6 flows`; those flows are conservative same-file/shared-helper attributions through `isRecord` and existing exchange/order normalizers. Exact upstream impact for `FuturesTradingAdapter`, `getAccountTradeHistory`, and `normalizeFuturesAccountTradeHistory` remained `LOW`, each with only the focused test as one direct dependent and zero affected processes/modules, while constructor impact remained zero. The refreshed comparison against `main` was `CRITICAL` across `41 files / 612 symbols / 96 flows`, again the cumulative branch rather than this checkpoint.
- Validation passed: futures adapter `1318/1318`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `1339/1339` with seed `20260711`, full suite `1541 passed / 2 skipped`, lint, build, targeted lint, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, and build emitted only the existing large-chunk advisory; the full suite retained its existing non-failing React `act(...)` and aborted analytics-fetch diagnostics.

Fourteenth checkpoint contract:

```js
[
  {
    marketType: "futures",
    symbol: string,
    incomeType: string,
    income: string,
    asset: string,
    info: string,
    time: number,
    tranId: number,
    tradeId: string
  }
]
```

Fourteenth checkpoint rules and audit:

- The source is the current official USDⓈ-M Get Income History endpoint, signed `GET /fapi/v1/income` with IP request weight `30`. Upstream `symbol`, `incomeType`, `startTime`, `endTime`, `page`, `limit`, and `recvWindow` are optional, while signing-layer `timestamp` is required; this adapter contract deliberately owns neither `recvWindow` nor timestamp overrides.
- `symbol` is optional upstream and account-wide examples contain rows with an empty symbol. `getIncomeHistory` nevertheless requires one exact non-empty symbol and always sends it, exposing no account-wide read.
- The current income-filter vocabulary is `TRANSFER`, `WELCOME_BONUS`, `REALIZED_PNL`, `FUNDING_FEE`, `COMMISSION`, `INSURANCE_CLEAR`, `REFERRAL_KICKBACK`, `COMMISSION_REBATE`, `API_REBATE`, `CONTEST_REWARD`, `CROSS_COLLATERAL_TRANSFER`, `OPTIONS_PREMIUM_FEE`, `OPTIONS_SETTLE_PROFIT`, `INTERNAL_TRANSFER`, `AUTO_EXCHANGE`, `DELIVERED_SETTELMENT` (the official spelling), `COIN_SWAP_DEPOSIT`, `COIN_SWAP_WITHDRAW`, `POSITION_LIMIT_INCREASE_FEE`, `STRATEGY_UMFUTURES_TRANSFER`, `FEE_RETURN`, and `BFUSD_REWARD`. The adapter accepts only these exact values as request filters but preserves any non-empty response income type so a newly returned type is not remapped or discarded.
- Binance's legacy hand-written Python connector still documents only the oldest six filters and blindly forwards arbitrary keyword arguments. The current live reference, generated JS/Python SDKs, and official Postman artifact govern instead; the adapter neither inherits the stale six-value list nor the connector's unknown-key pass-through.
- The live reference and generated SDKs agree that `limit` defaults to `100` and is capped at `1000`. The adapter sends an explicit safe-integer limit from `1` through `1000` and defaults to `100`.
- Binance exposes an optional `page` but no cursor, continuation metadata, documented page base/default, or page/time interaction. This checkpoint freezes one fixed first-page read by always sending `page: 1`, rejects every caller-controlled page, and performs no automatic or fallback pagination.
- `getIncomeHistory(symbol, bounds = {})` supports the explicit default `{ symbol, page: 1, limit: 100 }` plus an optional reviewed income-type filter and/or a paired inclusive time window. Caller symbol overrides, `recvWindow`, timestamp overrides, account-wide flags, cursors, transaction/trade IDs, fallback hints, and unknown keys never cross the transport boundary.
- The live endpoint marks `startTime` and `endTime` inclusive, says omitted bounds return the recent seven days, and retains only the last three months. It does not currently publish a maximum query span or one-sided-bound behavior, so the adapter rejects one-sided bounds and freezes a conservative local maximum of exactly seven days over paired non-negative safe integers with `startTime <= endTime`. Three-month retention is not converted into a fixed local millisecond cutoff.
- Binance does not document response ordering. The normalizer preserves wire order without sorting, time filtering, or monotonic transaction assumptions.
- The live schema renderer labels the response item as an object, while the live example and current generated response containers define a top-level array. The array contract governs; a valid empty array returns a fresh empty result without another page, trade, order, position, balance, or other fallback read.
- Every non-empty symbol-scoped response must contain only the exact, case-sensitive requested symbol. All-wrong, case-mismatched, or account-wide empty-symbol arrays use the established unavailable-symbol identity; mixed exact/wrong or exact/empty rows use the endpoint-specific malformed-history identity. This is an adapter isolation invariant rather than a claim that Binance documents response-symbol case behavior.
- The independently reviewed response contains exactly `symbol`, `incomeType`, `income`, `asset`, `info`, `time`, `tranId`, and `tradeId`. `income` remains an exact decimal string; symbol, type, asset, information, and trade identifiers remain lexical; `time` and `tranId` remain non-negative safe integers including zero.
- The current live and generated artifacts type `tranId` as int64 and `tradeId` as string, resolving older examples that rendered both identifiers lexically. No identifier or timestamp is coerced.
- The live example explicitly uses empty `symbol` and `tradeId` strings when those identities do not apply. An empty response symbol cannot pass this symbol-scoped contract, while an exact empty `tradeId` is preserved. `info` is schema-constrained only as a string, so exact empty information is also preserved. Missing, null, non-string, and whitespace-only documented string fields remain malformed; generated all-optional model annotations are treated as code-generation laxness rather than evidence of wire nullability.
- Binance states, with the source typo `trandId`, that a transaction ID is unique within one `incomeType` for a user. Duplicate identity is therefore the collision-safe composite `(incomeType, tranId)`: a repeated pair is malformed, while the same transaction ID across different income types remains valid. Generated SDK fixtures exercise that cross-type repetition. `tradeId` has no documented uniqueness guarantee and may repeat across distinct income rows.
- `normalizeFuturesIncomeHistory` is a dedicated pure array normalizer. It does not call or reuse account-trade, regular/algo order-history, order-query/current-open, position, balance, or spot-history normalizers; it does not mutate or return source entries and returns fresh detached results on repeated calls.
- Raw arrays and established official-client-style async `response.data()` bodies are supported. Transport and response-body failures propagate unchanged by identity, and empty, unavailable, or malformed income history triggers no fallback or subsequent page.
- The only adapter surface added is read-only `getIncomeHistory(symbol, bounds)` over injected `getIncomeHistory`. The adapter exposes no raw account-wide income API, generic pagination, placement, cancellation, leverage, margin-mode, or other execution method. All thirteen earlier futures contracts and transports remain independent and unchanged.
- No futures client, service import, Electron/renderer wiring, WebSocket, account-state merge, UI, or dependency was added. Spot behavior remains unchanged, and backend validation still rejects non-spot typed trading commands with `UNSUPPORTED_MARKET_TYPE`.
- Three independent bug, requirements, and isolation audits found no remaining implementation, contract, identity, immutability, error-propagation, fallback, pagination, or isolation defect after one HIGH empty-`info` preservation gap was reported and fixed. The focused suite increased from `1318` to `1468` cases with the prior baseline retained.
- GitNexus pre-edit upstream impact was `LOW`: `FuturesTradingAdapter` had one direct focused-test dependent and zero affected processes/modules, while constructor impact was zero; no pre-edit HIGH or CRITICAL finding existed. The new normalizer did not exist in the exact pre-edit index and is therefore reserved for the mandatory post-index impact audit.
- The complete working-diff audit was `MEDIUM` across `3 files / 44 symbols / 2` existing exchange-info flows, a conservative whole-file/shared-helper attribution through the expanded adapter and roadmap. Comparison against `main` was `CRITICAL` across `41 files / 612 symbols / 96 flows`; this is the audited cumulative long-running hardening branch supplied in the session handoff rather than the isolated income checkpoint. The circular-import audit found no cycles.
- After reindexing, the exact checkpoint comparison against `18de418` was `HIGH` across `3 files / 33 symbols / 6 flows`; all six are conservative same-file/shared-helper attributions through `isRecord` and pre-existing exchange/order normalizers. Exact upstream impact for `FuturesTradingAdapter`, `getIncomeHistory`, and `normalizeFuturesIncomeHistory` remained `LOW`, each with only the focused test as one direct dependent and zero affected processes/modules. The refreshed comparison against `main` was `CRITICAL` across `41 files / 636 symbols / 98 flows`, again the cumulative branch rather than this checkpoint, and the post-index circular-import audit found no cycles.
- Validation passed: futures adapter `1468/1468`, spot adapter `21/21`, futures-command rejection suite `10/10`, shuffled non-isolated futures+spot `1489/1489` with seed `20260711`, full suite `1691 passed / 2 skipped`, lint, targeted lint, build, and `git diff --check`. Lint emitted only the existing stale `baseline-browser-mapping` data notice, build emitted only the existing large-chunk advisory, and the full suite retained its existing non-failing React `act(...)` and aborted analytics-fetch diagnostics.

Phase 5 exit audit (2026-07-12):

- Runtime composition is deliberately narrow. `FUTURES_READ_MODE` selects `mock` (the safe default) or explicitly configured `testnet`; mock scenarios cover one-way, hedge, empty, and failure state, while the E2E entry forces the deterministic `one-way` scenario and deletes inherited futures credentials. Testnet requires separate `FUTURES_TESTNET_API_KEY` / `FUTURES_TESTNET_API_SECRET` values. Main-process startup consumes and deletes those secrets before any `BrowserWindow` is created and exposes only the non-secret resolved `mock` / `testnet` label to the renderer.
- The E2E build contract now always emits `dist-electron/main.js`, the filename Playwright and `package.json` actually launch. The audit caught that the prior E2E entry emitted `main.e2e.js` and could therefore leave Playwright opening a stale production main bundle; one diagnostic reproduction connected the stale production spot public stream and attempted (but failed) the spot user-stream setup before the defect was isolated. Every final E2E run launches the freshly built credential-free mock entry, and no futures production endpoint or futures real-account call is wired or performed.
- The frozen transport facade still has exactly seven operations: `getExchangeInfo`, `getMarkPrice`, `getPositionRiskV3`, `getBalanceV3`, `getOpenOrders`, `getOpenAlgoOrders`, and `subscribeMarkPrice`. It has no base-URL override, generic request/client access, endpoint name, arbitrary options, placement, modification, cancellation, leverage, position-mode, margin-mode, transfer, or other write method. The service wires only the first seven current-state adapter contracts; identifier queries and all histories remain isolated and on demand.
- The exact REST plan is `GET /fapi/v1/exchangeInfo` at weight `1` once with conservative retry until first success, symbol-scoped `GET /fapi/v1/premiumIndex` at weight `1` for the initial mark/index/funding snapshot, symbol-scoped signed `GET /fapi/v3/positionRisk` at weight `5`, signed `GET /fapi/v3/balance` at weight `5` followed by exact local `USDT` selection because upstream offers no asset filter, symbol-scoped signed `GET /fapi/v1/openOrders` at weight `1`, and symbol-scoped signed `GET /fapi/v1/openAlgoOrders` at weight `1`. The four signed current-account reads poll every `15s`; no history or identifier query is automatically polled.
- The live market lifecycle uses only the public `<symbol>@markPrice@1s` stream in addition to REST snapshots. It preserves `p`, `i`, `P`, `r`, `E`, and `T`; REST supplies the funding interest-rate field when available. Signed REST snapshots are the smallest reliable source for current positions, margin, and both open-order families, so Phase 5 deliberately creates no listen key and no user-data stream. The deterministic mock stream emits the same typed event every second with clock-derived observation time and the next strict eight-hour funding boundary.
- Lifecycle ownership is explicit at renderer, service-session, resource-read, and stream-attempt levels. Reads have child `AbortController`s, a `10s` deadline, and per-resource non-overlap; final renderer teardown aborts queued/in-flight work, clears every poll/retry/watchdog timer, closes the public socket, and suppresses late generations. Stream handshake and silence deadlines are `10s` and `5s`; reconnect backoff is `1s`, `2s`, then capped at `5s` and resets only after a valid event. Dynamic data becomes stale after `30s` with `5s` checks. HTTP `418`, `429`, and Binance `-1003` pause polling for a fixed conservative `120s` before recovery.
- The shared production limiter retains its established `800` weight/minute and `500ms` spacing policy, but admission, spacing, and weight reservation are now atomic under concurrent callers. Admitted operations remain independent, so one slow read does not suppress unrelated resources. Each resource retains its exact internal transport/body error while renderer snapshots contain only fixed safe status/error codes.
- Current official Binance product General Information, modified `2026-07-10`, governs fixed testnet hosts: `https://demo-fapi.binance.com` and `wss://demo-fstream.binance.com`. Signed GETs place reviewed parameters, `recvWindow=5000`, and a fresh safe-integer `timestamp` in the query, append the HMAC-SHA256 signature, and send the API key only in `X-MBX-APIKEY`. HTTP success-with-Binance-error bodies, `4xx`, rate-limit `418` / `429`, `5xx`, JSON/body errors, and network failures remain distinguishable internally.
- The current official generated JavaScript connector artifact is `@binance/derivatives-trading-usds-futures` `26.0.2` and identifies its generated OpenAPI document as `1.0.0`. Its README exposes a generic client, arbitrary base-path configuration, retries, proxy/agent options, WebSocket API actions, and user streams, and its testnet guidance still links the generic `testnet.binancefuture.com` surface. Those capabilities exceed this read-only boundary, so no SDK dependency or lockfile change was made. The current product General Information demo hosts take precedence over that README discrepancy, and neither host is caller-overridable.
- The renderer boundary is protocol version `1`, `marketType: "futures"`, and channel `futures-readonly`. Subscribe/unsubscribe messages accept only exact versioned fields and never accept endpoint names or transport options. Snapshots preserve decimal strings and safe identifiers/timestamps, require the configured environment, and revalidate nested futures identity and exact symbol/USDT ownership before state is accepted. `DataContext` explicitly ignores this channel, so futures delivery cannot touch spot account state, caches, symbols, or channel health.
- The visible surface is only one `Spot` / `Futures · MOCK|TESTNET` switch and one compact `USDⓈ-M READ ONLY` panel for mark/index/funding countdown, filters, positions/PnL/liquidation, USDT margin, and regular/algo open-order counts. Loading, empty, unavailable, stale, disconnected, partial, and error states retain truthful absence or prior stale data without synthesizing balances or positions. The futures branch unmounts all spot order/cancel/chart/account affordances and disables global quick-switch shortcuts; returning to spot restores the established typed `LIMIT` / `GTC`, cancel flow, and exact `0.999` quantity reduction.
- Backend safety is independent of renderer state. Typed non-spot commands remain rejected with `UNSUPPORTED_MARKET_TYPE`; legacy buy/sell/cancel validation now reconciles both outer-envelope and nested `marketType`, preventing an outer futures declaration from being dropped, and explicit futures identities on legacy spot channel actions are rejected. Integration tests prove zero spot-adapter execution for those attempts.
- Three independent read-only audits covered implementation/bugs and lifecycle, requirements/documentation contracts, and isolation/security/UI/execution rejection. Two HIGH defects—non-atomic rate-limit admission and unbounded/non-abortable REST work—were fixed. All substantive MEDIUM/LOW findings were also fixed: stream connect/silence recovery, premature backoff reset, metadata recovery, rate-ban handling, recurring/current mock funding time, nested renderer identity, outer legacy identity, spot channel-health contamination, initial environment status, deterministic E2E scenario, signed-zero PnL tone, and spot round-trip execution guarantees.
- Final validation passed: futures adapter `1477/1477` (all `1468` prior cases retained), spot adapter `21/21`, futures-command rejection `11/11`, seeded shuffled non-isolated futures+spot `1498/1498` with seed `20260711`, focused transport `20/20`, service `18/18`, protocol `8/8`, renderer hook `14/14`, panel `10/10`, connection `13/13`, production limiter `5/5`, `DataContext` isolation `2/2`, and App spot/mode `4/4`. The full suite is `1782 passed / 2 skipped`; Playwright E2E is `12/12`. Full and targeted lint, production and E2E builds, and `git diff --check` pass.
- Known non-failing diagnostics remain: the stale `baseline-browser-mapping` notice; the established React `act(...)` and aborted analytics-fetch messages; the intentional limiter retry diagnostic in its cancellation test; and Vite's large-chunk advisory. Playwright's development runner also retains its existing Node `module.register()` deprecation, `NO_COLOR` / `FORCE_COLOR`, Electron development CSP, and debugger-shutdown notices; no Phase 5 credential or production futures network call is involved.
- GitNexus pre-edit impact was LOW for `FuturesTradingAdapter`, `setupBinanceConnection`, both legacy validators, `AppShell`, `handleSocketUpdate`, and the existing futures current-state methods. The shared `RateLimiter.waitForCapacity`, `enforceDelay`, and `execute` methods were CRITICAL because five spot/account-refresh processes depend on them; that warning was reported before the backward-compatible optional-abort and atomic-admission changes. `handleRequest` was also CRITICAL but was deliberately not edited. The final pre-stage working audit was CRITICAL across `13 tracked files / 65 indexed symbols / 69 flows`, a conservative whole-file/line-shift attribution that includes unchanged `handleRequest` and shared limiter flows. The final staged audit was likewise CRITICAL across `28 files / 68 then-indexed symbols / 69 flows`; newly added symbols were absent from graph attribution until reindexing.
- After reindexing the completed source checkpoint, the exact comparison against Phase 5 base `93cb435d19972d11627760abdf6e3fcb3b5ecf0b` was CRITICAL across `28 files / 506 symbols / 123 affected execution flows`. The cumulative branch comparison against `main` was CRITICAL across `58 files / 1116 symbols / 165 affected execution flows`. Exact upstream impacts, recorded as `risk: impacted/direct/processes/modules`, were `createFuturesReadOnlyTransport` LOW `7/4/0/1`, `resolveFuturesReadOnlyTransportConfig` LOW `8/3/0/1`, `createFuturesReadOnlyService` LOW `4/1/0/1`, `useFuturesReadOnly` LOW `1/1/0/0`, `FuturesReadOnlyPanel` LOW `1/1/0/0`, `normalizeFuturesPositionRisks` LOW `1/1/0/0`, `parseFuturesReadOnlyRequest` HIGH `11/6/3/3`, `createFuturesReadOnlyResponse` CRITICAL `27/4/14/1`, `parseFuturesReadOnlyResponse` CRITICAL `13/1/14/1`, `MarketModeSwitch` LOW `4/1/2/2`, and `RateLimiter.reserve` CRITICAL `10/1/5/2`. The HIGH/CRITICAL results identify the deliberately central typed protocol and shared rate-admission boundaries; their complete dependent regression matrix passed. Both pre-amend and post-index circular-import audits found zero cycles.

Phase status: **Complete (2026-07-12).**

UI surface should be minimal:

- one small market-mode indicator/switch;
- futures read-only position strip/panel;
- no futures order submit controls yet.

Acceptance:

- Futures read-only can run on testnet or mock data.
- Spot UI remains unchanged when market mode is spot.
- No visible futures execution controls.

## Phase 6: Futures Testnet Execution

Goal: enable the smallest testnet-only futures order path without weakening the completed read-only, Spot, protocol, lifecycle, credential, or production-exclusion boundaries.

The accepted, testnet-grade architecture decision is in [Phase 6 Testnet Futures Execution Design](./futures_phase6_testnet_execution_design.md). It is the normative implementation contract; this roadmap records the exit decisions and next boundary.

### Phase 6 accepted decision

Phase 6 supports only a regular USDⓈ-M Futures Testnet `LIMIT/GTC` order that reduces an existing one-way isolated position:

- fixed `https://demo-fapi.binance.com` REST origin;
- one-way account mode, `positionSide: "BOTH"`, and `reduceOnly: true`;
- side opposite the current signed non-zero position and quantity no greater than it;
- no current regular or algo open order for the symbol;
- observed `ISOLATED` margin and observed leverage asserted, never changed;
- mandatory backend allowlist, exact-decimal filters, configured max-notional capped by a non-raiseable 10,000-USDT ceiling, hard 3x leverage ceiling, and minimum 1000-bps liquidation distance;
- `workingType: null` and `priceProtect: false`, both omitted from the regular New Order transport because they are not applicable to this order;
- deterministic `clientOrderId === "cc6-" + requestId` and durable idempotency;
- no automatic order POST retry after dispatch under any outcome.

This subset is safer than an exposure-increasing order because checkpoint one intentionally has no cancellation path. Hedge mode is rejected because Binance prohibits sending `reduceOnly` in hedge mode. Opening orders, hedge reductions, cancellation, modification, conditional/algo orders, leverage/margin/position-mode changes, transfers, and every other write require separate reviews.

The Phase 5 facade stays frozen. Phase 6 consists of:

- `FuturesTestnetExecutionRiskReader`, a separate exact read-only testnet preflight boundary for server time, exchange metadata including `PERCENT_PRICE`, mark, account configuration, symbol configuration, V3 position, V3 balance, and current regular/algo orders;
- `FuturesTestnetExecutionFacade`, exposing only `placeReduceOnlyLimitGtcOrder(args)` and `queryOrderByOriginalClientOrderId(args)`;
- one process-global `FuturesTestnetExecutionService`, owning the gate, sessions/generations, exact validation, cross-process ownership, integrity-anchored journal, state machine, reconciliation/open-order monitoring, rate admission, and safe acknowledgements.

No generic SDK client, endpoint name, method, raw options, base override, request passthrough, production host, or additional write method may be exposed.

The 2026-07-13 implementation amendment makes production separation structural: Phase 6 has only the compiled demo host, testnet credential capture, dedicated execution protocol, and isolated packaged/dev/E2E testnet storage namespaces. Production composition, credentials, protocol, host selection, storage, and recovery must be separately implemented and reviewed rather than added as a mode. All execution configuration and credential values are captured and deleted before the first `BrowserWindow`; E2E scrubs them and forces execution off. The original raw WebSocket frame reaches the duplicate-aware execution parser under the 4096-byte command cap, while the outer route bounds frames and connection channel count. Backend recovery is Query Order-only, never renderer-callable, and never resends the POST; the exact operator procedure is recorded in ADR section 10.6.

### Feature gate and trust boundary

Execution remains disabled unless every backend-owned condition passes at dispatch:

- existing `FUTURES_READ_MODE` is exactly `testnet`;
- future `FUTURES_TESTNET_EXECUTION_ENABLED` is exactly the ASCII text `true`, with no trimming/coercion;
- fixed demo transport and successful fresh signed testnet-account preflight;
- main-only captured credentials and every new execution config value, already frozen/deleted from inherited environment before `BrowserWindow`;
- exact 1–16-symbol comma-separated allowlist grammar, canonical max-notional and positive available-balance caps, leverage cap from 1 through 3, and liquidation-distance floor of at least 1000 bps;
- completed renderer sandbox/preload/CSP/navigation hardening and Electron single-instance plus exclusive journal ownership;
- exact versioned command, current owned session, and the same execution generation/account/symbol; exchange metadata no older than 300 seconds, account/symbol configuration no older than 30 seconds, mark/position/balance/open-order/server-time risk data no older than five seconds, and dispatch no more than one second after final validation;
- one-way/single-asset/can-trade account, isolated/no-auto-add symbol, matching observed leverage, empty symbol orders, correct reduction, available margin state, and exact backend risk validation;
- validated HMAC/rollback-anchored fsync-capable journal, no concurrent/accepted-open command, no unresolved unknown across credential rotation, and no active persisted rate pause/ban.

Mock, production-like configuration, production-only credentials, renderer market mode, or renderer capability state can never enable the route. Credential strings have no reliable environment marker; a signed demo read proves authenticated testnet access but not API-key TRADE permission, and no production origin exists. Disabled/mock/no-session mode starts no new execution readers/timers/network unless a durable nonterminal record requires recovery-only monitoring.

### Typed protocol and acknowledgements

The strict action is `futures.execution.placeOrder`, version `1`, on the dedicated `futures-execution` channel. It accepts exactly:

- backend-issued 128-bit/32-lowercase-hex one-use `requestId` bound to connection/symbol/generation for 30 seconds; never renderer/Spot `Math.random`;
- `marketType: "futures"`, `environment: "testnet"`, allowlisted symbol, and `BUY|SELL`;
- `orderType: "LIMIT"`, exact decimal-string quantity/price, `timeInForce: "GTC"`;
- `positionSide: "BOTH"`, `marginType: "ISOLATED"`, safe-integer leverage, `reduceOnly: true`;
- `workingType: null`, `priceProtect: false`;
- exact 36-character deterministic client order ID.

No risk-acknowledgement override exists; warnings are backend hard blocks. The raw command is capped at 4096 UTF-8 bytes, duplicate-key scanned before conversion, and decimals are capped at 40 total/18 fractional digits. No endpoint, URL, transport, timestamp, signature, retry, session, or account-mutation field is accepted. Financial values and order IDs remain strings; only validated safe timestamps cross the boundary.

Renderer-safe acknowledgements are exact `pending`, `accepted`, `rejected`, or `unknown` values with fixed codes, static messages, and monotonic decimal revision. Invalid commands use null identities and never echo malformed text. `accepted` requires a valid exchange response or exact query proving the order exists. `rejected` requires local rejection before intent or a confirmed exchange rejection. `unknown` is never presented as success or failure, and raw HTTP/Binance/network identity remains internal and redacted. Exact session-bound subscribe/prepare/status snapshots restore capability and the current attempt on reconnect; lower/stale revisions cannot overwrite state.

### Ambiguous-result state machine

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

The backend writes/fsyncs `queued` and then `dispatch_intent`. Intent is the exact point of no return: ownership transfers to the process before the one POST invocation, and even an intent-before-send crash is conservatively unknown. Timeout, network loss, malformed success, `408`, `-1006`, `-1007`, any `5xx`, or inability to prove rejection becomes unknown. The POST is never retried.

Reconciliation uses only signed `GET /fapi/v1/order` with exact symbol and original client order ID, a 10-second deadline, and the immediate/1/2/5/10/30-second fast schedule. Query `-2013` does not prove failure. Fast exhaustion enters reconciliation unavailable but retains a five-minute background recovery cadence through the query horizon. Every ACK is queried, and `NEW`/`PARTIALLY_FILLED` remains process-owned and monitored every 60 seconds to a durable terminal status. The external Testnet UI is the only cancellation path. Unknown/open records survive renderer teardown, soft disable, or restart and block later writes globally.

Before intent, session teardown aborts locally. After intent, teardown is not cancellation, recovery continues without a renderer, and stale generations never deliver into a newer session. If a post-intent transition cannot fsync, no new revision/ack is emitted: the last durable pending view remains, status delivery closes, and the block/repair continue until unknown can itself be durably recorded. No unpersisted terminal result is acknowledged.

The journal is not considered renderer-inaccessible under a Node-enabled window, so renderer sandboxing remains a hard prerequisite. The store uses separate packaged/development namespaces while E2E is execution-disabled and opens no journal. Electron single-instance plus exclusive regular-file/no-symlink ownership, a main-only `safeStorage` integrity key, sealed latest-hash anchor, length-framed sequence/HMAC records, SHA-256 fixed-field command digests, complete non-secret command snapshots, file and directory fsync, and fail-closed corruption/rollback handling protect the append-only store. Phase 6 deletes or compacts no record: permanent ID/digest/terminal-state tombstones remain in the bounded 50,000-record/16-MiB journal, and reaching either bound fails closed. Queued-only crash records become durable local rejections; intent records become unknown. Credential mismatch never queries the wrong account or bypasses an older global unknown.

### Exact financial and transport contract

Native `BigInt` fixed-point arithmetic will parse, compare, align, multiply, subtract, and perform tick/step modulo and basis-point cross multiplication. JavaScript floating point is prohibited and no new dependency is needed.

Backend checks include symbol allowlist/status/contract/assets, `PRICE_FILTER`, `PERCENT_PRICE`, `LOT_SIZE`, `MIN_NOTIONAL`, `MAX_NUM_ORDERS`, tick, step, min/max price and quantity, exchange minimum notional, configured and symbol max notional, leverage, margin type, account/position mode, position side/direction/quantity, reduce-only semantics, open-order absence, mark/position/balance/config freshness, configured positive available-balance buffer, and exact liquidation distance. Official percent price is side-specific; Phase 6 intentionally enforces the opposite bound too as a stricter local band. Official zero min/max bounds are disabled, but zero tick or non-positive LOT_SIZE metadata fails closed. The local path intentionally enforces minimum notional even though Binance documents a reduce-only exemption.

The POST facade sends only canonical `symbol, side, type=LIMIT, timeInForce=GTC, quantity, price, positionSide=BOTH, reduceOnly=true, newClientOrderId, newOrderRespType=ACK, recvWindow=5000, timestamp, signature`. It uses `X-MBX-APIKEY`, HMAC-SHA256 over the exact transmitted pre-signature form serialization, `redirect: "error"`, exact origin/path checks, no proxy/agent/dispatcher/caller overrides, a 10-second whole-operation deadline, 64-KiB body and exact header/message bounds, and zero write retries. Every Phase 6 GET uses a process-global coordinator with a separate fixed-demo-origin quota bucket, Spot waiter priority, and `maxRetries: 0`; the unchanged CRITICAL Spot limiter remains behind its own origin bucket. The full 25-weight preflight reads mark exactly once and last, begins only with no Spot waiter, reserves its complete demo capacity, and preserves 23-weight Spot headroom. Placement consumes one unit on each order-count window and zero IP weight; the app further limits placement to one per 10 seconds, five per minute, and one nonterminal command, with counters persisted from intent records. Conservative persisted `418`/`429` pauses survive restart; missing/malformed headers close admission rather than assuming capacity.

### Official documentation and SDK review

The 2026-07-12 review used public official sources only; no authenticated or account call was made:

- Product General Information continues to define demo REST/stream hosts, signed timing, `recvWindow`, API-key header, rate-limit/ban, timeout, and unknown 503 behavior.
- Current regular New Order is signed `POST /fapi/v1/order`, with one unit on both order-count windows and zero IP weight; `LIMIT` requires TIF, quantity, and price. Current Query Order is signed `GET /fapi/v1/order`, IP weight 1, with exact symbol and either order ID or original client ID. Phase 6 chooses original client ID only.
- `accountConfig` and `symbolConfig` are both weight 5 and supply the account/position mode, permission, margin type, auto-add state, leverage, and max notional omitted by V3 position. V3 position and balance are each weight 5. Change-leverage and change-margin-type are separate signed weight-1 writes with their own required fields/responses; the shared whole-account position-mode change is also weight 1. None is invoked.
- `MARK_PRICE` and `CONTRACT_PRICE` remain valid working types for current conditional/algo orders, and `priceProtect` constrains trigger divergence. They do not belong to the reviewed regular LIMIT request; current `-4120` also directs conditional orders to the Algo Order API. The live regular type enum still lists conditionals, a product-internal discrepancy resolved by accepting LIMIT only and requiring any conditional path to re-review.
- Client IDs follow `^[\.A-Z\:/a-z0-9_-]{1,36}$`; duplicate `-4116` reconciles rather than retries. Exact price/quantity filters use `(value-minimum) % increment`, precision fields are not substitutes, and the separate execution reader must add the `PERCENT_PRICE` filter omitted from Phase 5 normalization.

The current official generated JavaScript package is now `@binance/derivatives-trading-usds-futures` `32.0.0` (release commit `fdfcb2089d5145bffdeaa97074152b331c8a12f1`; generated OpenAPI `1.0.0`), newer than the historically correct Phase 5 `26.0.2` review. Its discrepancies are explicit:

- package metadata incorrectly describes this USDⓈ-M connector as COIN-M/COINN-M;
- README/common exports steer generic testnet use to `testnet.binancefuture.com` while also exporting the product-documented demo host; product General Information governs;
- generic configuration exposes production default/base overrides, proxy/agents, arbitrary capabilities, a one-second default timeout, and a default retry policy; current retries are GET/DELETE-only, but the surface is still not an acceptable write boundary;
- New Order models price/quantity as JavaScript numbers and unconstrained/general parameters;
- Query Order permits both identifiers, while its generated response omits current product fields; Symbol Configuration is actually an array despite singular presentation;
- generic error handling can discard exact Binance 5xx body identity and does not establish the required success-body validation contract.

Therefore current product documentation governs every discrepancy and no SDK dependency, lockfile change, or generic client will be added.

Primary references: [General Information](https://developers.binance.com/docs/derivatives/usds-margined-futures/general-info), [Common Definition](https://developers.binance.com/docs/derivatives/usds-margined-futures/common-definition), [Error Codes](https://developers.binance.com/docs/derivatives/usds-margined-futures/error-code), [New Order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/New-Order), [Query Order](https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Query-Order), and [official JavaScript connector](https://github.com/binance/binance-connector-js/tree/master/clients/derivatives-trading-usds-futures).

### Renderer plan

Reopened checkpoint-2 acceptance removes renderer-controlled `MOCK_WS_URL` routing from packaged builds. A token is attached only to the exact main-issued runtime host and port; E2E mock routing is explicit, isolated, tokenless, and execution-disabled. CSP lists reviewed exact endpoints, the loopback server bounds raw frames and per-connection channels, and hidden `action: "order"` / `action: "cancelOrder"` Spot aliases are absent. Production and E2E windows remain Node-disabled, context-isolated, sandboxed, and served from a root-confined internal `cc-trade://renderer/index.html` protocol. The compact ticket is labeled `USDⓈ-M TESTNET · REDUCE ONLY`, uses one dedicated hook outside `DataContext`, and displays only backend-owned capability, intent, pending, accepted, rejected, unknown, and recovery state. It has no opening, leverage, margin, reduce-only, cancel, modify, transfer, mock, or production control. Spot/global shortcuts and Enter never submit futures, and no execution data enters browser storage, analytics, telemetry, or clipboard. Spot UI, shortcuts, LIMIT/GTC, cancellation, refresh timing/weights, and exact `0.999` behavior remain unchanged.

### Integrated delivery gates

Items 3 through 7 are verification gates inside one integrated delivery, not independently shippable stopping points. The execution write action is registered only after the complete backend fake suite passes, and the delivery is accepted only after the final regression/security scans pass together.

1. Strict command/ack schemas, native exact-decimal utility, pure risk evaluator, and deterministic tests only; no route or transport.
2. [x] Renderer sandbox/preload/CSP/navigation hardening with complete Spot regression; still no route.
3. Separate exact read-only `FuturesTestnetExecutionRiskReader` plus per-origin/Spot-priority coordination and generation/tiered-freshness ownership; Phase 5 frozen.
4. Single-instance/exclusive ownership, integrity-anchored journal, status snapshots, state machine, fake-only reconciliation, and confirmed-open monitoring; register only the three reviewed read-only status/prepare actions, with no write route or POST facade.
5. Exact two-method testnet facade with fake signing/host/redirect/deadline/weight/error tests; still no route.
6. Deliberate installation of `futures.execution.placeOrder` as the only network-write action behind the complete gate; the three reviewed read-only actions remain, and generic typed plus legacy futures remain rejected.
7. Three repeated independent backend audits, then at most the compact testnet reduce-only ticket.
8. Any additional order shape/write is a separate checkpoint; Phase 7 remains separate and may not parameterize/reuse Phase 6 host, credentials, channel, protocol, or storage.

### Planned test matrix

Deterministic fake-only tests cover default-disabled and exact config grammar; credential rotation/global block; renderer sandbox and secret/redaction sinks; production/redirect exclusion; strict resource-bounded protocol, backend IDs, revisioned status, and malformed null-identity acks; exact decimal/filter/side-specific percent/notional/leverage/margin/mode/reduce/liquidation boundaries; every reader array identity and freshness-tier/server-clock case; exact URL/signature/deadline/body/header/weights and per-origin Spot-priority admission; duplicate IDs, two-process locks, journal framing/HMAC/rollback/torn and partial writes/fsync ordering, permanent replay identities, and journal capacity; queued/intent/post-intent crash cases; every HTTP/body/network ambiguity, persisted bans/counters, zero POST retry, exact fast/slow reconciliation and accepted-open monitoring through the 90-day query horizon; reconnect/teardown/stale revisions; continued generic typed/legacy rejection after the dedicated action is installed; and complete Spot/UI/storage isolation. Optional testnet smoke testing is separately authorized, manual, non-default, and excluded from CI.

### Checkpoint 1 implementation record (2026-07-12)

- [x] Added three separately named, backend-only pure modules under `electron/services` for strict command/ack schemas, native-`BigInt` fixed-point decimals, and the pure futures testnet risk evaluator. They are imported only by one another and their co-located tests; no existing runtime module imports them.
- [x] Raw commands are duplicate-key-aware, scalar-only, descriptor-safe, capped at 4096 UTF-8 bytes before expensive conversion, and exact across all 18 fields. Quantity/price retain their original canonical strings under 40-digit/18-scale/42-byte limits; the backend-format request ID, exact allowlist, fixed order literals, and deterministic client ID are mandatory.
- [x] Acknowledgements freeze the exact pending/accepted/rejected/unknown state-code-order matrix, static messages, canonical decimal revisions, lossless signed-int64 order identity, safe timestamps, and null untrusted identities for protocol rejection.
- [x] Exact-decimal operations cover scale alignment, comparison, addition/subtraction, multiplication, minimum-relative modulo, signed absolute amount, and basis-point cross multiplication without floating financial arithmetic or a dependency.
- [x] The pure evaluator enforces the full checkpoint-one exchange/filter/notional/account/mode/leverage/margin/position/reduce/order/balance/liquidation contract over explicit same-generation ownership and freshness facts. It resolves planning ambiguities fail-closed: `multiplierDecimal` must match both multiplier scales, LOT_SIZE maximum must align from its minimum, the normalized balance array must contain exactly one USDT row, and rejection precedence is fixed by deterministic multi-failure tests.
- [x] New tests pass `235/235` (`29` decimal, `98` protocol, `108` risk). Existing typed/legacy rejection plus Phase 5/Spot/renderer isolation passes `102/102`, and the frozen futures adapter passes `1477/1477`. Targeted lint passes with only the existing browser-data notice.
- [x] Three independent read-only reviews completed. Protocol/decimal fixed two MEDIUM resource/allowlist findings before PASS; risk/test completeness fixed two MEDIUM contract findings and two LOW test gaps before PASS; Phase 5/Spot/renderer/transport/credential/production isolation passed with no finding.
- [x] GitNexus pre-edit query/context and upstream impact kept all existing seams unchanged. The avoided Phase 5 protocol boundaries were HIGH `11 impacted / 6 direct / 3 processes / 3 modules` and CRITICAL `27/4/14/1`; typed validation, futures normalization, and Spot placement were LOW. Exact diff comparisons and post-index results are recorded in the final checkpoint audit.
- [x] Pre-stage GitNexus working detection was LOW across `8 files / 6 currently indexed Markdown symbols / 0 execution processes`; new JavaScript symbols await the required final reindex. The pre-stage circular-import check found zero cycles.
- [x] Complete staged scope and exact comparison with base `8c65dc70b89d85e0309adbe93d1b4a0a50d63554` were each LOW at `8 files / 6 currently indexed Markdown symbols / 0 execution processes`. Cumulative comparison with `main` was CRITICAL at `65 files / 1179 symbols / 166 processes`, inherited from the long-running Phase 1–6 branch rather than this isolated checkpoint. Post-index source attribution is recorded after the final analyze.
- [x] After source reindex, exact base comparison was CRITICAL `8 files / 262 symbols / 23 processes`; cumulative `main` was CRITICAL `65 / 1435 / 189`. Conservative same-name attribution makes the private isolated `reject` helper appear to reach unrelated renderer/Phase 5 flows despite zero imports. Exact public-boundary impacts stayed LOW for command parsing `1/1/0/0`, acknowledgement parsing `1/1/0/0`, evaluator `1/1/0/0`, and command-object validation `5/3/1/1`; the decimal parser was MEDIUM `14/6/2/1` entirely within the new module/test cluster. Post-index circular-import check found zero cycles.

### Checkpoint 2 implementation record (2026-07-12)

- [x] Packaged and E2E windows now use `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, no `webviewTag`, and a compiled preload. The renderer receives exactly one frozen `ccTradeRuntime` data object: the existing loopback host/token/token parameter, the non-secret futures-read environment label, and existing non-secret analytics settings. It receives no Node globals, Electron module, filesystem/process access, generic IPC, callbacks, or invokable capability.
- [x] The fixed preload request is main-frame-only and is served only to a registered `webContents`. The main process selects the values, preserves the existing per-session loopback token, and never puts credentials into the bridge. Existing `process.argv`/renderer `process.env` dependencies were replaced with the reviewed projection; no futures execution data or control was added.
- [x] Packaged/E2E assets load only from the root-confined internal `cc-trade://renderer/index.html` protocol, not `file:`. The protocol serves only `GET`/`HEAD` assets below the compiled `dist` root after realpath/symlink confinement and returns CSP plus `nosniff` headers. `cc-trade://renderer` is an internal scheme authority, not a network hostname, endpoint, or production origin.
- [x] The production URL ignores `VITE_DEV_SERVER_URL`; non-packaged development accepts only a credential-free loopback `http(s)` Vite URL. Navigation accepts only that exact development origin or the exact local entry; main-frame/subframe navigation, redirects, webviews, and renderer-created windows are denied otherwise.
- [x] CSP is response-header based: no inline script, object/frame/form/base escape, broad `https:` connect source, or CSP bypass privilege exists. It permits only self, reviewed loopback transports, existing font sources, and the exact configured non-secret analytics origin. The focused Electron test proves inline script, external `https://example.com` connection, external navigation, and `file:` navigation are blocked.
- [x] The local WebSocket server now accepts exactly `cc-trade://renderer` in packaged/E2E mode, or the one validated loopback development origin when development is explicitly selected. `file:`, opaque/missing, arbitrary loopback, and other custom origins reject before the unchanged per-session constant-time token check. This preserves, rather than broadens, the current loopback/session-token boundary.
- [x] The E2E storage reload helper now arms its navigation waiter before triggering reload. All E2E specs launch the fresh `dist-electron/main.js` artifact. Spot `LIMIT/GTC`, cancellation, refresh behavior, mode switching, shortcuts/Enter, appearance, and exact `0.999` quantity reduction remain unchanged.
- [x] Deterministic tests cover protocol root/symlink traversal confinement, CSP construction and external-connect denial, trusted development URL resolution, window preferences, navigation/redirect/subframe/webview/window-open blocking, preload data-only/main-frame registration, local-origin plus token admission, renderer Node isolation, and full Spot startup. Final validation passed `39` unit files / `2032` tests (`2` existing skips), full lint, production and E2E builds, and `13` Playwright E2E tests.
- [x] Required independent read-only reviews closed PASS. Initial security review found one HIGH (`file:` renderer delivery) and three MEDIUM issues (remote development URL acceptance, missing subframe/main-frame safeguards, and overly broad CSP connect source); the Spot/Phase 5/E2E review found one MEDIUM reload-wait race. All were fixed. The execution/transport/credential/checkpoint-3 isolation review found no scope leak; all three closure reviews PASS.
- [x] GitNexus query/context inventoried Electron window creation, renderer/runtime dependencies, preload/IPC, navigation/CSP, loopback routing, Spot placement, Phase 5 services/transports, rejection paths, and E2E composition. Pre-edit upstream impacts were LOW: production `createWindow` `1/1/0/0`; E2E `createWindow` one file caller/no process; `reloadWithE2eLocalStorage`, `isAllowedWebSocketOrigin`, and `validateLocalWebSocketRequest` each `0/0/0/0`. No HIGH or CRITICAL symbol was edited. Before staging, `detect_changes` working scope was LOW (`16 files / 27 symbols / 0 processes`) while staged was clean; after staging, both staged scope and exact comparison with checkpoint base `b35e9500535428ac8f1a24cabc5b698dd28ade02` were LOW (`26 files / 27 symbols / 0 processes`) and working scope was clean. Comparison with `main` was CRITICAL (`77 files / 671 symbols / 122 processes`), inherited from the long-running branch rather than this checkpoint. After source reindex, working/staged scopes were clean; exact base comparison became CRITICAL (`26 files / 154 symbols / 22 processes`) through the intended renderer-runtime/window/analytics paths, and comparison with `main` was CRITICAL (`77 / 1555 / 206`) through the inherited branch plus that source attribution. The circular-import check found `0` cycles across `132` local modules before and after reindex.

### Planning audit and GitNexus record

- Pre-edit `npx gitnexus status` was exact: repository `cc-trade`, branch `fix/long-running-stability`, indexed commit and current commit both `81ea13291e328ab57be88121236a09ee72d68034`, clean worktree.
- GitNexus query/context inventoried `createFuturesReadOnlyTransport`, `FuturesReadOnlyService`, `handleRequest`, `readResource`, `stopSession`, typed/legacy validators and routing, `SpotTradingAdapter.placeOrder`, `RateLimiter.reserve`, `useFuturesReadOnly`, `AppShell`, `DataContext`, `setupBinanceConnection`, credentials, tests, and lifecycle processes. The central read-service and protocol flows remain unchanged.
- No existing function, class, method, component, source, test, dependency, lockfile, renderer, or transport is edited by this documentation checkpoint, so no upstream symbol impact applies. Future source checkpoints must run per-symbol impact first and report HIGH/CRITICAL results.
- Three independent read-only audits completed. Safety/ambiguous/lifecycle initially found renderer-writable journal state, missing cross-process/crash/durability ownership, dispatch/status/rate contradictions, and accepted-open recovery gaps. Official-doc/SDK/test review corrected side-specific percent price, zero tick, order-count filter, exact bounds/deadlines, response identity, and missing matrices. Isolation/security/renderer/Spot review required sandbox/preload, redirect rejection, recovery-only disable, binary-downgrade guard, redaction, namespace, credential-rotation, and Phase 7 separation. Every substantive finding was fixed in both documents; all three closure reviews returned PASS, and auditors made no edits.
- Focused unchanged-boundary validation passed `50/50`: futures typed/legacy rejection `11/11`, Phase 5 protocol `8/8`, Phase 5 service `18/18`, and connection/composition `13/13`.
- Pre-commit `git diff --check` passed; no executable source/test changed, so targeted lint was not applicable. Scope is exactly the new focused design and this roadmap update; no source, test, dependency, lockfile, renderer, or transport file changed.
- Exact GitNexus results: working LOW `1 tracked file / 5 Markdown symbols / 0 processes` (the untracked new design was not graph-attributed); staged LOW `2 files / 5 Markdown symbols / 0 processes`; comparison with Phase 5 base `81ea13291e328ab57be88121236a09ee72d68034` LOW `2/5/0`; cumulative comparison with `main` CRITICAL `59 files / 1116 symbols / 165 processes`. The CRITICAL result is inherited Phase 1–5 branch scope, was reported, and does not describe this docs-only checkpoint. Pre-commit circular-import check found zero cycles.
- After indexing the new design, and repeated after the documentation amend against the final indexed commit, the exact Phase 5-base comparison was LOW `2 files / 66 indexed Markdown symbols / 0 execution processes`; the cumulative `main` comparison was CRITICAL `59 files / 1179 indexed symbols / 166 execution processes`. The increased symbol/process attribution comes from newly indexed documentation headings plus inherited branch history. Post-index circular-import checks found zero cycles.

Safety invariants:

- Phase 5 stays read-only and frozen.
- Production execution remains structurally impossible.
- Mock never executes.
- Renderer state never authorizes a write.
- No execution route exists while the renderer can access Node/filesystem/process state.
- One OS-owned app/journal lease and one integrity-anchored attempt own all Phase 6 writes across processes and credential rotation.
- Leverage and margin are assertions, never implicit writes.
- Financial validation never uses floating point.
- No POST is retried after dispatch.
- Unknown is never reported as success or failure.
- Teardown is never cancellation.
- Accepted/open and unknown attempts remain backend-monitored through soft disable/restart; incompatible binary downgrade is prohibited.
- Redirects, production origins, generic transports, and caller network options are impossible.
- Generic typed and every legacy futures command remain rejected; only the exact dedicated `futures.execution.placeOrder` action can reach the Phase 6 service after its backend test gate.
- Spot behavior and ownership remain unchanged.
- Phase 7 must use separately reviewed production composition, credentials, protocol/channel, and storage; it cannot add a production enum to Phase 6.

Phase status: **Complete (2026-07-13).**

Final integrated verification passed `57` Vitest files / `2307` tests (`2` existing skips), full ESLint, production and E2E builds, all `13` Electron Playwright scenarios, circular-import checks, static route/credential/host/write/isolation scans, and an independent adversarial closure audit. Phase 7 remains the next separately reviewed boundary; Phase 6 contains no production Futures support.

## Phase 7: Guarded Production Futures Rollout

Goal: allow real futures execution with hard limits and rollback.

The accepted architecture is in [Phase 7 Guarded Production Futures Rollout ADR](./futures_phase7_guarded_production_design.md), with its security analysis in the separate [Phase 7 Threat Model](./futures_phase7_threat_model.md). Phase 7 is one integrated delivery: the ADR, backend, durable state/audit, renderer, deterministic fake suite, and final regression/security evidence are not separately shippable stopping points.

Required production-only controls:

- [x] exact explicit operator flag and acknowledgement, plus a non-environment live-authorization interlock;
- [x] production credentials/configuration captured, sanitized, frozen, and deleted before the first `BrowserWindow`;
- [x] fixed `https://fapi.binance.com` origin and reviewed exact endpoints with redirect rejection and no caller network options;
- [x] exact signed account alias/API-key fingerprint/environment validation;
- [x] complete allowlist, account-level maximum leverage, maximum order notional, gross maximum daily notional, balance, and liquidation limits;
- [x] crash-safe exact daily reservations with deterministic UTC rollover and conservative unknown accounting;
- [x] persistent default-engaged kill switch that blocks new exposure without claiming cancellation or closure;
- [x] separate intent/action/state machines for ordinary order, regular+algo cancel-all, close-positions, kill-switch engagement, and deliberate gradual-live arming;
- [x] one-use backend intents, revision binding, mutex/idempotency tombstones, durable dispatch intent, zero order-POST retry, Query Order reconciliation, confirmed-open monitoring, and restart recovery;
- [x] separate production storage, lease, key, anchor, HMAC journal, audit schema, credential binding, counters, rate pauses, and backend-only operational recovery;
- [x] bounded redacted durable audit events for every command, gate, intent, exchange request/response classification, reconciliation, partial outcome, kill transition, and operator recovery action;
- [x] a production-origin quota bucket with fsynced request-weight reservations and exact restart replay around the existing Spot-priority coordinator, without changing the CRITICAL Spot limiter or the Phase 6 demo bucket;
- [x] a dedicated `futures-production-execution` renderer channel, hook, protocol, and unmistakable `USDⓈ-M PRODUCTION · REAL ORDERS` ticket outside `DataContext`, Spot/global shortcuts, browser storage, analytics, telemetry, clipboard, and crash reporting;
- [x] deterministic fake-only adversarial coverage plus a network-escape tripwire; no live credential, account read, order, cancellation, or close request.

The reviewed ordinary order is regular one-way isolated `LIMIT/GTC`; leverage and margin are assertions, never writes. The backend classifies opening/increasing versus reduce-only exposure. The kill switch blocks only opening/increasing exposure. Cancel-all reconciles regular and algo inventories separately; close-positions issues separately journaled reduce-only MARKET children and reports exact per-position partial/unknown results. Teardown remains teardown.

The initial fake-backed commit retained the normal/E2E live-authorization interlock as false. The separate 2026-07-14 authorization enables only normal composition; E2E remains force-disabled, automated verification remains fake-only, and manual live use still requires the trusted credential ceremony and every backend gate.

### Integrated implementation record (2026-07-13)

- [x] Production execution is a separately named backend composition, protocol/channel, credential capture, exact-host facade, coordinator origin bucket, durable store/lease/key/anchor, service, renderer hook, and ticket. Phase 5 and Phase 6 implementation files remain byte-for-byte unchanged from `36681f0`.
- [x] All ten backend activation gates are independently audited. Startup and every order/close preflight validate the signed production account identity, one-way/single-asset account mode, exact configured alias, and the unique USDT balance row before enabling a write path.
- [x] Exact-decimal risk, crash-safe daily reservations, durable request-weight reservations, default-engaged persistent kill switch, idempotent dispatch, zero POST retry, Query Order reconciliation, confirmed-open monitoring, credential-rotation blocking, and explicit backend-only recovery are integrated and restart tested.
- [x] Regular and algo cancel-all plus reduce-only close children have separate durable identities and exact per-symbol partial/unknown results. Teardown never claims cancellation or closure, and restart performs reads/reconciliation only.
- [x] Every command, gate, intent, exchange request/response, reconciliation, partial result, safety transition, and operator recovery action is written through the bounded redacted HMAC journal; corruption, rollback, torn writes, lock contention, capacity, and crash/replay paths fail closed.
- [x] Final fake-only validation passed `75` Vitest files / `2611` tests (`2` existing skips), full ESLint, production and E2E builds, all `13` Electron Playwright scenarios, the static production-boundary scan across `17` isolated implementation files, and the circular-import scan across `188` source files.
- [x] Final GitNexus source analysis indexed `5684` symbols / `13548` relationships / `300` execution flows. Exact comparison with Phase 6 commit `36681f0` is CRITICAL at `49 files / 1440 symbols / 152 flows`, matching the integrated Phase 7 boundary; cumulative comparison with `main` is CRITICAL at `154 / 3816 / 282`, including inherited Phase 1–6 history. The separate frozen-file comparison for Phase 5/6 implementation and design files is empty.
- [x] The initial Phase 7 delivery used no live credential and sent no production Futures request. Commit `eac0834d8780a14ada8e354fbb41408a84eab4dd` retained the compile-time live interlock as false pending separate authorization.

Acceptance:

- Production futures cannot be enabled accidentally.
- Real execution requires explicit configuration and a visible account/mode indicator.
- Phase 5 and Phase 6 remain structurally frozen and production-independent.
- Automated normal-build tests and E2E verification make zero production Futures network requests; E2E remains force-disabled.

### Phase 7 live authorization record (2026-07-14)

- [x] The operator explicitly authorized live production implementation and manual verification after checking Spot and testnet.
- [x] Normal production composition sets the separate non-environment live interlock true; E2E still passes `forceDisabled: true`, scrubs every production key, and terminates on a production network escape.
- [x] Live composition accepts only process-global Node `fetch`. Caller-supplied transports remain unusable; deterministic tests retain their unforgeable fake-only authorization object.
- [x] Production remains default-disabled and requires the exact flag, acknowledgement, credentials, full key fingerprint/account alias, complete caps, fixed kill-switch policy, healthy private durable storage, recovery, and every runtime gate.
- [x] Added exact backend-only startup recovery for `reconcile`, `engageKillSwitch`, and `disengageKillSwitch`. The argument contains no secret, is scrubbed before `BrowserWindow`, requires the captured recovery authorization, and is durably audited. A later reviewed gradual-live amendment adds a separately named routine UI arming path; it does not expose operational recovery or its authorization.
- [x] Added an application-level three-workspace selector without creating a backend environment enum: neutral Spot, blue Futures Testnet, and red Futures Live. Only the selected independent hook/ticket is active; Spot controls and shortcuts remain absent from both futures workspaces.
- [x] Added the live operator runbook with the required restart boundary, exact non-secret configuration inventory, default-engaged kill switch, visible account/cap checks, and fail-closed recovery rules.
- [x] Official Binance documentation was rechecked on 2026-07-14 for `https://fapi.binance.com`, signed `POST /fapi/v1/order`, `GET /fapi/v1/order`, both cancel-all endpoints, and unknown-execution semantics.
- [x] Final automated verification used no live credential and sent no production Futures request. It passed `76` Vitest files / `2622` tests (`2` existing skips), full ESLint, production and E2E builds, all `13` Electron Playwright scenarios including exact blue/red CSS assertions, the production boundary scan across `18` isolated implementation files, and the circular-import scan across `190` source files.
- [x] Final GitNexus analysis indexed `5710` nodes / `13582` edges / `338` clusters / `300` flows. The live/UI commit versus `eac0834d8780a14ada8e354fbb41408a84eab4dd` is HIGH at `15 files / 44 symbols / 7 flows`; cumulative comparison with Phase 6 `36681f0` is CRITICAL at `55 / 1464 / 154`; cumulative comparison with `main` is CRITICAL at `157 / 3834 / 282`. The Phase 5/6 implementation and Phase 6 design diff remains empty.

### Phase 7 gradual-live arming amendment (2026-07-14)

- [x] The operator explicitly approved opening production in small steps through the red UI.
- [x] Compiled production ceilings were reduced to 1x maximum leverage, 10 USDT exact maximum order notional, and 50 USDT gross maximum daily notional. Configuration may be lower and cannot exceed them.
- [x] Added distinct `prepareDisengageKillSwitchIntent` / `disengageKillSwitch` actions, intent kind, capability, exact phrase `ARM LIVE FUTURES 1X 10 USDT 50 USDT DAILY`, and terminal `kill_switch_disengaged` state. No generic Futures command or Phase 5/6 action changed.
- [x] ARM LIVE is backend-authorized, owning-connection/revision/mutex/idempotency protected, fsynced before acknowledgement, and performs no exchange request. A raw non-reduce-only order prepare is rejected while the persistent switch is engaged; exact reduce-only safety actions remain available.
- [x] Restart recovery distinguishes a crash before the durable transition (remain engaged and reject locally) from a crash after it (recover the exact disengaged state) without any exchange write.
- [x] The red ticket reports `LIVE LOCKED` versus `LIVE ARMED`, blocks new-exposure order preparation while locked, retains exact reduce-only/close/cancel safety paths, prevents Enter/double submission, and keeps ARM, order, cancel-all, close-positions, and engage controls separate.
- [x] Final fake-only validation passed `77` Vitest files / `2633` tests (`2` existing skips), full ESLint, production and E2E builds, all `13` Electron Playwright scenarios, the production boundary scan across `18` isolated implementation files, the circular-import scan across `190` source files, and `git diff --check`. No live credential was used and no production Futures request was sent.
- [x] Final GitNexus analysis indexed `2829` nodes / `8640` edges / `321` clusters / `223` flows. The uncommitted amendment is CRITICAL at `24 files / 262 symbols / 66 affected flows`; cumulative comparison with Phase 6 `36681f0` is CRITICAL at `57 / 483 / 122`; cumulative comparison with `main` is CRITICAL at `158 / 1303 / 195`. The exact frozen Phase 5/6 implementation and Phase 6 design diff remains empty.

## UI Rollout Rules

Every UI change should be reviewed as a small checkpoint:

1. Add the minimum visible affordance.
2. Verify desktop screenshot and core workflow.
3. Get user review.
4. Only then add the next control.

Suggested UI order:

1. Non-invasive account/mode status line.
2. Read-only futures position strip.
3. Futures risk metrics in a compact panel.
4. Futures order ticket in testnet.
5. Production futures controls after safety gates.

## Phase 7 Live Operations Continuation

The fake-backed Phase 7 delivery is complete and the operator has now authorized normal live composition. Continue only through explicit operational review; do not merge production into Phase 5/6 or convert their boundaries into a mode enum.

- keep every production composition, credential, configuration, action/channel, service, store/lock, audit, recovery, host, hook, and component separately named from Phase 5/6;
- run GitNexus upstream impact before editing every existing symbol and report HIGH/CRITICAL results before proceeding;
- retain the separately reviewed non-environment live authorization as a compiled normal-composition decision; never expose it through environment, renderer, generic commands, or E2E;
- keep automated verification fake-only and reject any test/E2E production network escape;
- require the trusted credential ceremony, visible backend identity/caps, initially engaged kill switch, and the exact dedicated ARM LIVE intent/phrase before intentional new exposure; backend operational recovery remains separate;
- finish with full Spot/Phase 5/Phase 6/Phase 7 unit, lint, production/E2E build, Electron Playwright, circular-import, static isolation/credential/host/write scans, and GitNexus change detection against `36681f0` and `main`;
- preserve a clean auditable commit and document that no real production request was sent by automated development or verification.

## Phase 8: USDⓈ-M Futures Trading Workstation

Goal: turn the guarded Testnet and Live execution pages into a complete Binance-class Futures trading workstation without merging their backend authority or weakening the completed Phase 5/6/7 safety boundaries.

Status: **Phase 8.0–8.2 complete and post-implementation-audited; Phase 8.3–8.7 remain planned.** The normative implementation sequence, evidence and functional parity matrix are in [Phase 8 USDⓈ-M Futures Trading Workstation Plan](./futures_phase8_trading_workstation_plan.md). The exact public-read contract and adversarial controls are frozen in the [Phase 8 ADR](./futures_phase8_workstation_adr.md), [Phase 8 threat model](./futures_phase8_workstation_threat_model.md) and [Phase 8.0–8.2 post-implementation safety audit](./futures_phase8_post_implementation_audit.md).

The first visible milestone is deliberately read-only: separate blue Testnet and red Live workspaces gain a Futures symbol selector, market header, chart, gap-detecting order book and trade tape. Expanded execution follows only after the account read model is stable, Testnet is manually verified, and each new Live action receives separate authorization.

Phase 8.0–8.2 completion record:

1. [x] Separate blue Testnet and red Production workstations now provide Futures-only discovery, exact filters/status/allowlist, complete market header, candle/volume chart, mark/index overlays, drawings/display alerts, gap-detecting snapshot-plus-diff depth and bounded aggregate trades.
2. [x] Testnet/Production containers, hooks, protocols, channels, backend services, fixtures, transports and compositions remain separately named. Shared React pieces are immutable-props presentation only; renderer code has no Binance transport, financial browser storage or capability decision.
3. [x] Explicit loading/stale/disconnected/resynchronizing/unavailable states, generation ownership, bounded queues/caches/timers/reconnects and deterministic fake clocks are covered adversarially. Phase 5/6 and Phase 7 surfaces remain explicit safety drawers.
4. [x] Final post-audit fake-only evidence passed `89` Vitest files / `2803` tests (`2` established skips), ESLint, both builds, the authenticated-renderer `npm run e:smoke` path, all `15` Electron Playwright scenarios with blue/red desktop+narrow screenshots, `233`-file circular scan and expanded production/workstation boundary scans (`38` and `31` isolated files). Operator acceptance then closed A-14 and A-15: `npm run e` is again the normal persistent Spot launch, `npm run e:safe` is persistent fake-only verification, and `npm run e:smoke` is bounded fake-only verification.
5. [x] No real Binance Futures request or Futures credential was used. Both reviewed public-read compositions remain source-pinned off, no new Live execution action was introduced, and the Phase 7 caps remain 1x / 10 USDT order / 50 USDT daily. The first pre-remediation audit smoke did contact the existing Spot production stream and is disclosed in the post-implementation audit.
6. [x] The post-implementation audit and operator follow-up closed fifteen findings across sequencing, bounds, lifecycle, schema precision, environment ownership, renderer state, verification isolation, manual-launch durability and Spot data-source integrity; residual risks and the Spot verification incident are explicitly recorded.

Start here next session:

1. Begin Phase 8.3 with a separately reviewed private account read model; do not enable a reviewed transport or private stream without explicit authorization.
2. Preserve the Phase 6 ticket and Phase 7 production safety/recovery ticket as explicit drawers until the later order composer is independently proven.
3. Continue GitNexus impact/change auditing and fake-only network tripwires for every slice.
