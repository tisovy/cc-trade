## Why

The private stream is how the desk learns that a fill happened. When it drops,
the desk rebuilds it: five seconds of deliberate backoff
(`FUTURES_USER_DATA_RESTORE_MS`, `binance-connection.js:1831`), then one request
for a listen key (`:2108`). That request is admitted through the same queue as
every other futures read — `RateLimiter(800, 60_000, 150)`, `:837` — in arrival
order, and a history review is twenty-six requests of that queue.

So if the reconnect asks for its key while a review is queued, the key goes last.
Measured on 2026-08-16 against `cbd6f6e`, with the review opened 100 ms before
the reconnect fires:

| | admitted | waited | history reads still behind it |
|---|---|---|---|
| today | 25th of 25 | 3 650 ms | 0 |
| with the flag | 2nd of 25 | 200 ms | 23 |

The stream is down 8 650 ms instead of 5 200: the desk's eyes are shut for an
extra three and a half seconds because the operator asked to look at their own
trades.

What that window costs is not hypothetical, and it is in three places:

- Every command issued in it goes the long way. `reconcileAfterFuturesCommand`
  (`:1884`) reads the whole account back when the stream is not carrying — four
  resources, weight 90 — where a carrying stream costs nothing at all.
- A fill landing in it is not reported. The desk learns of it from whatever reads
  next, which is the staleness the private stream exists to remove.
- `markFuturesUserDataLoading` (`:1901`) invalidates the history stream proof, so
  the very review the operator is waiting for has to re-read every contract the
  next time it is opened. The delay pays for itself twice.

The mechanism to fix it is already here and already bounded.
`keep-the-history-read-out-of-the-way` (archived 2026-08-16) gave the queue
`execute(fn, weight, retries, { urgent })`, and nothing may pass a queued request
more than eight times (`MAX_ADMISSION_PASSES`, `:345`) — so the review cannot be
starved by what overtakes it. The measurement above confirms it: with the flag,
the review still completed all twenty-four of its reads.

This was found by auditing that change rather than by building it, and left
undone deliberately: the reconnect path is what
`prove-the-private-stream-is-carrying` is holding open in the same working tree.

## What Changes

- The listen-key request that starts or restores the futures private stream is
  admitted ahead of ordinary reads, within the existing bound.
- The keep-alive renewal is **not** changed. It runs every thirty minutes against
  a key that lives sixty, so a few seconds of queue cannot expire it; it is an
  ordinary read and should stay one.
- Spot is **not** changed. Its listen key goes through `legacySpotRateLimiter`
  (`:541`), which nothing queues a twenty-six-request fan-out into.

## Impact

- Affected specs: `futures-live-readiness`
- Affected code: `electron/services/binance-connection.js:2108` — one call, one
  option — and one test beside it
- Coordination: that line sits inside the reconnect path
  `prove-the-private-stream-is-carrying` is working in. Land this after theirs,
  or agree the line with that session before touching it.
- Not a correctness fault: nothing reads wrong, and the desk already falls back
  to reading the account while the stream is down. This shortens how long it has
  to.
