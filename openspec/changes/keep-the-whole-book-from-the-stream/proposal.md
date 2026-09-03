# Keep the whole book from the stream

## Why

The operator, 2026-09-03: «зачем мы дергаем рест для ордербука вообще? … я
запрашивал его только 1 раз при запуске — все остальное я уже забивал из
сокет даты … полоса в 1000 — бред и оверинжиниринг. Мы должны хранить ВСЁ, а
показывать только то что указано в интерфейсе».

That is the exchange's own protocol: one depth snapshot, then every diff,
chained on `pu`; a REST read again only when the chain proves a gap. The
desk's futures book does something else. It keeps a *band* — the page a
snapshot proved — and buys the page again when the market walks out of it or
when the rows on screen at the operator's grouping step reach past it
(`DEPTH_RANGE_SHORT`, `DEPTH_BAND_WALKED`). The re-read collides with the
diffs already in flight, the book comes back crossed, three retries,
`DEPTH_BOOK_DOWN`, and the session's book is rebuilt from the page.

Measured on AKEUSDT, 2026-09-02 (`desk-2026-09-02-000.jsonl`, 3.6 h):

| Cause of a REST read of the book | Count |
|---|---:|
| Proven sequence gap (`DEPTH_SEQUENCE_GAP`) — the only cause the protocol has | 0 |
| `DEPTH_RANGE_SHORT` (page short of the rows / market walked out) | 50 |
| `CROSSED_ORDER_BOOK` after a re-read (`book-recovery`) | 97 |
| `CROSSED_ORDER_BOOK` on the live stream | 4 |
| `DEPTH_BOOK_DOWN` — three retries spent, book rebuilt | 34 |

The same loop ran on SKRUSDT and 龙虾USDT the day before (35 + 23 + 13). It
costs the public read budget (`DEPTH_1000` is 20; a round is up to 60), it
costs the book on screen during exactly the spikes the operator trades, and
it is the only place where the desk asks the exchange something the stream
has already told it.

The band also bounds what is kept: `RETAINED_LEVELS_PER_SIDE` 10 000 with an
eviction pass, sized in 2026-08-14 against a per-frame sort of the whole
side. Measured then, a book climbs past 6 000 levels a side in ten minutes
and keeps climbing; a ceiling exists only to bound a sort that delivery no
longer needs (bounded delivery selects the nearest rows without ordering the
tail).

## What Changes

- **One page, then the stream.** A session's book is bootstrapped from one
  snapshot at the deepest page the exchange serves in one read, bridged by
  the exchange's own rule, and thereafter maintained from diffs alone. The
  desk SHALL NOT read the book again for a band the market walked out of, a
  page short of the rows on screen, or a grouping step — only for a proven
  sequence gap, a book the stream itself crossed, an unbridgeable bootstrap,
  or a stream that reconnected.
- **Everything is kept.** No retention ceiling and no eviction: every level
  the exchange has stated is held until the exchange states it gone. The
  cost per frame is bounded by the rows delivered, not by the levels held.
- **The page marks, it does not drive.** The page a book was bootstrapped
  from remains recorded, and a delivered row that stands beyond it stays
  marked as not whole — that is honest and free. The panel's stated range
  drives delivery only.
- **The book states how far it holds** from the whole book in hand, always,
  since there is no deeper page to wait for.
- **A crossed book is investigated, not just retried.** With no re-centring
  page, a book that still crosses after a correctly chained diff is
  evidence of something else; the record SHALL carry, for a crossing, the
  update identities and the count of levels between the two bests, so the
  next one can be read.
- **A stream close says why and how late it was.** The status line carries
  the close's cause (the exchange's close, the desk's own rule, the
  proxy's) and the upstream lag of the last frame before it; on 2026-09-02
  each `SOCKET_CLOSED` followed four to eight seconds of lag and the record
  could not say so.

## Impact

- Specs: `futures-workstation-presentation` (the page-buying and band
  requirements retired and replaced; delivery, routine depth, the book-fault
  and resync-cause requirements amended), `desk-diagnostic-record` (stream
  close cause and lag; crossing evidence).
- Code: `electron/services/futures-workstation-order-book.js` (retention,
  band as marker only, reach from the whole book, crossing evidence),
  `electron/services/futures-production-workstation-service.js`
  (`ensureDepthCovers`/`deepenDepthPage` retired; `recoverBook` reasons;
  close reason and lag), `electron/services/futures-production-workstation-transport.js`
  (bootstrap at `DEPTH_1000`; close cause), `desk-diagnostic-record.js`
  (declared fields), the renderer's book panel only where it reads the
  reach.
- Not touched: the public read budget's ceiling (600) and its wait rule, the
  routine 200 ms delivery bound, the renderer's row protocol, the held pool.
