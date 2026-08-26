# Price every open position at the last print

## Why

The operator, 2026-08-26, having looked at the previous day's answer:

> *"мне до сих пор не нравится скорость с которой обновляется uPnL у открытых
> позиций — для скальпинга это слишком медленно. я бы предложил — чтобы на все
> открытые позиции мы держали сокет соединение с последней ценой и обновляли
> быстрей, чем сейчас."*

Two separate corrections in one sentence, and the desk had both wrong.

**Coverage.** The printed price reached the contract *on screen*, fed from the
chart's own stream. The operator holds positions in contracts they are not
looking at, and those rows were the ones sitting on a price up to a second and a
half old.

**Weight.** The printed price was a *second line* under a headline that moves
once a second. The headline is the number being watched, so the headline was
still the slow one.

Neither is fixable by refreshing harder, because the mark's cadence is the
exchange's, not the desk's. Measured through the operator's proxy on the desk's
own routed path, 180 s, BTCUSDT/ETHUSDT/SOLUSDT/DOGEUSDT on one combined
stream:

- **The mark arrives once a second and no faster.** 178 frames per contract in
  180 s; gap p50 1000 ms, p95 1015 ms, worst 1272 ms. `@markPrice@1s` is the
  fastest mark route Binance publishes, and the desk is already on it.
- **The contracts print far faster than that.** BTCUSDT 25.5 trades a second
  (gap p95 196 ms), ETHUSDT 15.0 (354 ms), SOLUSDT 4.0 (712 ms), DOGEUSDT 2.0
  (1609 ms, worst 6579 ms).
- **And the price genuinely moves in between.** Inside a single mark second the
  printed price roamed from the standing mark by 0.68–1.99 bps at the median and
  up to 3.59–6.99 bps at its worst, per contract. On a 10 000 USDT position that
  is up to 7 USDT that existed and was not on the row until the second was over.
- **Transit is 210–336 ms at the median** (p95 341–403 ms), which the desk
  cannot shorten either.

So a mark-priced row is up to ~1.5 s behind: the exchange's own 1000 ms of
quantisation, ~220 ms of transit, and the desk's 25 ms window. A print-priced
row is ~250 ms behind, and moves 2–25 times a second instead of once.

This is not a novel arrangement. It is what Binance's own app calls *Calculate
PnL based on: Last Price*, and it makes the same division: the displayed uPnL
follows the last traded price while liquidation stays on the mark.

## What Changes

- **The position price feed carries both of a contract's prices, for every open
  position.** `<symbol>@aggTrade` joins `<symbol>@markPrice@1s` on the same
  combined socket, for the symbol set the feed already tracks. No new socket, no
  new connection, no signed request, no REST weight — 50.5 frames a second in
  total across four contracts.
- **A position is read at whichever of its two prices the exchange stated more
  recently**, with a window so that the mark's metronome cannot take the reading
  off a contract that is printing perfectly well. A contract that stops trading
  hands the reading back to its mark within about two marks, which is correct: a
  price nobody has traded at for two seconds is not the fresher one.
- **The mark keeps everything it decides.** Notional, margin, margin balance,
  removable margin and the liquidation buffer are computed on the mark and only
  on the mark, and the mark's own uPnL is carried on every row under its own
  name — on the ticket card as a line of its own, on the dock row and the total
  in what the figure says about itself.
- **The renderer's watched-contract tape path is removed.** One source, for
  every position, rather than two that would have to agree.

## Non-goals

**The exit-side price.** What a position would actually fetch is the far side of
the book — the bid for a long, the ask for a short — and `@bookTicker` publishes
it in real time. It is deliberately not used: the operator's complaint is that
the row does not match *what they see on the chart*, and the chart is drawn from
trades. A row priced off the book would be a third number, disagreeing with the
chart again, for a difference of one spread.

**A preference toggle.** Binance offers both bases as a setting. This desk states
both figures at once instead, each under its own name, which is the ruling
already in force here (*Name the quantity, not the column*, 2026-08-20) and
costs the operator no configuration to get right.

## Risks

The desk's headline uPnL will now disagree with the Binance app's default
display, by the deviation measured above — about 1 bp of notional at the median
and up to 7 bps in a fast second. The mark's figure is on the row, so the
comparison is always available; but a reconciliation done by eye against the
app's default screen will no longer match on the headline, and that is a real
change to how the operator checks the desk.

## Deferred, and why

The lane that carries the price behind uPnL is still the only lane the desk
cannot time. `markAccountFrame` refuses to stamp a `futures_position_marks`
frame because the payload's own price map is already called `marks` and the
transport stamp would be the same key twice. So the frame instrument covers
header, candles, depth, trades, account and orders, and not this one — which is
why every number above comes from a probe rather than from the operator's
journal, for the second change running. Fixing it needs the key collision
resolved and a commit boundary defined for a store that deliberately does not
set React state.
