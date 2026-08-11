## Why

One press of ↻ on the history panel costs up to **360 weight** against a bucket
of 800 a minute:

- contract discovery walks realized-PnL income, up to four pages of the last day
  and four of the rest of the week, at weight 30 a page — **up to 240**;
- the fan-out then reads order history and trade history for up to twelve
  contracts at weight 5 each — **120**.

It also takes about five seconds before any network time, because the account
limiter spaces admissions 150ms apart and that is 32 admissions.

Almost all of it is re-reading what the desk already has. The review is held
across the session and maintained by the stream — a fill folds into it without a
read (`futuresHeldHistory.js`) — and yet a refresh asks every contract for its
whole week again, and asks income which contracts exist even when the answer is
already on screen.

Nothing carries across a restart either: the desk starts each run with an empty
review and buys the whole thing again, while the candle history beside it is
served from a local store precisely because a closed candle never changes. A
filled order and an executed trade never change either.

## What Changes

- **The review is stored locally, per contract**, the way closed candles already
  are: orders and trades that have reached a terminal state, with the window
  each contract's rows are known to cover. On launch the review is on screen
  before anything is asked of the exchange.
- **A read asks only for the gap.** Binance answers `allOrders` from an
  `orderId` and `userTrades` from a `fromId`, so a contract whose rows are known
  up to a point is read forward from that point rather than from a week ago.
- **A contract with nothing new is not read at all.** While the user-data stream
  is connected, every fill and every order change on the account arrives on it,
  so the held rows for a contract that has seen no stream activity since the last
  read are current by construction. A refresh reads the contracts that moved,
  plus a slow rotation so a stream gap cannot hide forever.
- **Discovery is asked only when the store cannot answer.** The contracts the
  account traded are what the store already names; income is walked when the
  store is empty, when it has aged past its window, or when the operator asks for
  a full re-read.
- **A full re-read stays available and stays explicit** — the operator asks for
  it, and it costs what it costs.

## Trade-offs this accepts

- **The desk now trusts its own store between reads.** That trust is bounded:
  the store holds only terminal rows, the stream is what maintains it, a stream
  reconnect invalidates the "nothing changed" assumption for every contract, and
  the rotation re-reads everything within a stated number of refreshes.
- **A trade made elsewhere on a contract the desk is not watching appears on the
  rotation or on a full re-read, not on the next refresh.** Today it appears
  only if income discovery happens to reach it, which — as the operator found —
  it frequently did not.
- **Another local store to keep bounded and to degrade from.** It follows the
  candle store: bounded per contract, unreadable means fetch as before, and it
  never becomes a source the desk cannot do without.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: the account review is stored across runs and a
  read asks only for what the store does not hold.

## Impact

- `src/utils/futuresHistoryStore.js` (new) — the store, modelled on
  `futuresCandleHistoryCache.js`.
- `src/utils/futuresHeldHistory.js` — the held review knows what each contract
  is covered from, and hands that to the read.
- `electron/services/binance-connection.js` — the history command takes a
  per-contract starting point and a discovery it may skip.
- `electron/services/futures-trading-adapter.js` — `getOrderHistory` and
  `getTradeHistory` read forward from an identity.
- Composes with `hold-the-working-orders-on-the-stream`: both make the stream
  the thing that keeps the desk current, and REST the thing that proves it.
