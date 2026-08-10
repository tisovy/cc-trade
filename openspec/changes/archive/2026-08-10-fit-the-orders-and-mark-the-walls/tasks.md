## 1. The Working-Orders List Fits Its Rail

- [x] 1.1 Name the columns once at the head of the list — `Symbol`, `Side`,
  `Price`, `USDT` — and drop the unit from every row. The list becomes a table
  with the same roles the dock's tables already use.
- [x] 1.2 Price each row through the contract's tick where it is known, and
  through the float-noise trim where it is not, instead of printing the
  exchange's padded string.
- [x] 1.3 Drop the `USDT` quote suffix from the symbol cell, keeping the whole
  name on its title.
- [x] 1.4 Bound every grid track and let each cell ellipsize its own content, so
  no column can be squeezed out by another and the cancel control keeps its
  width.
- [x] 1.5 Keep the exact contract count a hover away on the size cell, as the
  dock's own order table already does.

## 2. The Book Marks Its Walls

- [x] 2.1 Rank the visible levels on each side by resting USDT and mark the five
  heaviest. Ties are kept whole; a side with no more levels than walls is left
  unmarked.
- [x] 2.2 Thicken the size cell only, and lift it out of the muted column colour
  so the weight reads as a mark rather than as a rendering accident.
- [x] 2.3 Compute the ranking over the levels actually on screen, so changing the
  grouping step or the side mode re-ranks with them.

## 3. Verification

- [x] 3.1 `npx vitest run` over this change alone — 86 files, 1,081 passed,
  including a case for the named columns, the trimmed price, the shortened
  symbol, the five marked sizes, a tie, and a side too short to have walls. Run
  against an extract of the commit rather than the working tree, which carries a
  second session's work in the same files.
- [x] 3.2 `eslint` clean on every file this change touches.
- [x] 3.3 `npm run check:futures-production` passes.
- [x] 3.4 Operator confirms on the live account that the orders list fits without
  wrapping or collision, and that the marked levels are the ones they would have
  picked out by eye. — closed by the operator on 2026-08-10 rather than reported checked.

## 4. Stated Limits, Not Fixed Here

- [ ] 4.1 The ticket knows only the selected contract's tick size, so an order on
  another contract is priced with its float noise trimmed rather than at that
  contract's precision. Every significant digit the exchange sent is kept.
- [ ] 4.2 A contract quoted in something other than USDT keeps its whole name in
  the symbol cell. Only the `USDT` suffix is dropped.
- [ ] 4.3 The dock's own working-orders table is a wider surface and was left as
  it is.
- [ ] 4.4 Walls are ranked by the level's own resting value, not by how it
  compares with the level beside it: five adjacent heavy levels are five walls.
