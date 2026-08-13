## Why

The desk's own record says the authenticated futures stream is not reliably
coming up, and says nothing about why.

`reason: 'stream'` has exactly one call site — the user-data socket's `open`
handler (`electron/services/binance-connection.js:1656`) — so a `stream` line in
the record is "the private socket opened", and its absence is "it never did". In
`~/.config/cc-trade/diagnostics/desk-2026-08-13-000.jsonl`, bucketed by session
start:

| session start (UTC) | reads | `stream` lines |
|---|---|---|
| 10:39:59 | 36 | 3 |
| 10:54:00 | 22 | **0** |
| 11:04:36 | 80 | 2 |
| 11:42:06 | 221 | **0** |
| 13:32:57 | 19 | 1 |

The 11:42 session ran 110 minutes and reconciled 220 times without the private
socket opening once. The 13:32 session's single opening came at 13:38:10, after
thirteen weight-90 beats, and only because the operator cycled the proxy and
forced a reconnect — so even the rows with an opening are not evidence that
starting one works. Across all three journal days there is not one read with
reason `unstated`, which an execution report is supposed to schedule — the same
fact from the other side.

Nothing in that record says whether the socket was never asked for, was refused,
opened and died, or opened and delivered nothing. The code has a path for each
and states none of them:

- `if (!listenKey) { futuresUserDataReconnecting = false; return; }` (`:1623`).
  The key is `data?.listenKey` from the adapter (`futures-trading-adapter.js:905`),
  so an answer without that field, and the limiter's own generation guard
  answering `undefined`, are the same `undefined` here. The resource was marked
  `loading` at `:1614` and stays there: nothing marks it failed, nothing retries,
  nothing is recorded. The spot path distinguishes a skipped creation from a
  failed one (`:3609-3627`); the futures path does not.
- The generation/renderer re-check at `:1638` returns the same way.
- The `-2015` branch at `:1756` gives up permanently — correctly — but only into
  a log line the operator will not have.

The second failure mode is worse, because the desk trusts it. `markFuturesUserDataReady`
fires on `open` alone, and `futuresStreamCarriesOrders()` reads that `ready`
(`:1495`). On the strength of it, `reconcileAfterFuturesCommand` skips the
account read after every command (`:1521`). A socket that opens and then carries
nothing therefore makes the desk read *less*, not more: it stops asking, because
it believes it is being told. This is not hypothetical on these endpoints — this
repository already records the shape of it at `futures-mark-price-feed.js:33`,
where the unrouted paths decommissioned on 2026-04-23 "still succeed the
handshake and the socket stays open, so nothing reports an error — it simply
never delivers a frame". The private stream connects on `/ws/<listenKey>`
(`:1644`), an unrouted path of that same family, and unlike the mark price feed
it has no stall watchdog.

What makes the private stream harder than the public one is that silence is its
normal state: an account with nothing happening on it is told nothing, so no
data-frame timeout can separate a quiet account from a dead route. The exchange
does keep the socket alive on its own schedule, and that traffic — not the
account traffic — is what says the route is live.

Two changes have just been built on this leg. A fired algorithmic order is now
resolved from its execution report instead of on the thirty-second beat
(`name-the-algo-order-that-fired`), and the account is folded from
`ACCOUNT_UPDATE` instead of read back (`let-the-stream-state-the-account`). Both
are inert when the stream is not carrying, and neither can tell that it is not.

## What Changes

- The private stream is presented as carrying only while the exchange is
  demonstrably still talking on it. Silence past a measured bound presents it as
  not carrying and restores it, rather than leaving a socket that has stopped
  delivering marked ready.
- Any path that abandons the start of the private stream states a cause and
  either retries or says it has given up. None may leave the resource loading
  with nothing scheduled.
- The record can be asked why the private leg is not carrying. Opened, silent,
  refused and gave-up are each recorded with their cause, using the vocabulary
  the record already has.
- While the stream is not carrying, the reads that were dropped because the
  stream would report them are taken again — the fallback that already exists in
  `reconcileAfterFuturesCommand` becomes reachable in the case it was written for.

## Non-goals

- Not a transport rewrite, and not a change to what the stream carries once it is
  carrying. This change is about knowing.
- Not the frame-timing marks of `time-the-frame-from-exchange-to-screen`. That
  change times a leg that is delivering; this one establishes whether it is.
- No new diagnostic event kind. The record's existing `fault` and `read` kinds
  carry all of this, which also keeps this change off
  `desk-diagnostic-record.js` while the frame-timing change is working there.

## Impact

- `electron/services/binance-connection.js` — the futures user-data stream's
  start, ready-marking and close handling.
- Adds two requirements to `futures-live-readiness` and modifies one.
- Depends on nothing; `name-the-algo-order-that-fired` and
  `let-the-stream-state-the-account` depend on it in the sense that neither
  works live until it is true.
- Operator-visible: a desk whose private stream is not carrying says so, instead
  of looking identical to one whose account is simply quiet.
