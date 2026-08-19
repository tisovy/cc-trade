# Drop The Grip That Cannot Lift

## Why

A stop-market order rests on the book with `price: '0'` — the trigger lives in
`stopPrice`. The desk reads it through the regular order read, so it is
`REGULAR` to every surface, and the chart gave it the same grip every regular
order gets, promising "Move … with Ctrl or Alt drag".

That promise cannot be kept. The lift path
(`useFuturesOrderDrag.lift` → `describeFuturesDragReplacement`) evaluates the
order at the price it rests at before anything is cancelled — deliberately, per
`do-not-cancel-what-cannot-be-replaced` — and a resting price of `0` is refused
as `UNUSABLE_PRICE` every time. The refusal is then worded for the drop that
never happened: "The price the order was dropped at cannot be used", raised at
lift time, when nothing was dropped. So the control invites a gesture whose only
possible outcome is a refusal that misdescribes itself.

Two more findings from the same audit (2026-08-19, of 32b9da8 and the drag
hook):

- **The pending mark is drawn at the y-coordinate of price 0.** `beginOrderDrag`
  takes `priceToCoordinate(0)` as the mark's y, which is a finite coordinate far
  below the pane, so the "heading for…" mark is published off the visible pane.
- **The grip only appears when price 0 is on the pane** — a price scale dragged
  down to zero — because the handle pass filters on the pane's own bounds.
  Off-pane, the order simply has no chart handle. Verified in this worktree:
  with a scale that shows price 0, the pre-fix chart renders
  `<button aria-label="Move SELL LONG order at 0 with Ctrl or Alt drag">`.
- **The tests could not see any of this.** The chart suite's shared props mock
  `onOrderLift` as `async () => ({ ok: true })`: every lift confirms, whatever
  the order, so no chart test could ever witness the real lift refusing.

## What Changes

- An order whose resting price is not positive offers **no drag grip**. It stays
  drawn where the pane shows it and keeps its cancel control, on the bare plate
  an exchange-managed order is drawn on, and says accessibly that it cannot be
  moved by dragging. No promise is made that the lift path would refuse.
- `beginOrderDrag` refuses a non-positive resting price outright, so no drag
  begins on such an order and no pending mark is ever published at the
  y-coordinate of price 0.
- The lift path's own refusal stays, unchanged, for lifts that are genuinely
  broken in other ways — a ceiling lowered under a resting order still refuses
  before anything is cancelled, in the bound's own words.
- The chart suite gains a test wired to the **real** drag hook instead of the
  `{ ok: true }` mock, asserting the real refusal: nothing cancelled, the
  refusal stated, the grip left standing.

## What this is not

Not a change to the drag hook or the drag arithmetic: `useFuturesOrderDrag` and
`futuresOrderDrag.js` are untouched, and their refusal remains the safety net
for any caller that still asks. Not a reclassification of stop-market orders —
they stay `REGULAR`, cancellable through the regular endpoint.

## Impact

- `src/components/features/futures/FuturesWorkstationChart.jsx` — the grip is
  conditional on a positive resting price; `beginOrderDrag` refuses a
  non-positive one.
- `src/components/features/futures/FuturesWorkstationChart.test.jsx` — two
  biting tests (no grip, no drag and no pending mark) plus the un-masked
  real-hook refusal test.
- Spec delta: `futures-order-visibility` — "Chart interactions respect order
  source semantics" gains the no-resting-price case.
- Raised by the 2026-08-19 audit of 32b9da8 ("fix: finish futures order
  values") and the drag hook.
