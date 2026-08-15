## 0. Reproduce Before Changing

- [x] 0.1 Reproduce both halves in a test against the pre-change tree extracted
      with `git archive`: a drag whose modifier is released mid-gesture, and a
      drop whose button comes up after the modifier. Both must, on today's code,
      put the order back at the price it was lifted from. Say which of the new
      tests bite and which merely guard.
      **Two bite, two guard.** Biting: the drop with the modifier already
      released, which put the order back at 59900 instead of leaving it at
      59940; and the modifier released while the cancellation was still out,
      which discharged the drag at the origin without waiting for the button.
      Guarding: dropping the order back on the level it came from, and a
      gesture the system cancels — both already put the order back, and both
      had to go on doing it.

## 1. The Button Holds The Drag

- [x] 1.1 Remove the `keyup` listener that abandons a live drag. A modifier
      released mid-gesture is not the operator letting go of the order.
- [x] 1.2 Decide the drop by the pointer alone: `finishOrderDrag` stops asking
      whether the modifier was still held when the button came up.
- [x] 1.3 Leave the modifier its one job — beginning the drag — and drop what
      the drag no longer needs to remember about it.

## 2. What Still Abandons A Drag

- [x] 2.1 Dropping the order back on the price it was lifted from still abandons
      it, and the faint marker the chart leaves at that price is what makes it
      an aimable target rather than a coincidence. Prove it still holds.
- [x] 2.2 A gesture the system itself cancels — the pointer taken away — still
      puts the order back. Prove it still holds.

## 3. Verification

- [x] 3.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [x] 3.2 `npx vitest run` on the committed tree, extracted with `git archive`.
      1998 tests, all passing.
- [ ] 3.3 Operator repeats runbook step 27: pick an order up, let the modifier
      go mid-drag, keep dragging, release the button. The order lands where the
      pointer left it.

## 4. Stated Limits, Not Fixed Here

- [x] 4.1 With the modifier no longer ending a gesture, the mouse-only way out
      of a drag is to bring the order back to the price it came from and release
      there. Nothing else on this chart abandons a drag by hand. Whether that
      needs a second way out is the operator's call, not this change's.
