## Why

`pay-the-handshake-once` stopped the futures REST leg opening a connection per
request. Spot was left exactly as it was, and the measurement that justified the
futures change applies to it unchanged: through the operator's own proxy, a
request that opens its own connection answers in **630 ms** and the same request
on one already open in **325 ms**.

Spot pays that on every read, every account refresh and every order.

Two things kept it, and neither survives being looked at:

- **`keepAlive: false, // Disable keepAlive to avoid axios agent issues`.** The
  flag decides nothing while an agent is supplied. `@binance/common` builds its
  own keep-alive agent only when it has not been given one —
  `if (configuration?.keepAlive && !configuration?.baseOptions?.httpsAgent)` —
  and this desk supplies one. Whatever the comment was written about, it was not
  reachable through this configuration.
- **The agent itself.** Spot took `sharedProxyAgent`, built by `resolveProxyAgent()`
  with no options at all, which is one connection per request. The same helper
  builds the futures pool; it was simply never asked to build spot one.

## What this is not

Not the futures change repeated. Futures needed a guarded one-shot retry, because
pooling introduces exactly one new failure — the far side closes an idle
connection and the request dies before any byte of a response — and futures owns
its transport, so it can see `request.reusedSocket` and retry safely on that
signal alone.

Spot goes through the vendor SDK and cannot see that. **It does not need to.**
The failure pooling introduces arrives as `ECONNRESET`, which is already in
`INDETERMINATE_TRANSPORT_CODES`, so the desk already treats it as an outcome it
does not know: it says so to the operator and reconciles the command against the
exchange with `spotTradingAdapter.findOrder` before anything is resubmitted. That
machinery predates this change and is stronger than a retry — it asks the
exchange what happened rather than guessing that nothing did.

The honest cost is that this path will now fire occasionally where it did not
before: a stale pooled socket costs the operator an "unresolved" banner and a
lookup, instead of futures' silent retry. That is the price of not owning the
transport, and it is paid on a rare path rather than on every request.

## What Changes

- The spot REST leg gets a bounded connection pool of its own, and the flag
  beside it stops saying the opposite.
- The WebSocket callers keep the agent that does not pool. A stream opens one
  connection and holds it, so pooling buys it nothing.
- Each leg gets its own agent — spot, futures, and the streams — so none can
  exhaust another's sockets.
- **The spot leg says when it opens a connection.** Before this change the record
  carried no spot timing of any kind, so "did it get faster" had nothing to be
  answered from. A request served from the pool writes nothing: the absence of
  those lines is the evidence, and their return in numbers is the alarm.

## What it costs, honestly

The pool's numbers are chosen for headroom rather than measured, and the change
says so rather than implying otherwise. Spot's traffic has never been recorded,
so there is no observed concurrency to size against; 32 sockets is far above
spot's widest moment (an account refresh is three reads) and four stay warm
between bursts, which is what a refresh plus a command needs to find a connection
already open. The instrumentation added here is what makes the next sizing a
measurement instead of another guess.

## Impact

- `electron/services/spot-rest-pool.js` — new: the pool and the connection count.
- `electron/services/binance-connection.js` — the spot client takes the pooled
  agent; the stream agent is untouched.
- Adds a requirement to `trading-command-integrity`.
