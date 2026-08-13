## Why

The operator asked for the book to zoom out further: "на аке в стакане
максимальный шаг — 0.00005 — по графику это всего 10% цены наверх", and, asked
how far they wanted to be able to read, answered "думаю максимально — 75% +-, тк
иногда я глубоко просматриваю книгу когда ставлю далекие ордера на пробивы
уровней".

Seventy-five per cent of price is not a book anyone can draw. Measured through
the desk's own proxy on 2026-08-13, the deepest page Binance publishes for
USDⓈ-M — a thousand levels a side — reaches this far past the mid:

| Contract | reach below | reach above | ticks to price |
|---|---|---|---|
| AKEUSDT | 4.10% | 3.90% | 77 240 |
| BTCUSDT | 0.19% | 0.19% | 634 236 |
| ETHUSDT | 0.55% | 0.55% | 188 695 |
| TUTUSDT | 33.22% | 28.35% | 3 865 |

There is no order book at ±75% of price on any of them, and none deeper to buy:
a thousand levels a side is the whole of what the exchange serves. A ladder
extended to ask for it would draw one row of aggregated liquidity and thirteen
blanks.

**The ladder is not what stops at 10% — the market is.** Worse, the ladder does
not stop where the market does; it goes past it. The coarsest step the panel
offers is 500 ticks, which over fourteen rows asks for 9.1% of price on AKEUSDT
against 4.1% published, 1.1% on BTCUSDT against 0.19%, 5.2% on ETHUSDT against
0.55%, and 181% on TUTUSDT against 28%. On every contract measured, the operator's
last rung asks for several times what exists. What they were shown at it — six
rows of book over eight blank ones, badged short — is the panel faithfully
drawing a reading nothing can answer.

So the operator's ask cannot be met as stated, and the honest version of it is
worth more than the literal one: **make the coarsest step the one that fills the
panel with everything the exchange publishes, and say on screen how far that is.**
On AKEUSDT that is fourteen full rows spanning about 3.6% instead of six full
rows and eight blanks spanning the same book. Nothing is lost — the span already
was, and only was, whatever Binance publishes — and eight rows of resolution are
gained at the step the operator reads deepest at.

## What Changes

- The delivered book states how far the page it was bought at proved on each
  side. It is stated only once no deeper page can be bought: until then the desk
  has not yet shown everything the exchange publishes, and a ladder cut against a
  cheap page would stop the operator asking for the deeper one.
- The grouping ladder ends at the coarsest step whose rows fit inside that reach.
  A step that would ask for rows the exchange does not publish is not offered.
- The ladder gains the rungs that make the cut land near the reach rather than
  well short of it. Between 100 and 500 ticks there was a fivefold jump, so a
  contract whose reach falls anywhere inside it dropped to 100 — on AKEUSDT, from
  3.9% published down to 1.8% shown. 200 and 1000 are added; no existing rung
  moves, so no stored preference is invalidated.
- A stored step coarser than the ladder currently offers is drawn at the coarsest
  step it does offer, and the stored preference is left as it is. A reach that
  narrows for a moment then costs the operator a redraw rather than a setting.
- The panel states the reach, so how far the book goes is a reading on screen
  rather than something inferred from where the rows stop.

## Non-Goals

- No deeper page is invented. A thousand levels a side is what Binance serves and
  what the desk already buys; this change spends nothing new at the exchange.
- Levels beyond the band are still dropped. The reach is stated as a fact about
  the page, not as permission to draw across the gaps outside it.
- The delivered state is not touched. `keep-the-book-under-the-market` settles
  when a band is re-read; a book whose ladder fits inside its own reach stops
  falling short of the rows on its own account, and needs no new rule to say so.

## Notes

This change modifies `The order book is denominated in USDT and groupable`, which
`send-only-the-book-on-screen` also modifies and which has not archived: its
operator check is still open. The delta below carries that change's text in full
and adds to it, so the two apply in either order without losing each other.
