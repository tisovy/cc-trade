## Why

The order review shows eight columns in a panel that cannot fit them, and the
column it drops is the one the review exists for.

Observed on the live desk (operator screenshot, 2026-08-10) and confirmed in the
source:

- **The outcome is off the right edge.** The table declares eight tracks whose
  minimum widths total about 678 px plus gaps
  (`src/components/features/futures/FuturesWorkstation.css:1836`), inside a dock
  panel that holds roughly 690 px because the dock splits its width between two
  panels (`:1157`, `minmax(0, 1.35fr) minmax(0, 1fr)`). `Status` — the last
  column — is beyond the edge and reachable only by scrolling sideways, which
  nothing indicates. What is left on screen is a list of orders with no
  outcomes.
- **`0 / 9080` means two different things.** `Filled` renders
  `executedQty / origQty` (`FuturesHistoryPanel.jsx:261`), so an order cancelled
  without a fill and an order still working read identically — and the column
  that would separate them is the one that is off-screen.
- **The numbers are in the wrong unit and overflow anyway.** Every size on this
  desk is stated in USDT; this column states contracts, and a pair like
  `404015 / 404015` ellipsizes to `404015 / 4040…` in a 96 px track.
- **Two rows can be read on different scales.** A row from today shows a time and
  an older row shows a date (`formatTime`, `:24`), in one undivided list, so
  `20:42:12` and `09.08` sit one above the other with nothing saying they are
  different kinds of stamp.
- **`· RO` is unexplained** (`:256`) and carries no label for a reader who does
  not already know it means reduce-only.
- **Everything is equally loud.** A cancelled order that did nothing has the same
  weight as a full fill, so the eye has no way into the list.

How other desks solve the same problem: Binance Futures, Bybit and OKX all keep
the status inside the row (never behind a scroll), state the fill as a
proportion of the order rather than as a raw pair, and give the review the full
width of the workspace rather than half of a dock. The adaptation this desk needs
is not more columns — it is fewer columns, each carrying its secondary detail
inside the cell.

## What Changes

- The history view takes the whole dock width while it is open, so its columns
  have room; the live positions panel returns when the working-orders view is
  selected.
- The review is rebuilt around six columns instead of eight, with the outcome
  leading: `Outcome · Contract & side · Time · Type · Size · Price`.
- The outcome is a coloured chip — filled, partly filled, cancelled, expired —
  and is never the column that falls off an edge.
- Size is stated in USDT with the fill as a proportion (`filled 100 %`,
  `filled 8 %`, `not filled`); the exact contract counts stay in the cell's
  title, as sizes do elsewhere on this desk.
- Price carries the order's own price, with the average achieved beneath it when
  the two differ, so two price columns become one reading.
- Rows are grouped under a day heading, so a time-only stamp is unambiguous.
- An order that did nothing is dimmed; an order that filled is not.
- Reduce-only becomes a labelled badge rather than an abbreviation.
- A filter selects all, filled only, or cancelled only, and optionally the
  contract on screen — a review of a session is read by narrowing it.

## Capabilities

### Modified Capabilities

- `futures-order-visibility`: what an order review states, and that its outcome
  is always readable without scrolling.
- `futures-workstation-presentation`: the width the history view occupies.

## Impact

- `src/components/features/futures/FuturesHistoryPanel.jsx`,
  `FuturesPortfolioDock.jsx` (which panel holds the width),
  `FuturesWorkstation.css` (the grid and the day headings).
- Presentation only: no reading changes value, and no command is issued from this
  panel.
- Layout is measured in Chromium against the widths the operator actually uses,
  not in jsdom, which computes none.
