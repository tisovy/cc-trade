# Keep Restarted Edge Rounds Open

## Why

`finish-break-even-rounds` taught the fold to restart a tentative round when
later evidence disproves it: window-edge sells first read as a short entry
become exits of an older long, and the disproving buy becomes an add to that
long. The restart sets `partial` unconditionally — and `partial` is also the
flag that (a) stops the fold from tracking the running position and (b) makes
`finishRound` publish the round closed.

Two defects follow, both reproduced against the current code with a driver:

1. **A phantom closed round while the position is live.** A pre-window long,
   partly sold at break-even, then added to at a different price, and the
   window ends there. The fold publishes one **closed** LONG round — quantity
   4, PnL 0 — while the operator is holding twelve contracts, and the six that
   were added appear held nowhere. Before `finish-break-even-rounds` this
   artifact was at least open and therefore filtered out of the
   closed-position review; the regression files it among real closed trades.

2. **The re-close absorbs fills it has disproved.** After the restarted round
   has closed everything it added, a genuinely new same-side order is still
   absorbed as more exits of the old position: the driver shows a closed long
   of quantity 25 where 20 were ever closed — five contracts of a new short
   folded in as exits — and the short's own round left holding only its
   closing fill.

The round already carries the number that settles both: `heldAtoms`, exactly
the added size still held after the restart.

## What Changes

- A restarted window-edge round holding any of what it added is published
  **open**, at the end of the fills and when an increasing fill follows a
  partial re-close.
- Once the restarted round's added size is fully closed again, a further
  reducing fill is not absorbed on faith: the round ends there and the fill
  opens a new round read on its own evidence — the existing window-edge logic
  then classifies it correctly on both sides.
- `futures-order-visibility`: the restart requirement states both, with a
  scenario for each.

## What this is not

Not a change to how the restart itself is decided, to hedge-leg handling, or
to the entry-price recovery from realized PnL. The known limitation stands
that a position opened before the window is sized only by what the window
shows.

## Impact

- `src/utils/futuresTradeRounds.js` — the fold's finish decisions.
- `src/utils/futuresTradeRounds.test.js` — two biting cases.
- Sole production caller is `FuturesHistoryPanel.jsx` (verified by grep; the
  GitNexus index misses these imports and was not consulted).
- Modifies one requirement in `futures-order-visibility`.
