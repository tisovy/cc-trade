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

Phase status: **In progress; exchange-metadata, mark/index-price, current-funding, and position-risk boundary checkpoints complete (2026-07-10).**

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

Continue Phase 5 with the next narrow read-only futures boundary checkpoint:

**Add isolated USDⓈ-M account-balance normalization to `FuturesTradingAdapter`.**

Implementation entry point:

- existing `electron/services/futures-trading-adapter.js` and focused unit tests;
- current official Binance USDⓈ-M futures account-balance endpoint documentation before choosing the version or freezing fields.

Expected scope:

- Extend only the injected read-only transport boundary and add a pure balance normalizer for one explicitly requested margin asset without composing a futures client or account service.
- Preserve documented balance, wallet, PnL, available, and withdrawal decimal values as exact strings and documented timestamps as integers; define deterministic array-shape, asset-selection, missing-asset, malformed, duplicate, and transport/body-error behavior from official evidence.
- Keep the completed exchange-info, mark/index-price, current-funding, and position-risk contracts unchanged; do not merge balances with positions or add a generic futures account-state framework.
- Keep `FuturesTradingAdapter` free of order placement, cancellation, leverage, margin-mode, or other execution methods; backend futures execution must remain rejected.
- Do not wire the adapter into `binance-connection.js`, Electron startup, renderer state, WebSockets, or visible UI in this checkpoint.
- Defer open futures orders, service orchestration, testnet client composition, and the futures mode indicator/position panel to later reviewed Phase 5 checkpoints.
