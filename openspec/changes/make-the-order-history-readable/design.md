# The order review, column by column

## What a trader is doing when they open it

Three questions, in this order:

1. *Did my orders do anything?* — outcome first.
2. *On what, and which way?* — contract and side.
3. *For how much, and at what price?* — size and price.

Everything else is detail that belongs in a title attribute, not in a track that
competes for width with the answer to question 1.

## The six columns

| # | Column | Width | Primary | Secondary (same cell) | Title |
|---|--------|-------|---------|----------------------|-------|
| 1 | Outcome | 92 px | `Filled` / `Part` / `Cancelled` / `Expired` chip | fill proportion when partial (`38 %`) | exchange status verbatim |
| 2 | Contract & side | 132 px | contract, as the existing button that selects it | `BUY` / `SELL` badge | — |
| 3 | Time | 84 px | time of day, always (the day is the group heading) | — | full local timestamp |
| 4 | Type | 96 px | `LIMIT` / `MARKET` | `reduce-only` badge when set | — |
| 5 | Size | 128 px | notional in USDT | `filled 100 %` / `not filled` | exact contracts, `executed / original` |
| 6 | Price | 116 px | order price, or `—` for a market order | `avg 0.014943` when it differs from the order price | — |

Minimum total ≈ 648 px plus five 8 px gaps ≈ 688 px, which fits the half-dock
the panel has today; at full dock width every column has slack instead of the
current overflow.

## Why the chip and not a text column

A status read as text in the last column is a word among words. As a coloured
chip in the first, it is the thing the eye lands on, and the four outcomes are
distinguishable before any of them is read:

- `Filled` — the desk's positive tone, the same green a buy uses.
- `Part` — the neutral/attention tone, with the proportion beside it.
- `Cancelled` — muted; the whole row is dimmed with it.
- `Expired` / anything else the exchange reports — muted, with the exchange's own
  word in the title.

## Day grouping

```
── Today ─────────────────────────────────────────────
  Filled     BEATUSDT  BUY   20:42:12  LIMIT   250 USDT   1.762
  Cancelled  BEATUSDT  SELL  19:44:55  LIMIT   —          8.120
── 09.08 ─────────────────────────────────────────────
  Filled     BLUAIUSDT SELL  23:11:04  MARKET  5 900 USDT avg 0.014943
```

The heading is what makes a time-only stamp safe. It also gives the list a
rhythm, which a flat 200-row table does not have.

## What moves into titles

- Exact contract counts (`404015 / 404015`).
- The exchange's own status word when the chip generalizes it.
- The full timestamp.
- Order identity, for an operator reconciling against Binance's own screen.

This is the same discipline the closed-positions view already follows: the fee
lives in the PnL cell's title rather than taking a column
(`FuturesHistoryPanel.jsx:164`).

## The filter

A single row of chips above the table: `All · Filled · Cancelled`, plus a
`this contract` toggle that narrows to the contract on screen. Filtering is
local to the held reading — it issues no read, and it must not be confused with
the scope statement beneath the table, which says what the *read* covered.

## What this design does not do

- It does not paginate. The read is bounded already, and the scope line states
  its reach; a page control would imply the desk can fetch more, which is
  `keep-the-history-read-out-of-the-way`'s business, not this one's.
- It does not add sorting. Newest-first is the only order a session review is
  read in; a sortable column is a control nobody uses and a state everybody
  forgets is set.
