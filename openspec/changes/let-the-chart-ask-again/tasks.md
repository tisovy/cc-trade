## 0. Reproduce Before Changing

- [ ] 0.1 Reproduce step 19 in a test before touching the renderer: a run that
      takes a failure and then a scroll must, on today's code, issue no second
      read. A test that passes against the pre-change tree is a guard, not a
      finding — extract the tree with `git archive` and say which it is.
- [ ] 0.2 Establish which of the two latches the operator actually hit. Both
      produce the same screen, and the fix differs: `historyExhausted` blocks the
      request at the chart, while a stuck `historyRequestRef` blocks it in the
      hook. The record cannot tell them apart, so decide it by test rather than
      by reasoning about the transcript.

## 1. A Failure Is Not The Start Of History

- [ ] 1.1 Conclude exhaustion only from a page the exchange served. A page that
      did not arrive says nothing about whether older candles exist.
- [ ] 1.2 Keep `!deepened` as an exhaustion signal where it is honest — a served
      page that does not reach behind what is held — and prove it still holds.
- [ ] 1.3 Clear the exhaustion conclusion when the run it was drawn from is
      itself in doubt: a disconnect that wiped the resource behind it is not
      evidence about the contract's history.
- [ ] 1.4 Prove by test that a failure followed by a scroll issues a new read,
      and that a genuinely short page still stops the asking.

## 2. The Notice Does Not Outlive Its Own Instruction

- [ ] 2.1 Lower `readFailed` on every event that makes its instruction true
      again, not only on a page arriving.
- [ ] 2.2 Where the chart genuinely cannot ask again, say that instead of
      saying `scroll again to retry`. The two states look identical today and
      are not the same thing: one is the contract having no more history, the
      other is a read that failed.
- [ ] 2.3 Prove by test that no reachable state leaves the notice standing with
      an instruction the desk will not honour.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 3.2 `npx vitest run` on the committed tree, extracted with `git archive` —
      not on the working tree, which other sessions are editing.
- [ ] 3.3 Operator repeats runbook step 19: outage, scroll to where candles are
      missing, restore the link, scroll again. Older candles load, or the chart
      says why they will not.
- [ ] 3.4 Operator confirms Spot (step 21) still recovers as it does today.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 Spot and Futures reach history by two different paths, and only one of
      them has this defect. Unifying them is not this change: the Spot path is
      `DataContext`'s, is shared with everything else Spot draws, and carries its
      own requirement set under `spot-chart-history`. Stated so the next person
      does not read the divergence as an oversight.
