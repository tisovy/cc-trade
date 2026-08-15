## Why

The desk does not fit its window, and what it hides first is the contract's own
numbers. The operator's screenshots show the market header with `LAST`, `24H
CHANGE`, `24H HIGH`, `24H LOW`, `24H VOLUME`, `FUNDING` and `NEXT FUNDING`
labelled — and every value under a scrollbar, unreadable.

Three rules in the stylesheet produce it:

- **The header clips instead of pushing.** `.futures-workstation-market-header`
  is `overflow-x: auto` (`FuturesWorkstation.css:475`). CSS computes the other
  axis to `auto` as soon as one of them is not `visible`, so the header scrolls
  *vertically* the moment the grid gives it less height than its content — which
  is exactly what a squeezed `auto` row does.
- **The grid is taller than the window it is told to fit.** The workspace is
  `height: calc(100vh - 90px)` above 760px wide, while its rows are
  `auto auto minmax(420px, 1fr) auto auto` and the whole grid carries
  `min-height: 690px`. A 420px floor under the chart plus a fixed 260px dock
  plus the header rows exceeds a short window, so the rows compress and the page
  gains a scrollbar of its own.
- **The instrument rail scrolls as a whole.** `overflow: auto` on the rail
  (`:209`) means the trading ticket scrolls away with the contract list rather
  than the list scrolling inside a rail that stays put.

The operator's instruction is precise, and it is the right shape for a desk:
nothing scrolls except the things that are genuinely unbounded — the tape, the
dock's tables, and the contract list. Everything else is a panel that must fit
or shrink.

## What Changes

- **The header shows its values.** It sizes to its content, wraps rather than
  clips, and never hides a number behind a scrollbar.
- **The desk fits the window.** The chart absorbs the remaining height instead
  of imposing a floor on it, and the grid stops being taller than the box it is
  told to fill.
- **Scrolling is confined to what is unbounded.** The contract list, the
  aggregate tape and the dock's tables scroll inside themselves. The rail, the
  ticket, the header, the chart column and the book do not.
- **What cannot fit shrinks rather than disappears.** Where a panel runs out of
  room, its rows are reduced — the book already measures how many fit — rather
  than the panel clipping content the operator was reading.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the workspace fits the window it is given,
  and scrolling belongs to the unbounded lists rather than to the desk.

## Impact

- `src/components/features/futures/FuturesWorkstation.css` — the grid rows, the
  header's overflow, the rail's overflow, and the panels' minimum heights.
- Measured in Chromium against the real stylesheet at the operator's window
  sizes; jsdom has no layout engine and cannot answer any of this.
