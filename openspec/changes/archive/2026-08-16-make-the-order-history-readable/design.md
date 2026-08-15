# The order review, column by column

## What a trader is doing when they open it

Three questions, in this order:

1. *Did my orders do anything?* — outcome first.
2. *On what, and which way?* — contract and side.
3. *For how much, and at what price?* — filled value and price.

Everything else is detail that belongs on the element, not in a track that
competes for width with the answer to question 1.

## The width there actually is

Measured in Chromium against the real stylesheets, not computed from the
declarations:

| viewport | dock | panel | table content |
|---|---|---|---|
| 1280 | stacked | 1242 px | 1222 px |
| 1440 | stacked | 1402 px | 1382 px |
| 1460 | stacked | 1422 px | 1402 px |
| 1461 | split | 605.1 px | **585 px** |
| 1600 | split | 664.3 px | 644 px |
| 1616 and wider | split, workstation capped at 1580 px | 671.1 px | 651 px |

585 px is the budget. Row padding takes 14 px and the tone border 3 px; five
gaps at 6 px take 30 px. **538 px is left for tracks**, and the design spends
502 of it.

## The six columns

| # | Column | Min | Primary | Secondary | On the element |
|---|--------|-----|---------|-----------|----------------|
| 1 | Outcome | 80 px | `Filled` / `Part 38%` / `Open` / `Expired` / `Rejected` chip | — | the exchange's status word verbatim |
| 2 | Contract | 108 px | contract, as the button that selects it | `BUY` / `SELL` badge | the full symbol |
| 3 | Time | 62 px | time of day, always — the day is the group heading | — | full local timestamp |
| 4 | Type | 80 px | `LIMIT` / `MARKET` / `STOP MKT` / `TP MKT` … | `exit` badge when reduce-only | exact exchange type, and `reduce-only` in words |
| 5 | Filled USDT | 84 px | executed notional in USDT | — | exact contracts executed / original, exact USDT, and what the order was placed for |
| 6 | Price | 88 px | order price, or `≈` the average when it differs | — | both readings, named |

502 px of tracks, 549 px with gaps and padding, inside 585 px. At the wide
split (651 px) every track has slack instead of an ellipsis.

## Why the chip and not a text column

A status read as text in the last column is a word among words, and at 62.7 px
it is not even that. As a coloured chip in the first column it is the thing the
eye lands on, and the outcomes are distinguishable before any of them is read:

- `Filled` — the desk's positive tone, the same green a buy uses.
- `Part 38%` — the attention tone, carrying its proportion; this is the one
  reading the old `0 / 9080` pair could never give at a glance.
- `Open` — neutral; the order is still working and has not lost yet.
- `Expired` / `Rejected` / anything else the exchange reports — muted, with the
  exchange's own word on the element.

`Cancelled` is not among them: `futures-order-visibility` omits cancelled rows
from the review, and that stands.

## Why `Filled USDT` keeps its meaning

`futures-order-visibility` already requires this column to state the USDT
notional that actually executed, sourced from the exchange's cumulative quote
amount or derived from executed quantity and average fill price. That
requirement is not disturbed: the column keeps its reading and its
USDT-labelled header. What changes is that the *proportion* of the order it
represents moves to the chip, where it costs no width, and what the order was
originally placed for joins the exact contract counts on the element.

## Reduce-only in words

`· RO` is an abbreviation the row never expands. The word for what a
reduce-only order is, on a desk that already computes it, is **exit**: it can
only close a position. So the Type cell carries an `exit` badge, the cell's
title says `reduce-only` in full, and the column header says it once for the
table. Nothing on screen is an unexplained pair of letters.

## Day grouping

```
── Today ─────────────────────────────────────────────
  Filled     BEATUSDT  BUY   20:42:12  LIMIT       250.00   1.762
  Open       BEATUSDT  SELL  19:44:55  LIMIT       —        8.120
── 09.08 ─────────────────────────────────────────────
  Part 38%   BLUAIUSDT SELL  23:11:04  MARKET      5.9K     ≈0.014943
```

The heading is what makes a time-only stamp safe. It also gives the list a
rhythm, which a flat 200-row table does not have. The closed-position review
gets the same headings, because it has the same two-scales problem.

## What moves onto the element

- Exact contract counts, and what the order was placed for.
- The exchange's own status word when the chip generalizes it.
- The exchange's own order type when the column shortens it.
- The full timestamp.
- The full symbol when the track cuts it.

This is the same discipline the closed-positions view already follows: the fee
lives in the PnL cell's title rather than taking a column.

## The filter

A single row of chips above the table: `All · Filled · Unfilled`, plus a
`This contract` toggle that narrows to the contract on screen. Filtering is
local to the held reading — it issues no read, and it must not be confused with
the scope statement beneath the table, which says what the *read* covered.

There is no `Cancelled` filter, because there are no cancelled rows to filter.

## What this design does not do

- It does not widen the dock. Measured, nothing overflows; and the live
  positions panel is what the operator watches continuously.
- It does not paginate. The read is bounded already, and the scope line states
  its reach; a page control would imply the desk can fetch more, which is
  `keep-the-history-read-out-of-the-way`'s business, not this one's.
- It does not add sorting. Newest-first is the only order a session review is
  read in; a sortable column is a control nobody uses and a state everybody
  forgets is set.
