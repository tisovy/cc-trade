## 0. Measured Before Starting

Measured on 2026-08-16 against `cbd6f6e`. Re-verify against the tree you actually
start from — the reconnect path is being worked in parallel — and if the numbers
have moved, rewrite this section by fact before building anything.

**Re-verified against `d067e59`**, which is two changes further on and includes
the futures REST connection pool. The finding is unchanged: with a review queued
when the reconnect fires, the key is admitted **last of 23, with nothing left
behind it**. The pool made every read faster; it did not move anything in the
queue, because the queue spaces admissions by the clock and not by the answer.

- [x] 0.1 The queue is one instance for all futures reads,
  `RateLimiter(800, 60_000, 150)` (`binance-connection.js:837`), admission
  serialized and spaced 150 ms. The listen-key request goes through it at
  weight 1 (`:2108`) with no urgency, so it is admitted in arrival order.
- [x] 0.2 With a review queued when the reconnect fires, the key was admitted
  **25th of 25, 3 650 ms** after it was asked for, with no history read left
  behind it — it waited out the whole fan-out. The stream was therefore down
  8 650 ms rather than the 5 000 ms the desk intends
  (`FUTURES_USER_DATA_RESTORE_MS`, `:1831`).
- [x] 0.3 With `{ urgent: true }` on that one call: **2nd of 25, 200 ms**, and
  the review still completed all twenty-four of its reads. The bound holds.

The harness, so this is reproducible rather than quoted: in a `git archive`
extract, add a test beside the two contention tests in
`binance-connection.test.js` that opens the futures desk and its private stream,
records `Date.now()` inside the `getOrderHistory`, `getTradeHistory` and
`createUserDataStreamListenKey` mocks, calls `socket.handlers.close()`, advances
4 900 ms, sends `account.history` from the renderer, advances 100 ms — the
reconnect fires here — and then advances past everything. `console.warn` is
mocked in that file, so write the numbers out with `fs.appendFileSync`.

## 1. Admit It Ahead

- [x] 1.1 Give the listen-key request the urgency of what it is: the desk's own
  eyes, not something anybody asked to read. `execute(fn, 1, 2, { urgent: true })`
  in `startFuturesUserDataStream`.
- [x] 1.2 Cover the whole start path with it, not just the reconnect. The first
  start of the session, an ordinary reconnect and every backoff retry all reach
  the exchange through that one call — `ensureFuturesUserDataStream`, the
  restore timer and the retry timer each re-enter
  `startFuturesUserDataStream` — so nothing had to be split and no branch was
  added to say which is which.
- [x] 1.3 Leave the keep-alive renewal ordinary, and say so in the code where
  the next reader will ask. A thirty-minute beat against a sixty-minute key is
  not something a few seconds of queue can break, and making it urgent spends
  the bound on the one case that does not need it.

## 2. Verification

- [x] 2.1 **A finding, not a guard.** `reopens the private stream ahead of a
  review already queued` in `binance-connection.test.js` drops the private
  stream, lets the restore run to 500 ms short of firing, asks for a review of
  eleven contracts, and then lets the reconnect fire into the queued fan-out.
  Every admission the queue lets out is recorded in the order it let it out.

  | | the key's place | review reads still behind it |
  |---|---|---|
  | before the change | **23rd of 23** | 0 |
  | after | **4th of 23** | 19 |

  Run against the tree before the change it fails on exactly that: *expected 0
  to be greater than or equal to 10*. Fourth rather than second because the
  review had 500 ms to be admitted into before the key was asked for, which is
  three admissions at the queue's 150 ms spacing — the desk's own timing, not
  the test's. The fan-out still finished all twenty-two of its reads, which the
  test asserts beside it, so the bound on passing holds here as it did in §0.
- [x] 2.2 Full gate on the working tree with the change applied: `eslint` clean,
  **2 032 tests in 111 files** passing (2 031 before this one), and
  `check:circular`, `check:runtime-mock`, `check:futures-production` and
  `check:command-path` all passing. Baseline in this task was 2 019 at `4c7c9bf`;
  the difference is this test and the twelve that came with
  `pay-the-handshake-once`.

## 3. Stated Limits, Not Fixed Here

- [x] 3.1 No operator step. Staging this by hand means killing the private stream
  while a review is loading, and the only lever the operator has — stopping the
  proxy at `127.0.0.1:1080` — takes the review's own REST reads down with it, so
  the two cannot be separated on the desk. It is verified by measurement.
- [x] 3.2 This shortens the window; it does not remove it. Five seconds of that
  backoff are deliberate and are not being touched here.
- [x] 3.3 Whether the stream should be rebuilt faster than five seconds, and
  whether the desk should say on screen that it is currently reading rather than
  listening, both belong to `prove-the-private-stream-is-carrying`.
