## 0. Measured Before Starting

- [x] 0.1 The queue: `RateLimiter(800, 60_000, 150)`, one instance shared by every
  futures REST read, admission serialized and each request spaced 150ms.
- [x] 0.2 The cost: 1–4 income pages + 2 reads × 12 contracts = 25–28 requests,
  3.8–4.2s of that queue, against 17 requests and ~2.5s before the fan-out was
  widened.
- [x] 0.3 The contention: `runFuturesAccountRefreshPass` and the history fan-out
  call `futuresRestLimiter.execute` on the same instance, in arrival order.

## 1. Read The View That Asked

- [ ] 1.1 Carry which view the operator opened on the history command.
- [ ] 1.2 Read the order log or the fills accordingly, not both, and read the
  other when its tab is opened.
- [ ] 1.3 Keep what is already loaded when the other view arrives, so switching
  tabs does not discard the rows already on screen.

## 2. Let The Urgent Read Overtake

- [ ] 2.1 Give the admission queue a way to admit a read ahead of queued work of
  lower urgency, without letting a stream of urgent reads starve a history load
  already in progress.
- [ ] 2.2 Mark the post-mutation account read urgent, and the history fan-out
  ordinary.

## 3. Verification

- [ ] 3.1 A test that queues a history fan-out and then a post-mutation refresh,
  and asserts the refresh is admitted before the fan-out's remaining requests.
- [ ] 3.2 A test that opening one history view reads one endpoint per contract.
- [ ] 3.3 `npx vitest run` on the committed tree, extracted with `git archive`.
- [ ] 3.4 Operator confirms that opening the review no longer delays what the
  desk shows after an order.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 The weight is not the problem and is not being changed: 240 of 800 a
  minute, on a read the operator asks for. This is about the 150ms spacing and
  the order of admission.
- [ ] 4.2 Halving the requests does not remove the contention, it halves it. The
  overtaking in section 2 is what actually bounds the delay.
- [ ] 4.3 The reads that should never have been issued are not this change's
  either: selecting a history tab re-reads the whole account on every click, and
  that is `hold-the-history-the-desk-has-read`. This change makes one read
  cheaper and better-ordered; that one removes the repeats. Do them in either
  order — they touch different code — but neither is complete without the other.
