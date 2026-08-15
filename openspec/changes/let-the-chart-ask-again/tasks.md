## 0. Reproduce Before Changing

- [x] 0.1 Reproduce step 19 in a test before touching the renderer: a run that
      takes a failure and then a scroll must, on today's code, issue no second
      read. A test that passes against the pre-change tree is a guard, not a
      finding — extract the tree with `git archive` and say which it is.
      **Found, not guarded.** Four new tests fail against `git archive HEAD`
      (46bd6da) and pass after the change. The fifth, `still stops asking on a
      page the exchange served short`, fails there only for naming the reason —
      the stopping half of it is a guard and is called one here.
- [x] 0.2 Establish which of the two latches the operator actually hit. Both
      produce the same screen, and the fix differs: `historyExhausted` blocks the
      request at the chart, while a stuck `historyRequestRef` blocks it in the
      hook. The record cannot tell them apart, so decide it by test rather than
      by reasoning about the transcript.
      **Both. Each one alone produces step 19's screen, and the sequence the
      operator ran reaches both**, which is why the change closes both:
      - `historyExhausted`. Every status the desk states while the link is down
        is a non-live state, and `applyFuturesWorkstationEvent` restates every
        resource under it — the previous history answer comes back around as a
        new object, same `endTime`, same rows. With a read outstanding at that
        same `endTime` — which is what scrolling at an edge that did not move
        produces — the renderer read the restatement as that read's answer: a
        page deepening nothing, which is the chart concluding the contract's
        history starts there. Measured on the pre-change tree: `exhausted`
        `true`, and the notice cleared with it.
      - `historyRequestRef`. The link coming back rebuilds the session under a
        new generation, which empties every resource the renderer holds. A read
        outstanding across that is answered by nothing — either it was never
        read, or its answer is dropped for being older than what is on screen.
        Measured on the pre-change tree: the lock is still held, and no scroll
        issues a read for the rest of the session while the notice stands.

## 1. A Failure Is Not The Start Of History

- [x] 1.1 Conclude exhaustion only from a page the exchange served. A page that
      did not arrive says nothing about whether older candles exist. The desk
      sends a served page as `live` and sends nothing else that way, so that is
      the test: anything else answering a read releases it and raises the notice
      without concluding anything about the contract.
- [x] 1.2 Keep `!deepened` as an exhaustion signal where it is honest — a served
      page that does not reach behind what is held — and prove it still holds.
      Kept, and now says which of the two reasons it is: the exchange having
      nothing older is a fact about the contract, the run this chart draws
      ending is a fact about the desk, and the operator is told them apart.
- [x] 1.3 Clear the exhaustion conclusion when the run it was drawn from is
      itself in doubt: a disconnect that wiped the resource behind it is not
      evidence about the contract's history. **Done at the source rather than by
      clearing:** with 1.1 in place a wiped resource can no longer produce the
      conclusion, so there is none to clear. An exhaustion drawn from a page the
      exchange did serve deliberately survives a reconnection — the run it was
      drawn from is still on screen, and re-reading it on every freshness resync
      would buy a page a minute from the slowest part of this desk.
- [x] 1.4 Prove by test that a failure followed by a scroll issues a new read,
      and that a genuinely short page still stops the asking.

## 2. The Notice Does Not Outlive Its Own Instruction

- [x] 2.1 Lower `readFailed` on every event that makes its instruction true
      again, not only on a page arriving. **A served page is the only one.** The
      requirement this change is written under forbids the rest: told "until a
      read succeeds", because a notice that withdraws itself leaves the chart
      looking like a contract whose history ends there. A link coming back is
      not a read succeeding. What was actually wrong is the other direction —
      the notice standing where its instruction had become false — and that is
      2.2.
- [x] 2.2 Where the chart genuinely cannot ask again, say that instead of
      saying `scroll again to retry`. The two states look identical today and
      are not the same thing: one is the contract having no more history, the
      other is a read that failed.
- [x] 2.3 Prove by test that no reachable state leaves the notice standing with
      an instruction the desk will not honour.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [x] 3.2 `npx vitest run` on the committed tree, extracted with `git archive` —
      not on the working tree, which other sessions are editing. 1976 tests, all
      passing, on the tree this change was committed as.
- [ ] 3.3 Operator repeats runbook step 19: outage, scroll to where candles are
      missing, restore the link, scroll again. Older candles load, or the chart
      says why they will not. Written out there, in the operator's words, with
      what counts as the defect not having closed — this line is the pointer,
      the check itself is step 19.
- [ ] 3.4 Operator confirms Spot (step 21) still recovers as it does today.
      Stated there as the control case for step 19: the two markets reach
      history by different paths, and the pair is where the difference shows.

## 4. Stated Limits, Not Fixed Here

- [x] 4.1 Spot and Futures reach history by two different paths, and only one of
      them has this defect. Unifying them is not this change: the Spot path is
      `DataContext`'s, is shared with everything else Spot draws, and carries its
      own requirement set under `spot-chart-history`. Stated so the next person
      does not read the divergence as an oversight.
- [x] 4.2 Found by auditing the delivered change and left as it is: a page that
      arrives in the same tick as a stated outage is dropped, and the operator is
      told the read could not be served. Measured — twenty served rows, gone, and
      the notice up. It costs one re-read on the next scroll and nothing else: no
      exhaustion is concluded and no read is left held. Fixing it properly means
      applying an answer from the event that carried it rather than from the
      resource snapshot it landed in, which is a larger change than this one, and
      every cheaper discriminator is the one that produced step 19.
- [x] 4.3 One read can still be lost without the desk noticing: a load the
      backend refuses outright — `CANDLE_HISTORY_OWNER_UNAVAILABLE` — is not a
      workstation event, so the renderer never sees it. It reaches the operator
      only as a chart that does not deepen until the session is rebuilt, which
      now releases the read. Named rather than fixed, because the fix is on the
      command path in `electron/services/`, which this change does not open.
