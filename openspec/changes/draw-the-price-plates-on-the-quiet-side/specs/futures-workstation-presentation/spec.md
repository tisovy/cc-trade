# futures-workstation-presentation (delta)

## ADDED Requirements

### Requirement: The chart's own labels keep off the edge prices are worked at

Labels the chart draws on its plotting area — the order handles and what they
are worth, and the open position's entry and liquidation annotations — SHALL be
drawn against the edge holding the oldest candles, not against the edge holding
the newest, because the newest candles are what the operator reads while
placing and moving an order. Their coloured edge SHALL face the line they name,
so a mirrored plate still reads as belonging to its price.

A handle the operator can drag, edit or cancel SHALL NOT be hidden behind an
ambient box the desk writes in the same corner. Where the two land on the same
pixels, the handle SHALL be the one drawn on top.

#### Scenario: A working order and an open position are on screen

- **WHEN** the chart draws a working order's handle and the position's entry and liquidation annotations
- **THEN** each is drawn against the plot's oldest-candle edge, leaving the newest candles and the price scale unobstructed

#### Scenario: A handle lands on a corner the desk is writing in

- **WHEN** an order's price places its handle over the reading notice, the older-candles line, the order-sync line or the gesture hint
- **THEN** the handle is drawn over that box rather than behind it, and stays draggable and cancellable
