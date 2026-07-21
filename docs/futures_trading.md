# Futures Trading (spot-parity path)

Date: 2026-07-21

The guarded "production execution" subsystem (13-variable env ceremony, arming
passphrases, per-order typed confirmations, kill switch, intent tokens, durable
ledger) is retired. Futures now trades exactly like Spot.

## Setup

1. Use the same `BK` / `BS` environment variables as Spot. Enable the
   **Futures** permission on that API key at binance.com (withdrawal stays
   off; keep the IP restriction if you use one).
2. Launch normally:

```sh
BK=... BS=... npm run e
```

No other configuration exists. Without `BK` the app runs in mock mode, as for
Spot.

## How it works

- Renderer sends the same typed `trade.*` commands as Spot with
  `marketType: "futures"` (`src/utils/tradingCommands.js`); the main process
  routes them to `FuturesTradingAdapter`
  (`electron/services/futures-trading-adapter.js`) — a signed
  `fapi.binance.com` REST client using the shared proxy agent and
  `recvWindow=60000` with server-time offset sync.
- Account state (`futures_balances`, `futures_orders`, `futures_positions`)
  is pushed to the renderer after every action and streamed live via the
  futures user-data stream (`ORDER_TRADE_UPDATE` → `futures_execution_update`,
  `ACCOUNT_UPDATE` → REST refresh). The stream starts lazily on first futures
  use and keeps its listenKey alive every 30 minutes.
- Both one-way and Hedge position modes are supported: the adapter reads
  `positionSide/dual` once and derives `positionSide` per order; the renderer
  never has to care.
- Orders place immediately — no confirmation ceremony. Chart/order-book
  gestures (Alt/Ctrl double-click) submit a LIMIT order at the picked price
  with the ticket's current size; Ctrl/Alt-dragging an order line cancels and
  re-places it at the new price. Positions close with a reduce-only MARKET
  order from the Positions tab.
- REST errors from Binance surface in the ticket as a rejection card
  (`FUTURES_API_ERROR` with Binance's message) instead of being silent.

## Sizing

The size slider spans your available USDT balance as order notional; the
quantity is snapped to the symbol's tick/step/min-notional filters before
sending. Binance remains the final validator.

## Optional guards

Two lightweight, ceremony-free protections (added 2026-07-21):

- **Order cap** — set `FUTURES_MAX_ORDER_USDT=<number>` in the launch
  environment to cap the notional of every exposure-increasing futures order.
  Enforced in the main process immediately before the REST call, so no UI bug
  can bypass it; a breach shows in the ticket as `FUTURES_ORDER_CAP_EXCEEDED`.
  Reduce-only orders (position closes) are always exempt. Unset = no cap.
- **Pause trading** — the `Pause trading` button in the ticket header blocks
  all new futures orders backend-side until you resume. In-memory only (an app
  restart clears it), cancels remain allowed while paused, and Ctrl/Alt order
  drags are ignored entirely so a drag can never cancel an order the paused
  backend would refuse to re-place.

## Market data

The Futures workstation (chart, order book, tape, contract catalog) is
unchanged public-data infrastructure, but its bootstrap was reworked on
2026-07-21: kline/ticker/premium reads now run concurrently with the stream
handshakes, a depth snapshot gap heals by refetching only the snapshot
(200/400/800 ms) instead of tearing down all sockets, read concurrency is 6,
and proxy socket caps were raised. Cold load ≈ max(handshake, reads) + one
depth read. Timing lines still print as
`[futures-production-workstation:timing] <phase> <ms> <outcome>`.
