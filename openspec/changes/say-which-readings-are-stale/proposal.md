## Why

The audit found four places where the desk presents an unknown or stale reading
as a current one. Each of them feeds a decision about real money.

- **A balance kept across a disconnect is still treated as confirmed.** The
  disconnect branch in `src/hooks/useFuturesTrading.js:266` deliberately keeps
  the last account snapshot, and the reconnect branch sets `connected: true` as
  soon as the refresh command is *sent* (`:392`). `accountResources` still says
  `ready`, so `FuturesTradingTicket.jsx:142` sizes orders from a balance nobody
  has re-proved since before the drop.
- **A frozen mark price still reads as the market.** The stall watchdog in
  `electron/services/futures-mark-price-feed.js:136` logs a warning and does
  nothing else: it neither clears the price nor restarts the socket, and the
  renderer keeps the last value (`useFuturesTrading.js:281`). Unrealized PnL and
  position value keep updating in appearance while the input is minutes old.
- **Unknown is rendered as zero.** The portfolio dock receives bare arrays
  (`FuturesProductionWorkstation.jsx:321`), so before the first sync and after a
  failed one it prints `0 open` and `No open positions.`
  (`FuturesPortfolioDock.jsx:68`) — the same words it uses for a genuinely flat
  account.
- **A command failure can be hidden behind an account failure.** The ticket
  ranks `accountFailures` above `lastError`
  (`FuturesTradingTicket.jsx:854`), so a live rejection of the order just sent is
  displaced by a background synchronization error, and the exchange's own code
  (`details.binanceCode`) is never shown.

## What Changes

- Account readings carry their freshness. A transport drop marks the held
  snapshot as unconfirmed; it becomes confirmed again only when a refresh
  answers. Order sizing requires a confirmed balance.
- A stalled mark price is presented as stale — not as a price — and the feed
  tries to restore itself rather than only logging.
- Positions and orders reach the dock with their resource status, so
  "not yet known" and "failed" are distinguishable from "none".
- The ticket shows the outcome of the operator's own last command alongside a
  background synchronization failure, with the exchange's code when it sent one.

## Impact

- `src/hooks/useFuturesTrading.js`, `src/components/features/futures/
  FuturesTradingTicket.jsx`, `FuturesPortfolioDock.jsx`,
  `FuturesProductionWorkstation.jsx`,
  `electron/services/futures-mark-price-feed.js`.
- Behaviour change visible to the operator: sizing is blocked while the balance
  is unconfirmed after a reconnect; a stalled mark shows as stale; an empty dock
  says whether it is empty or unknown.
- Adds requirements to `futures-live-readiness`.
