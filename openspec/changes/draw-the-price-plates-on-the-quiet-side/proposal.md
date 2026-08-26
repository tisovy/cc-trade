# Draw the price plates on the quiet side

## Why

The operator sent a screenshot on 2026-08-26: a working order's handle
(`SHORT · 31215 USDT · ×`) and the open position's `ENTRY SHORT` label sit
against the right edge of the plotting area, on top of the newest candles —
which is where price is being read and where the next order is placed or
dragged. "Плашки … мешают когда я ставлю или двигаю ордера": the labels
obstruct the only part of the chart the operator is acting on.

The chart already holds the rule that answers this, written where the reading
notice is placed: *"Top-left, not top-right: the price scale is drawn on the
right and is the one part of the chart the operator reads levels off. The
oldest candles are here, and they are the ones nobody is picking a price
from."* Every ambient box on this chart follows it — the reading notice, the
older-candles line, the order-sync line, the gesture hint. The price plates,
which are the most opaque things drawn on the plot and the only ones the
operator physically reaches for, never got it.

## What Changes

- The open position's entry and liquidation annotations, and every order
  handle drawn on the plot — working, exchange-managed, and the one following
  the pointer during a drag — are drawn against the **left** edge of the
  plotting area instead of the right, mirrored so their coloured edge still
  faces the line they belong to.
- An order handle is never hidden behind an ambient corner box. The layer that
  carries the handles and annotations stacks above them: the handle is a
  control the operator drags and cancels with, the boxes are text the desk
  writes, and the left side now carries both.

## Non-goals

The price-scale plates the charting library draws in the axis gutter (the
coloured `0.09938` beside the last price, the entry and liquidation plates)
are the axis, not the plot, and are unchanged — the operator reads levels off
them. Nothing changes about what a handle says, what it is worth, how large it
is drawn, or how it is dragged, edited and cancelled.
