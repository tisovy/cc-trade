## Why

The operator asked for the book to zoom out further: "на аке в стакане
максимальный шаг — 0.00005 — по графику это всего 10% цены наверх", and, asked
how far they wanted to be able to read, answered "думаю максимально — 75% +-, тк
иногда я глубоко просматриваю книгу когда ставлю далекие ордера на пробивы
уровней".

**The coarsest step the panel offers asks for more book than the desk holds.**
Fourteen rows of 500 ticks span 9.06% of price on AKEUSDT, 1.10% on BTCUSDT,
3.71% on ETHUSDT, 181% on TUTUSDT. What the desk holds is one snapshot page —
the thousand levels Binance serves — which on the same contracts spans 3.90%,
0.19%, 0.55% and 28.35%. So on every contract measured, the last rung asks for
several times what the panel can fill, and the operator is shown six rows of
book over eight blank ones.

The ladder is offered against a fact it does not know. It is a list of tick
multiples, fixed at build time, and how much book a tick multiple reaches is a
property of the market. This change gives the panel that fact and ends the ladder
where the book it can draw from ends.

### What this change first claimed, and what the measurement said

This proposal was first written as *"seventy-five per cent of price is not a book
anyone can draw"*, on the grounds that a thousand levels a side is the whole of
what Binance publishes. The operator asked the obvious question — «а как тогда в
самом приложении бинанса я могу смотреть стакан больше чем на 100%?» — and they
were right.

A thousand levels is what one *snapshot page* holds. The diff stream is not
bounded by it. Measured on AKEUSDT through the desk's own proxy on 2026-08-13,
`@depth@100ms` carried **8196 levels outside the snapshot band in sixty seconds,
5645 of them resting orders**, reaching 87.55% below the best bid and 217.86%
above the best ask. Binance's own app draws the far book because it keeps what
the stream restates. The desk drops it, at
`electron/services/futures-workstation-order-book.js:176`, and keeps only the
nearest thousand levels a side.

Held for three minutes, the whole book is small and reaches far:

| Contract | levels held | reach | of resting USDT inside the nearest 1000 |
|---|---|---|---|
| AKEUSDT bids | 2431 | 83.96% | 17.7% |
| AKEUSDT asks | 3183 | 1078.75% | 7.1% |
| BTCUSDT bids | 3397 | 98.41% | 12.3% |
| BTCUSDT asks | 3425 | 66.67% | 16.2% |

So the desk is discarding four fifths of the resting liquidity by value, and the
reach this change cuts the ladder against is a limit of the desk's own making,
not the exchange's. Widening it is `keep-the-book-the-stream-restates`, which
follows this one; the mechanism here is what keeps the ladder honest about
whatever the book turns out to hold, before and after that.

## What Changes

- The delivered book states how far the book the desk holds reaches on each
  side. It is stated only once no deeper page can be bought, because until then
  a wider reading is one read away and the ladder should not be cut against a
  page the operator can still ask to deepen.
- The grouping ladder ends at the coarsest step whose rows fit inside that reach.
  A step that would ask for rows the desk cannot fill is not offered.
- The ladder gains the rungs that make the cut land near the reach rather than
  well short of it. Between 100 and 500 ticks there was a fivefold jump, so a
  contract whose reach falls anywhere inside it dropped to 100 — on AKEUSDT, from
  3.9% held down to 1.8% offered. 200 and 1000 are added; no existing rung moves,
  so no stored preference is invalidated.
- A stored step coarser than the ladder currently offers is drawn at the coarsest
  step it does offer, and the stored preference is left as it is. A reach that
  narrows for a moment then costs the operator a redraw rather than a setting.
- The panel states the reach, so how far the book goes is a reading on screen
  rather than something inferred from where the rows stop.

## Non-Goals

- The book is not widened here. That the desk holds one page of a book the
  exchange streams in full is a separate defect with its own change; this one
  makes the ladder state the truth about whatever is held.
- Levels beyond the band are still dropped here. The reach is stated as a fact
  about the book on hand, not as permission to draw across gaps.
- The delivered state is not touched. `keep-the-book-under-the-market` settles
  when a band is re-read.

## Notes

This change modifies `The order book is denominated in USDT and groupable`, which
`send-only-the-book-on-screen` also modifies and which has not archived: its
operator check is still open. The delta below carries that change's text in full
and adds to it, so the two apply in either order without losing each other.
