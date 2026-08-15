## Why

Two halves of one habit: the desk does not listen to the whole of what the
exchange says. It drops four of the events it is sent, and it does not read
silence as an answer at all.

### Silence reaches no recovery

Every recovery the Futures workstation has hangs off a socket *closing*.
`handleDisconnect` runs the reconnect ladder, the ladder falls back to a slow
interval, the workspace says it is not carrying and offers a retry — all of it
written, implemented and covered, and all of it entered through
`onDisconnect`.

A socket that stays open while delivering nothing never enters it.
`startFreshnessMonitor` notices — it marks header, candles, depth and tape
`STALE` at three to five seconds — and marking is where it stops. Nothing
rebuilds the connection, so the requirement "A market feed keeps trying while
its contract is wanted" is never reached, and the desk sits on a dead feed
under a stale badge for as long as the operator leaves it there.

This is the failure that took the authenticated stream out for four months.
A route that answers the handshake and then says nothing raises no error and
never closes; the desk's own note on it is in `futures-mark-price-feed.js:33-39`.
The account-side mark feed is also the one place that already draws the right
conclusion: `FUTURES_MARK_PRICE_STALL_MS = 15000` (`:18`), with the reasoning
written beside it — one mark per symbol per second is the contract, so silence
that long is a feed that stopped delivering without closing. It restarts itself.
The workstation's own sockets, carrying the same `@markPrice@1s` stream, do not.

Two things make this worth fixing now rather than noting. The freshness monitor
begins `if (!this.isCurrent(session)) return;` — so a contract that is warm but
not displayed has no freshness check at all, which is the state
`keep-the-contracts-warm` is about to put seven contracts into. And depth rides
`/public` while the tape rides `/market`: two routes that can be retired
independently, and the desk currently has no way to tell that one of them went
quiet while the other kept talking.

### Seven events are dropped unread

`normalizeFuturesUserDataStreamEvent` (`futures-trading-adapter.js:485`) answers
`null` for everything that is not `ORDER_TRADE_UPDATE`, `ACCOUNT_UPDATE` or
`listenKeyExpired`. Binance's own USDⓈ-M user-data page lists ten events. Seven
of them fall through:

- **`MARGIN_CALL`** — the exchange saying a position's risk ratio is too high,
  naming each position with its mark price, unrealized PnL and the maintenance
  margin required. The desk draws a liquidation price of its own reckoning in the
  dock and says nothing when the exchange itself raises the alarm.
- **`ACCOUNT_CONFIG_UPDATE`** — `ac.s`/`ac.l`: a contract's leverage changed
  somewhere other than this desk. Until the next read the desk states the old
  one, and `compute-the-unstated-values-beside-the-read` is about to divide by
  it.
- **`ALGO_UPDATE`** — pushed when an algorithmic order is created or its status
  changes, carrying algo id, status (`NEW`, `TRIGGERING`, `TRIGGERED`,
  `FINISHED`, `REJECTED`, `EXPIRED`), trigger price, the failure reason `rm`, and
  in `o.ai` **the id of the regular order it spawned** — the same
  `actualOrderId` that `name-the-algo-order-that-fired` goes to REST for.
  `futures-order-visibility` currently states as fact that the stream does not
  report algorithmic orders, and `binance-connection.js:3104` spends a weight-40
  read after every algo command on that basis.
- **`CONDITIONAL_ORDER_TRIGGER_REJECT`** — a TP/SL that met its trigger and was
  then refused by the matching engine, with the refusal in words. This is the
  one case where the operator's stop does not become a position and nothing on
  the desk says why.
- **`TRADE_LITE`**, **`STRATEGY_UPDATE`**, **`GRID_UPDATE`** — a lighter
  duplicate of `ORDER_TRADE_UPDATE` and two events for strategies this desk does
  not run. Correctly ignored, and nowhere written down as deliberately ignored.

One thing the stream does **not** carry is a contract's margin mode.
`ACCOUNT_CONFIG_UPDATE` has room for exactly two things — a trade pair's
leverage in `ac`, and the account's Multi-Assets mode in `ai.j`, which this desk
does not use. Margin mode reaches the desk only on `ACCOUNT_UPDATE`, in each
position's `mt`, which the fold already reads — so a mode changed on a contract
the operator is flat in is not announced at all, and only a read will find it.
That is worth writing down rather than leaving the next reader to search for a
field that is not there.

## What Changes

- A workstation socket that goes quiet past a bound is treated as a
  disconnection, entering the reconnect ladder that already exists, with a
  reason that names which bound was crossed. The bound is chosen per stream by
  what the exchange guarantees: frames where a stream has an unconditional
  cadence, the connection's own traffic — frames or the exchange's protocol
  pings — where silence can be legitimate.
- The judgement is made per socket, in the transport, and does not depend on
  which contract is on screen.
- Depth silence is judged against the tape on the same contract: a book that
  says nothing while trades are printing against it is a dead book, not a quiet
  one.
- `MARGIN_CALL` is stated on the positions it names, as the exchange's own
  warning rather than as the desk's reckoning.
- `ACCOUNT_CONFIG_UPDATE` applies the leverage it carries, instead of the desk
  waiting for a read to learn what it was just told.
- `ALGO_UPDATE` is folded into the listed algorithmic orders when it arrives.
- `CONDITIONAL_ORDER_TRIGGER_REJECT` puts the exchange's refusal in front of the
  operator, on the path already built for a refusal that has words of its own.
- `TRADE_LITE`, `STRATEGY_UPDATE` and `GRID_UPDATE` are ignored under their own
  names, with the reason recorded.

## Non-goals

- **The algo read after an algo command stays.** `streamCannotReport:
  ['algoOrders']` is removed only after the operator's own run shows
  `ALGO_UPDATE` arriving on this account; nothing is taken away on the strength
  of a documentation page. The thirty-second beat stays either way, as the
  backstop it already is.
- The authenticated stream's own silence is not addressed here. It has no
  unconditional cadence to measure against, and the oracle it needs is a
  different one; that is `prove-the-private-stream-is-carrying` §2.
- No new socket, no new subscription, no additional traffic. Every bound in this
  change is measured on frames the desk already receives.

## Impact

- `electron/services/futures-production-workstation-transport.js`,
  `electron/services/futures-trading-adapter.js`,
  `electron/services/binance-connection.js`,
  `src/hooks/useFuturesTrading.js`,
  `src/components/features/futures/FuturesPortfolioDock.jsx`.
- The operator stops trading off a feed that stopped without saying so, and
  learns from the desk what the exchange has already told it — a margin call, a
  leverage change made elsewhere, an algo that moved.
- Adds two requirements to `futures-workstation-presentation`, one to
  `futures-contract-leverage`, one to `futures-position-margin`, and adds one and
  modifies one in `futures-order-visibility`.
- Touches the workstation transport but not the workstation service, so it does
  not collide with `keep-the-contracts-warm`; it serves it, because a per-socket
  watchdog is the one freshness check a contract that is not on screen still has.
