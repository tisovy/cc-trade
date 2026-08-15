## Why

The order review shows eight columns, and the two that say what became of an
order are cut to nothing on exactly the windows the operator works at.

This change was first written from a screenshot on 2026-08-10, against a table
whose eight declared minimum tracks came to about 678 px in a panel that held
roughly 690 px. That table is gone: `54b4351` retuned the tracks to 508 px, and
the overflow with it. The proposal has been rewritten against what the desk
actually renders, measured rather than recalled.

**Measured in Chromium at eight widths from 1280 to 2560 px**, against the real
stylesheets and the real markup:

| viewport | dock | history panel | table |
|---|---|---|---|
| 1280–1460 | stacked, one column | 1242–1422 px | nothing clipped |
| 1461 | split 1.35fr / 1fr | 605 px (585 content) | Status, Type clipped |
| 1600 | split | 664 px | Status, Type clipped |
| 1616–2560 | split, capped at 1580 px | 671 px (651 content) | Status, Type clipped |

- **Nothing falls off the right edge any more.** At all eight widths the table's
  `scrollWidth` equals its `clientWidth`: it does not scroll sideways, and no
  declared column is outside the visible area. The premise this change was
  written on is spent.
- **The outcome is cut instead of dropped, and nothing can recover it.** Above
  1460 px the dock splits and the Status track is 62.7–72.0 px, while
  `PARTIALLY_FILLED` and `EXPIRED_IN_MATCH` each need 125 px. They render as an
  ellipsis, and `FuturesHistoryPanel.jsx:322` puts no title on the cell — so the
  exchange's own word is not merely cut, it is unrecoverable. This is the case
  `futures-workstation-presentation`'s own requirement *A reading is never
  silently sliced by its column* forbids.
- **Type is cut the same way.** The track is the same 62.7–72.0 px;
  `STOP_MARKET` needs 86 px and `LIMIT · RO` needs 78 px. Also with no title.
- **It is the wide window that is broken, not the narrow one.** Below 1461 px
  the dock stacks into one column, the panel gets the whole 1242–1422 px, and
  every reading fits. An operator who narrows the desk to check gets a table
  that works.
- **`· RO` is unexplained** (`:319`) and carries no label for a reader who does
  not already know it means reduce-only.
- **Two rows can be read on different scales.** A row from today shows a time
  and an older row shows a date (`formatFuturesDeskTime`), in one undivided
  list, so `20:42:12` and `09.08` sit one above the other with nothing saying
  they are different kinds of stamp.
- **Everything is equally loud.** An order that expired without executing has
  the same weight as a full fill, so the eye has no way into the list.

How other desks solve the same problem: Binance Futures, Bybit and OKX all keep
the status inside the row as a coloured chip rather than as a word in the last
column, and state the fill as a proportion rather than as a raw pair. The
adaptation this desk needs is fewer columns, each carrying its secondary detail
inside the cell, in the width the panel already has.

## What Changes

- The review is rebuilt on six columns instead of eight, with the outcome
  leading: `Outcome · Contract & side · Time · Type · Filled USDT · Price`.
  Measured minimum 502 px of tracks — 549 px with gaps and padding — inside the
  585 px the panel holds at its narrowest split width.
- The outcome is a coloured chip — filled, partly filled with its proportion,
  still open, expired, rejected — and the exchange's own word is on the element
  whether or not the chip generalized it.
- The order's type is stated in a form that fits its track, with the exact
  exchange type on the element.
- Reduce-only stops being an unexplained `· RO` and becomes the word for what it
  is: the order is marked as an exit, with `reduce-only` stated on the element.
- The average fill price folds into the price cell, so two price columns become
  one reading: the price the order was placed at, or the price it actually got
  when the two differ, with both stated on the element.
- Rows are grouped under a day heading and every row shows its time of day, so a
  time-only stamp is unambiguous. The closed-position review is grouped the same
  way, for the same reason.
- An order that executed nothing is dimmed; an order that filled is not.
- A filter selects all, filled only or unfilled only, and optionally narrows to
  the contract on screen — a review of a session is read by narrowing it.

**Cancelled orders stay out of the review.** `futures-order-visibility` already
requires the presentation to omit them, and the operator confirmed on
2026-08-15 that this stands. The outcome chip therefore never reads `Cancelled`,
and there is no cancelled-only filter. The held reading, the persisted records
and the coverage cursors keep those rows exactly as they do now.

**The dock is not widened.** An earlier draft of this change gave the review the
whole dock width while it was open. The measurement above removed the reason —
nothing overflows — and the operator declined the trade on 2026-08-15: the live
positions panel is what is watched continuously, and it is not worth displacing
for a review.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: what an order review states — its outcome, the
  price it got, and the day a row belongs to.
- `futures-workstation-presentation`: a reading cut by its column keeps the
  exchange's own word on the element.

## Impact

- `src/components/features/futures/FuturesHistoryPanel.jsx`,
  `FuturesWorkstation.css` (the grid, the chip, the day headings, the filters).
- Presentation only: no reading changes value, no command is issued from this
  panel, and narrowing issues no exchange read.
- Layout is measured in Chromium against the widths the operator actually uses,
  not in jsdom, which computes none.
