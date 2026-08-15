## 0. Establish The Bound Is Already Held

- [ ] 0.1 Find where the ticket's `Size is below the Binance minimum notional`
      refusal is enforced, and confirm the same value is reachable from the drag
      and amend path. If it is not, this change is about carrying it there, and
      the tasks below are written against that.
- [ ] 0.2 Write the failing test first: an amendment whose replacement falls
      under the minimum notional must, on today's code, cancel the existing
      order. Run it against the pre-change tree extracted with `git archive` and
      say whether it bites or guards.

## 1. Check Before Giving Up The Order

- [ ] 1.1 Evaluate the replacement against the bounds the placement path already
      enforces, before the cancel is issued.
- [ ] 1.2 Refuse the amendment on failure, leaving the existing order untouched
      at the exchange and on the chart.
- [ ] 1.3 Name the bound in the refusal, in the words the placement path already
      uses, so one order refusal does not read differently from another.
- [ ] 1.4 Do not widen this into a general local filter check: only bounds the
      desk already enforces elsewhere are consulted here. A bound invented for
      this path would refuse orders the exchange would have taken.

## 2. The Order Stays Where It Was

- [ ] 2.1 Return the dragged order to its resting price on refusal, rather than
      leaving it drawn where the drag dropped it.
- [ ] 2.2 Prove the order is still live after a refused amendment — not merely
      still drawn — by asserting against the working-order state the desk holds.

## 3. Verification

- [ ] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`,
      `npm run check:command-path`.
- [ ] 3.2 `npx vitest run` on the committed tree, extracted with `git archive`.
- [ ] 3.3 Prove by test that a replacement the desk cannot judge in advance still
      reaches the exchange, and that its refusal still reads as
      `cancelled and not replaced`. This change must not silence that message —
      it must stop being the answer to a case the desk could have caught.
- [ ] 3.4 Operator drags a minimum-size order downward until the notional would
      fall under 5 USDT. The order stays live, and the desk says why it will not
      move.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 The amendment remains a cancel and a placement rather than becoming an
      exchange-side amend. Changing that is a different question with its own
      failure modes, and this change is about not starting a sequence the desk
      knows will not finish.
