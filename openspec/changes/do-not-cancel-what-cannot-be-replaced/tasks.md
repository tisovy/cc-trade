## 0. Establish The Bound Is Already Held

- [x] 0.1 Find where the ticket's `Size is below the Binance minimum notional`
      refusal is enforced, and confirm the same value is reachable from the drag
      and amend path. If it is not, this change is about carrying it there, and
      the tasks below are written against that.
      **Held, and reachable — it was simply not asked.** The bound is the
      contract's own `filters.minimumNotional`, which the workstation already
      holds for the selected contract. The ticket refuses a placement against it
      inside `deriveFuturesLimitOrderDraft` (`BELOW_MINIMUM_NOTIONAL`), and the
      amend panel refuses a typed amendment against the same value. The drag
      asked for the tick and the local ceiling and never for this one. So this
      change carries it there.
- [x] 0.2 Write the failing test first: an amendment whose replacement falls
      under the minimum notional must, on today's code, cancel the existing
      order. Run it against the pre-change tree extracted with `git archive` and
      say whether it bites or guards.
      **Four bite, two guard**, against `git archive HEAD` (1b12b1f):
      - bites: the drop under the floor leaving the order live; the lift refused
        at a resting price under the floor; the over-cap drop putting the order
        back; the refusal of the restoring placement being stated as a loss.
      - guards: an unheld floor refusing nothing, and the exchange's own refusal
        still reading as `cancelled and not replaced` (3.3).

## 1. Check Before Giving Up The Order

- [x] 1.1 Evaluate the replacement against the bounds the placement path already
      enforces, before the cancel is issued. **A drag cancels at the pick-up, so
      what can be evaluated before that cancel is the order at the price it is
      resting at** — the price it will be dropped at does not exist yet. That
      evaluation now includes the floor, so an order the desk could not place
      back where it rests is never picked up. The operator's own case is not
      that one: their order cleared the floor at rest and fell under it on the
      way down, and it is caught at 2.1 instead.
- [x] 1.2 Refuse the amendment on failure, leaving the existing order untouched
      at the exchange and on the chart.
- [x] 1.3 Name the bound in the refusal, in the words the placement path already
      uses, so one order refusal does not read differently from another. Reads
      `The order would be 4.6667 USDT, below the Binance minimum notional of 5
      USDT.`, beside the ceiling's `above the local 250 USDT limit`.
- [x] 1.4 Do not widen this into a general local filter check: only bounds the
      desk already enforces elsewhere are consulted here. A bound invented for
      this path would refuse orders the exchange would have taken. A floor the
      desk has not loaded refuses nothing, and there is a test for that.

## 2. The Order Stays Where It Was

- [x] 2.1 Return the dragged order to its resting price on refusal, rather than
      leaving it drawn where the drag dropped it. **This is where the operator's
      case is caught.** A move refused by a bound the desk holds is refused as a
      move: the order is placed again at the price it was resting at, and the
      alert says which bound refused it. The same now goes for the local ceiling,
      which used to lose the order and offer a button to put it back.
      Residual, stated: for the length of that placement — one round trip, 340–800
      ms measured — the drag's mark is still drawn dashed at the price it was
      dropped on, as it is for any replacement in flight. It is removed and the
      order redrawn where it rests when the placement is answered.
- [x] 2.2 Prove the order is still live after a refused amendment — not merely
      still drawn — by asserting against the working-order state the desk holds.
      Asserted against the commands the desk actually issues — one cancellation,
      one placement at the resting price — which is the working-order state at
      this layer: the drag hook is what owes the order, and the account read that
      would show it is the exchange's answer to those two calls.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`,
      `npm run check:command-path`.
- [x] 3.2 `npx vitest run` on the committed tree, extracted with `git archive`.
      1982 tests, all passing.
- [x] 3.3 Prove by test that a replacement the desk cannot judge in advance still
      reaches the exchange, and that its refusal still reads as
      `cancelled and not replaced`. This change must not silence that message —
      it must stop being the answer to a case the desk could have caught.
- [ ] 3.4 Operator drags a minimum-size order downward until the notional would
      fall under 5 USDT. The order stays live, and the desk says why it will not
      move.

## 4. Stated Limits, Not Fixed Here

- [x] 4.1 The amendment remains a cancel and a placement rather than becoming an
      exchange-side amend. Changing that is a different question with its own
      failure modes, and this change is about not starting a sequence the desk
      knows will not finish.
- [x] 4.2 The drag still cancels at the pick-up, before the price it will be
      dropped at exists. Moving that cancellation to the drop is what would let
      the desk refuse a move without ever taking the order off the book, and it
      is a different change: the window it would close is the one
      `useFuturesOrderDrag` was deliberately built around, and closing it leaves
      the order fillable at its old price for the length of the gesture. Named
      so the next person does not read this change as having closed it.
- [x] 4.3 Only the two bounds the desk already holds are asked — the exchange's
      minimum notional and the desk's own order ceiling. The price band, the
      maximum open order count and the rest stay the exchange's, per the
      operator's decision not to check exchange filters locally.
