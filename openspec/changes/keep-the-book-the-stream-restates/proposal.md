## Why

The operator asked why the desk cannot zoom the book out the way the Binance app
does: «а как тогда в самом приложении бинанса я могу смотреть стакан больше чем
на 100%?»

Because the desk throws the far book away, on every frame, on purpose.

**The snapshot page is not the exchange's book.** `/fapi/v1/depth?limit=1000` is
one page, and `@depth@100ms` is not bounded by it. Measured on AKEUSDT through
the desk's own proxy on 2026-08-13, the diff stream carried **8196 levels outside
the snapshot band in sixty seconds — 5645 of them resting orders** — reaching
87.55% below the best bid and 217.86% above the best ask.

**The desk drops every one of them.** `applyLevels` refuses any level outside the
band a snapshot proved (`electron/services/futures-workstation-order-book.js:176`),
and `trimSide` keeps only the nearest thousand a side
(`:168`). Both were written for a good reason — a grouped row drawn across levels
whose neighbours were never read understates the market — and together they cost
almost the whole book. Applying the same stream without the filter for three
minutes:

| Side | levels held | reach | share of resting USDT inside the nearest 1000 |
|---|---|---|---|
| AKEUSDT bids | 2431 | 83.96% | 17.7% |
| AKEUSDT asks | 3183 | 1078.75% | 7.1% |
| BTCUSDT bids | 3397 | 98.41% | 12.3% |
| BTCUSDT asks | 3425 | 66.67% | 16.2% |

The desk is discarding between four fifths and nine tenths of the resting
liquidity by value — and the whole book, on a memecoin and on BTCUSDT alike, is
three thousand levels a side. It was never expensive to keep. What was expensive
was the *delivery*, and the range bound already fixed that.

**The reason for dropping them is worth keeping; the conclusion is not.** A level
the stream has restated is exact: the exchange named its price and its quantity.
What is unknown is the levels the stream has *not* named, and beyond the snapshot
band there are some. So a far row can understate — and an absent far row
understates by all of it. Showing nothing is not the safe choice over showing
something incomplete; it is the same error, total. The honest answer is to draw
the far book and say where the proven part ends.

**Delivery cannot stay raw.** The panel draws rows; the transport carries levels;
the two are reconciled by the range the panel states and a ceiling of a thousand
levels a side, nearest-first. Once the book reaches past 80% of price, a coarse
step asks for a range holding far more than a thousand levels, and nearest-first
selection returns a dense cluster around the mid and nothing at the far rows —
exactly the empty book this change exists to fill. So the book crosses as the
rows the panel draws rather than as the levels behind them: the panel already
states the step and the row count that define them, the grouping is the same
exact-decimal pass either side of the transport, and forty rows are a twentieth
of the bytes of a thousand levels.

## What Changes

- A level the stream restates is kept wherever it rests. The band no longer
  filters what is applied.
- The band stays, and states what it always meant: the stretch of price the desk
  can account for completely. Beyond it the book holds what the stream has said
  since, which is exact per level and silent about levels nobody has touched. The
  delivery says where that boundary is, and the panel marks it, so a far row is
  read as what it is.
- Retention is sized for the book the exchange actually streams rather than for
  one page of it, and evicts by distance from the mid only once past that.
- The book crosses to the renderer as grouped rows — price, resting size, the
  bucket key an order is matched by — built by the same exact-decimal grouping
  the panel uses today, against the step and row count the panel states.
- The grouping ladder, which `end-the-book-where-the-market-does` cut to the
  reach of the book on hand, lengthens on its own as the book does: no rung is
  added or moved here.

## Non-Goals

- No new read at the exchange, and no change to the page ladder. This is the
  stream the desk is already subscribed to, applied instead of discarded.
- The snapshot and its bridge are unchanged. The band is still established the
  same way and still re-read the same way — `keep-the-book-under-the-market`
  settles when.
- The panel's own reading of a row — size in USDT, the cumulative column, walls,
  the pressure split — is unchanged in what it means. It is computed from rows
  that arrive grouped rather than from levels it groups itself.
