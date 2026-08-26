# Value the watched position at the price on the chart

## Superseded in part, 2026-08-26

The operator read it the same day and answered: *"мне до сих пор не нравится
скорость с которой обновляется uPnL у открытых позиций — для скальпинга это
слишком медленно. я бы предложил — чтобы на все открытые позиции мы держали
сокет соединение с последней ценой и обновляли быстрей, чем сейчас."*

Both halves of this change's presentation answer were wrong for the desk they
were built for. It gave the printed price to the **contract on screen** and the
operator holds positions in contracts they are not looking at; and it put that
price on a **second line** while leaving the headline on a number that moves
once a second, which is the number they are watching. Neither is a defect in
what shipped — it does what it says — and both are settled by
`price-every-open-position-at-the-last-print`, which supersedes this change's
`futures-workstation-presentation` delta (removed here rather than left to
reach canon) and retires its operator gate unlooked-at.

What stands, and is not superseded: every measurement below, and the
`futures-order-visibility` delta on the coalescing window. That window was
sized from the arrival measurement and is unchanged by the later work — the
later change only adds prints to what it folds together.

## Why

The operator, 2026-08-26: *"надо чтобы наша UPNL цена чаще обновлялась в
позициях на график которых я сейчас смотрю — а то бывают тормоза когда сильные
движения и MARK PRICE сильно отстает от того что я вижу глазами на графике."*

Measured before deciding anything, on the desk's own routed path through the
operator's proxy:

- **The exchange sends a mark once a second and no faster.** 239 frames in 240
  seconds on each of BTCUSDT, ETHUSDT and DOGEUSDT; gap p50 1000 ms, p95 1012
  ms, worst 1141 ms. `@markPrice@1s` is the fastest mark route Binance
  publishes. Nothing the desk does can make that number arrive more often.
- **The mark is a different quantity from the price on the chart**, not a
  delayed copy of it. Against every print in that window the held mark sat 0.5
  bps away at the median and 2.4–3.5 bps at the 95th percentile; in the fastest
  5% of seconds, 1.6–2.9 bps at the median and up to 5.8 bps. That gap does not
  close by refreshing.
- **The desk then adds age of its own.** Marks for four contracts land within
  2 ms of each other (p95 3 ms, worst 6 ms), and the account-side feed holds
  every one of them in a 200 ms coalescing window before publishing. The window
  was sized to fold simultaneous arrivals together; the measurement says 6 ms
  would do it. Transit is a further 220 ms (p95 232 ms).

So the number behind uPnL can be about **1.4 s old** at worst — up to 1000 ms
of the exchange's own quantisation, 220 ms of transit, 200 ms of the desk's
window — while the chart beside it moves on every print (ETHUSDT printed 8.3
times a second in the same window, DOGEUSDT 1.4). During a fast move that is
exactly "MARK PRICE сильно отстает от того что я вижу глазами".

The desk already receives, for the contract on screen and on a socket it is
already paying for, the very price the chart is drawn from: `@aggTrade` on the
workstation's market stream. And the valuation ladder was built to carry it —
`readFuturesPositionMarks` reads `lastPrice`, `preferNewestMarkReading` keeps
mark and tape timestamps apart, `tapeScenarioOf` computes the what-if, and
`futuresPnlReadingNote` has the sentence to say about it. Nothing has ever
filled `lastPrice`, so the whole path is dead code: the feed dropped its
`@aggTrade` subscription because the chart already had the tape, and the two
were never joined.

## What Changes

- The contract on screen has its last traded price fed into the position mark
  store from the workstation's own tape, coalesced so a burst of prints cannot
  cost more renders than a bounded rate. No new socket, no new subscription and
  no REST weight: this is the stream the chart is already drawn from.
- A position on that contract states, under its own name, what it is worth at
  the price the chart is showing, beside the exchange's mark-based figure. The
  mark stays the headline everywhere and stays the only input to ROE, margin,
  liquidation and every aggregate — it is what settles, and it is what
  liquidates.
- The mark feed's coalescing window is cut to what the arrival measurement
  supports, so the desk stops adding delay it cannot buy anything back with.
- The tape reading is withdrawn when the operator leaves the contract or the
  workstation stops carrying it, so a price from a chart no longer on screen
  can never sit beside a live mark.

## Non-goals

*Both of these were overturned by the operator on the same day — see
**Superseded in part** above. Kept as written, because they are the reasoning
the correction had to argue with.*

The headline uPnL does not move to the tape. The canonical requirement already
settles that — the last traded price "MAY support a separately named what-if
reading, but that value SHALL NOT be labelled uPnL, included in the dock total,
or used by margin, liquidation, or risk decisions" — and it is the right rule:
the exchange pays and liquidates on the mark, so a desk that sized an exit off
a tape-priced number would be reading a number the exchange does not use.

Contracts other than the one on screen keep mark-only valuations. Their tape is
not subscribed to and will not be: that is the subscription the feed already
dropped once, for the reason it recorded.

## Deferred, and why

The one lane that carries the price behind uPnL is the only lane the desk
cannot time. `markAccountFrame` refuses to stamp a `futures_position_marks`
frame because the payload's own price map is already called `marks` and the
transport stamp would be the same key twice — the code says so, and the honest
consequence is that the frame instrument covers header, candles, depth, trades,
account and orders, and not this one. Measuring it needs the key collision
resolved and needs a commit boundary defined for a store that deliberately does
not set React state. That is its own change, and it is what would let a future
"тормоза" be answered from the record instead of from a probe.
