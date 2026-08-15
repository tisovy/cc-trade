## 0. Measured Before Starting

Re-measured on 2026-08-16 against HEAD `e92b648`, because the code moved under
this section after it was written on 2026-08-10. The queue is what it was; the
cost and the contention are not, and 0.2 and 0.3 below are the new readings.

- [x] 0.1 The queue: `RateLimiter(800, 60_000, 150)` — one instance
  (`binance-connection.js:760`), admission serialized through `admissionTail`,
  and each admission exactly 150ms after the last: twenty-five consecutive gaps
  of 150ms, measured. It holds every futures REST read and the leverage and
  margin-mode commands; placement, amendment and cancellation call the adapter
  directly and are not in it.
- [x] 0.2 The cost of the first review of a session, with nothing covered: 2
  income pages + 2 reads × 12 contracts = 26 requests and 3 750ms of that queue,
  measured. The ceiling is eight income pages, not four — the walk covers two
  windows of up to four pages each — so a `Full` read is 8 + 24 = 32 requests and
  4 650ms. A refresh of a review the desk already holds costs 2 requests:
  `hold-the-history-the-desk-has-read` archived on 2026-08-15, so the expensive
  load is now the first open of the review and the `Full` button, not every load.
- [x] 0.3 The contention, measured on the paths the desk actually takes: with the
  private stream up a placement no longer reads the account back at all
  (`reconcileAfterFuturesCommand` returns without reading), so what follows the
  operator's order is the read its stream frame asks for. A fill asks for the
  wallet, and behind a fan-out that read waited 3 150ms. A leverage change is
  worse than the proposal says: `setLeverage` is itself in this queue, so the
  operator's change reached the exchange 3 150ms after they asked for it, and the
  account read behind it 3 600ms after.

## 1. Read The View That Asked

- [x] 1.1 Carry which view the operator opened on the history command: `views` on
  `account.history`, sent by the dock, which is what knows the open tab. The
  workspace no longer reads the review on open — a read issued before any view is
  open pays for both endpoints and for a review nobody may look at.
- [x] 1.2 Read the order log or the fills accordingly, not both, and read the
  other when its tab is opened. Measured: opening one view is 14 requests and
  1 950ms of the queue, against 26 and 3 750ms for both. Opening the other view
  reads only what it needs, once; opening it again reads only the rotation's one
  contract.
- [x] 1.3 Keep what is already loaded when the other view arrives, so switching
  tabs does not discard the rows already on screen. The answer states which
  endpoints it covers, and coverage, cursors, the stream proof and the persistent
  store are all per endpoint — a read of the fills leaves the order log alone in
  every one of them.

## 2. Let The Urgent Read Overtake

- [x] 2.1 Give the admission queue a way to admit a read ahead of queued work of
  lower urgency, without letting a stream of urgent reads starve a history load
  already in progress: state the bound on how far a queued request may be passed,
  and hold to it. The bound is eight — every pass is counted against every
  request it skipped, and nothing may pass one that has been passed eight times.
  A fan-out is therefore held up by at most eight admissions however many orders
  are worked over it.
- [x] 2.2 Mark the post-mutation account read urgent, and the history fan-out
  ordinary. Urgent is the read that follows a command, a settlement the stream
  reported, or an outcome the exchange left open; the first snapshot, a reconnect
  and the periodic beat stay ordinary. Measured: the wallet read a fill asks for
  went from 3 150ms behind the fan-out to 600ms, which is the 400ms the desk
  itself holds a frame-driven read for plus its turn.
- [x] 2.3 Mark the two commands that are themselves admitted through this queue —
  leverage and margin mode — urgent, and the contract read that stands between
  the change and the account read behind it. Measured: the leverage change
  reached the exchange 300ms after the operator asked instead of 3 150ms, and the
  account behind it landed at 1 200ms instead of 3 600ms.

## 3. Verification

- [x] 3.1 A test that queues a history fan-out and then a post-mutation refresh,
  and asserts the refresh is admitted before the fan-out's remaining requests —
  and two on the queue itself, one for the overtaking and one for the bound that
  keeps it from starving the review. All three fail on the tree before this
  change.
- [x] 3.2 A test that opening one history view reads one endpoint per contract,
  that the other view reads its own when opened, and that neither the held review
  nor the persistent store loses the rows of the view that was not read.
- [ ] 3.3 `npx vitest run` on the committed tree, extracted with `git archive`.
- [ ] 3.4 Operator confirms that opening the review no longer delays what the
  desk shows after an order. In
  `verify-the-desk-in-one-sitting/runbook.md`.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 The weight is not the problem and is not being changed: 180 of 800 a
  minute for the first review, 360 for `Full`, on a read the operator asks for.
  This is about the 150ms spacing and the order of admission.
- [ ] 4.2 Halving the requests does not remove the contention, it halves it. The
  overtaking in section 2 is what actually bounds the delay.
- [ ] 4.3 The repeats are already gone: `hold-the-history-the-desk-has-read`
  archived on 2026-08-15, so selecting a tab reads nothing and a refresh of a held
  review costs two requests. What is left for this change is the load that is
  still expensive — the first review of a session and the `Full` button — and the
  order the queue admits it in.
