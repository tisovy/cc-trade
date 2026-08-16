## Why

The closed-position review folds fills back into the positions they were, and
one check decides its hardest case. A fill that reduces more than the fills in
hand show is held has two readings: the position reversed, or it was bigger than
the read's window shows and the excess is closing what was open before the window
began. The exchange settles which — realized PnL is reported per fill against the
position's own average entry — so `flipIsConsistent`
(`src/utils/futuresTradeRounds.js`) compares the fill's realized PnL against what
the round was entered at.

It compares against the wrong average. The check divides the round's cumulative
entry notional by its cumulative entry size: the average over everything the
round ever entered. The exchange settles against the average of what is *still
held* — a close does not move that average, a later entry does. The two are the
same number until a position is scaled out of and back into at a different price.

Measured on 2026-08-16 against `a4a3086`, four thousand random sessions of a
simulated account that starts and ends flat, so no round in any of them can
honestly be older than the window:

| | sessions |
|---|---|
| a real reversal filed as a pre-window remainder | **137 of 4 000** |
| a round left open, and so dropped from the tab entirely | 4 of 4 000 |
| realized PnL not adding up to what the exchange reported | 1 of 4 000, off by 50 |

The smallest case that shows it: buy 10 at 100, sell 9 at 100, buy 9 at 200, sell
12 at 200, buy 2 at 150. The account held ten at 190, reversed into a short of
two, and closed it. The review shows **a closed long of twenty-one units** at
152.38 → 157.14 where nineteen were traded at 147.37 → 152.63, and marks *both*
rounds "recovered from the realized PnL" — a label that says their opening fills
are older than the read, when every one of them is right there in the window.
Twenty-one units were never held; ten was the most the account ever carried.

Stop one fill earlier — the operator still holding the short they reversed into —
and the tab shows that phantom long of twenty-one as a *closed* position while
the real position is open and, being open, is not in this tab at all. That is the
worse of the two: not a wrong row about the past, but a finished position stated
beside a live one that contradicts it.

(An earlier wording of this, in the message of the commit that fixed it, said the
short was missing from the five-fill case. It is not: it is shown, with its own
numbers right and its label wrong. The missing short belongs to the four-fill
case above, and it is missing because it is still open, which is what this tab
is supposed to do. Caught by the neighbouring session reproducing the case
independently rather than reading the claim.)

And it does not stop at one row. Once the walk decides a round is a pre-window
remainder it stops tracking that round's exposure, so every later reducing fill
on that contract folds into the same phantom position until an opening fill ends
it. That is the path by which a session's realized PnL stops adding up and a
position disappears from the review altogether.

This is the tab the operator reviews a session with. Nothing here places an order
or reads the exchange; it is arithmetic on fills already in hand, and it is wrong
about 3.4% of the time.

Found by auditing the two areas of the history this desk had not audited, after
`keep-the-history-read-out-of-the-way` was archived.

## What Changes

- The reversal check compares against the average entry of what is still held,
  maintained the way the exchange maintains it: moved by an entry, untouched by a
  close.
- What the row *reports* as its entry is deliberately not changed. That stays the
  average over everything the round entered, which is the figure that makes exit
  minus entry, times size, come to the round's own realized PnL.

## Impact

- Affected specs: `futures-order-visibility` — the requirement "A closed position
  is what was actually closed" already says what should happen; it gains the
  sentence naming which average decides it.
- Affected code: `src/utils/futuresTradeRounds.js` and its test.
- Display only: no order, no read, no command. What changes is what the operator
  is told they did.
