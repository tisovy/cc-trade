## Why

A position closed at exactly the price it was entered at realizes nothing, and
so the desk reads it as a position being opened in the other direction.

Found on 2026-08-16 by the sweep that re-checked the stated limits of
`tell-a-reversal-from-a-window-edge`, and written down there as limit 3.4 rather
than fixed, because fixing it is a rule about how a round *opens* where that
change's whole argument was a rule about how one closes. This is that change.

The evidence a fill closed something is that it realized something
(`futuresTradeRounds.js:59`). That holds everywhere except on the one number it
cannot tell apart: an opening fill reports `realizedPnl` of 0, and so does a
close at the position's own average entry. Inside the window it does not matter —
the walk has the position's opening fills in hand and knows the size. At a window
edge it has nothing else to go on, and it guesses the opposite position.

Driven against the module as it stands. A long of ten held at 100 before the
read's window, four sold at 100 inside it, then the remaining six sold at 120:

| what the exchange settled | what the review shows |
|---|---|
| a long of ten, entered at 100, closed at an average of 112 | nothing |
| 120 of realized PnL | 0 |

The walk opens a *short* of four at 100, folds the six sold at 120 into it as
though they added to that short — an increasing fill carries no realized PnL, so
the 120 is dropped on the floor — and leaves the round open. The closed-position
tab keeps `!open && exitPrice !== null` (`FuturesHistoryPanel.jsx:239`), so the
row and its profit leave the review entirely. The mirror on a short does the
same. One cent off break-even the same session reads correctly, entry recovered
at 100 and 120.04 realized, which is what makes this a knife edge rather than a
slope.

It is not unreachable. Scratching out of a position carried over from before the
read — out at cost, then out of the rest when it moves — is exactly this shape,
and "out at cost" is a thing operators do on purpose.

## What Changes

- The fills that follow settle what the fill's own realized PnL cannot. Inside a
  run of fills on one side the position only ever moves one way, so a later fill
  in that run realizing anything at all proves the run is reducing a position
  rather than building one — and a position being reduced that the walk never saw
  opened was opened before this window.
- With that, the round opens as what it is: a close of a position older than the
  window, entry recovered from what the whole run realized, reported closed at
  its true size.
- Where the run says nothing — a break-even close with no fill after it on that
  side — the reading is unchanged. There is no evidence either way, and inventing
  a closed position with no PnL in it would be the same guess in the other
  direction.
- The run stops at the first fill on the other side, so a break-even close the
  operator then *adds* to is still lost. That case does hold evidence, and
  reaching it means re-deciding the side of a round the walk has already folded
  fills into, which is a mechanism of its own. Stated with its numbers in
  `tasks.md` §3.2 rather than half-built here.

## Impact

- `src/utils/futuresTradeRounds.js`, at the point a round opens. One production
  consumer: the closed-position tab of the futures history panel.
- Spec: `futures-order-visibility`, the requirement
  `A closed position is what was actually closed`.
- Not hedge-mode accounts. The walk folds a contract's fills without reading
  which leg they belong to, which is wrong for a hedge account well before this
  change and is not made worse by it — the new rule reads the leg, so it cannot
  fire across two of them.
