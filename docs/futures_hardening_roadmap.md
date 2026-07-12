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

Goal: enable futures order placement only on testnet first.

Required command fields:

- `marketType`
- `positionSide`
- `marginType`
- `leverage`
- `reduceOnly`
- `workingType`
- `priceProtect`
- `clientOrderId`

Required safety gates:

- stale mark price block;
- max leverage cap;
- max notional cap;
- reduce-only validation;
- liquidation distance warning;
- backend-side validation independent of frontend.

UI surface:

- controlled futures order ticket;
- explicit Long/Short selector;
- leverage and margin mode controls;
- reduce-only toggle;
- order preview before submit.

Acceptance:

- Testnet-only execution.
- All risky actions emit clear backend acknowledgements/rejections.
- UI changes reviewed before expanding beyond the order ticket.

## Phase 7: Guarded Production Futures Rollout

Goal: allow real futures execution with hard limits and rollback.

Required controls:

- feature flag for production futures;
- account-level max leverage;
- max order notional;
- max daily notional;
- kill switch;
- cancel-all positions/orders affordance;
- audit log for every command and response.

Acceptance:

- Production futures cannot be enabled accidentally.
- Real execution requires explicit configuration and a visible account/mode indicator.

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

## Start Here Next Session

Perform a Phase 6 planning/review checkpoint only; do not enable futures execution yet:

- re-read the completed Phase 5 exit audit and preserve its transport, protocol, lifecycle, identity, and spot-isolation boundaries;
- design the explicit testnet-only execution feature gate and backend acknowledgement/rejection protocol before adding any write endpoint;
- review position-side, margin-type, leverage, reduce-only, working-type, price-protect, client-order-id, stale-mark, max-leverage, max-notional, liquidation-distance, and rollback requirements as one safety contract;
- inventory which official current generated SDK write artifacts would be needed, but do not add a generic client, dependency, renderer order ticket, or write transport during planning;
- keep typed and legacy futures execution rejected until a separately reviewed Phase 6 implementation checkpoint authorizes the first exact testnet write.
