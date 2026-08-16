## Why

Two readings the operator raised on 2026-08-16, while the desk was running.

**The size was two values pretending to be one.** The rail holds a size — say
17 000 USDT — and a gesture then opens the confirmation at the cursor with its
own slider. Moving that slider resized the pending order and nothing else, so the
rail went on showing 17 000 while the order about to be sent was for something
different. Both numbers were on screen at once, and the one the operator had set
deliberately was the one that was wrong.

Nothing was ever *sent* wrongly — the confirmation sends what the confirmation
shows, and `futures-order-entry-fidelity` already holds that line. The defect is
that the desk stated two sizes and did not say which one it meant.

**A resting order was drawn heavier than anything else on the chart.** Every
overlay is one pixel — drawings, alerts, the entry band, the liquidation line —
except a working order, at two. Against candles a few pixels wide that reads as a
band rather than as a price, and it covers the bars sitting at exactly the level
the operator is watching when the order is about to fill.

## What Changes

- Resizing on the confirmation carries the new size back to the rail, so the two
  surfaces state one number. The **amount** is carried rather than the percent:
  the rail's slider is a share of the available balance and an exit's slider on
  the confirmation is a share of the position being closed, so the percentages
  measure different things while the amount means the same on both.
- A resting order's line is drawn at one pixel, like every other overlay.

## What does not change

- What is sent. The confirmation still sends exactly what it displays.
- The line drawn *while dragging* an order stays heavier. That one marks an
  action in progress rather than a standing fact, and it is on screen only while
  the operator is holding it.

## Impact

- `src/components/features/futures/FuturesTradingTicket.jsx` — the confirmation
  resize writes the rail's own notional.
- `src/components/features/futures/FuturesWorkstationChart.jsx` — one line width.
- Adds a requirement to `futures-order-entry-fidelity` and one to
  `futures-workstation-presentation`.
