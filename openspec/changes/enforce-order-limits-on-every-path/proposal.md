## Why

The audit found that the risk ceiling is enforced on one submission path and
skipped on the others, so an order can be grown past the configured cap.

- The `FUTURES_MAX_ORDER_USDT` ceiling is checked only in
  `handleFuturesOrderPlacement` (`electron/services/binance-connection.js`).
  `handleFuturesModifyOrder` performs no cap check at all, while
  `futuresTradingAdapter.modifyOrder` sends both `quantity` and `price`. With a
  cap of 200 USDT and a live 160 USDT order, editing the amount to 10 000 USDT
  reaches Binance.
- The renderer paths that produce an amendment — the order editor and the chart
  drag — apply no ceiling either, so the ceiling is absent on both sides of the
  same operation.
- The existing `futures-live-readiness` requirement already promises that a
  draft over the per-order ceiling is refused. Today that promise holds only for
  a new order.

The audit also found that the price band, percent-price and order-count filters
carried in the market contract are never evaluated locally. The operator has
decided, on 2026-08-09, **not** to add that enforcement: those filters are the
exchange's to apply, and a local copy of them is another thing to keep in sync
with Binance for no benefit the operator wants. This change therefore states
the narrower guarantee explicitly rather than leaving the specification
promising enforcement that will not exist.

## What Changes

- One shared draft-validation authority evaluates price, quantity, notional and
  the risk ceiling, and is used by the ticket, the order editor, the chart
  drag, the position closer and the backend.
- The risk ceiling applies to every path that can increase exposure: placement,
  amendment, and a limit close that is not reduce-only. An amendment is
  evaluated against its resulting notional, not its previous one.
- The backend re-validates the ceiling independently of the renderer, so the
  renderer is never the only gate.
- Local pre-validation stays confined to what makes an order submittable — the
  price tick, the quantity step and the minimum notional. `minPrice`,
  `maxPrice`, the percent-price band and the maximum open order count are
  deliberately left to the exchange, and its refusal is presented with the code
  and message Binance returned.

## Capabilities

### Modified Capabilities

- `futures-live-readiness`: the per-order ceiling covers amendments and every
  exposure-increasing path, the backend validates independently of the
  renderer, and local pre-validation is bounded to submittability.
- `futures-workstation-presentation`: the filter promise made by the instrument
  rail is narrowed to the filters the desk actually enforces.

## Impact

- Validation: `src/utils/futuresOrderDraft.js` becomes the single authority and
  gains ceiling evaluation for amendments and closes.
- Renderer: `FuturesTradingTicket`, `FuturesOrderEditor`,
  `FuturesWorkstationChart` (drag amendment), `FuturesPositionCloser`,
  `src/hooks/useFuturesTrading.js`.
- Backend: `electron/services/binance-connection.js` (`handleFuturesModifyOrder`
  and the close path gain the cap check that placement already has),
  `electron/services/trading-command-validation.js`.
- Operator documentation: `docs/futures_trading.md` states that the ceiling
  applies to amendments and that band and count filters are Binance's to
  enforce.
- Depends on `harden-trading-command-integrity` landing first: a refused
  amendment must not leave an unresolved command behind.
- Blocks live Futures.
