## 0. Measured Before Starting

Measured on 2026-08-16 against `cbd6f6e`. Re-verify against the tree you actually
start from — the reconnect path is being worked in parallel — and if the numbers
have moved, rewrite this section by fact before building anything.

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

- [ ] 1.1 Give the listen-key request the urgency of what it is: the desk's own
  eyes, not something anybody asked to read. `execute(fn, 1, 2, { urgent: true })`
  at `binance-connection.js:2108`.
- [ ] 1.2 Cover the whole start path with it, not just the reconnect. The first
  start of the session, an ordinary reconnect and every backoff retry
  (`:2350`, `:2365`) all reach the exchange through that one call, and splitting
  them would add a branch for no behaviour worth having.
- [ ] 1.3 Leave the keep-alive renewal (`:2316`) ordinary, and say so in the
  code where the next reader will ask. A thirty-minute beat against a
  sixty-minute key is not something a few seconds of queue can break, and making
  it urgent spends the bound on the one case that does not need it.

## 2. Verification

- [ ] 2.1 A test that queues a history fan-out, drops the private stream, and
  asserts the listen key is admitted ahead of the fan-out's remaining requests —
  and that the fan-out still finishes. Run it against the tree before the change
  first: if it passes there it is a guard, not a finding, and must be labelled
  one. It should fail with the key admitted last.
- [ ] 2.2 `npx vitest run` on the committed tree, extracted with `git archive`,
  with `eslint`, `check:futures-production` and `check:command-path` beside it on
  the same tree. Baseline to beat: 111 files, 2 019 tests at `4c7c9bf`.

## 3. Stated Limits, Not Fixed Here

- [ ] 3.1 No operator step. Staging this by hand means killing the private stream
  while a review is loading, and the only lever the operator has — stopping the
  proxy at `127.0.0.1:1080` — takes the review's own REST reads down with it, so
  the two cannot be separated on the desk. It is verified by measurement.
- [ ] 3.2 This shortens the window; it does not remove it. Five seconds of that
  backoff are deliberate and are not being touched here.
- [ ] 3.3 Whether the stream should be rebuilt faster than five seconds, and
  whether the desk should say on screen that it is currently reading rather than
  listening, both belong to `prove-the-private-stream-is-carrying`.
