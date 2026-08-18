## Why

The operator reports the same thing twice, five weeks apart, and neither report
can be answered from the record: an order that fills in parts shows its number
late, and — 2026-08-18, verbatim — "у меня ощущение, что вообще executionReports
+ UI вообще не связаны".

**The path exists, twice.** An execution report reaches the screen directly
(`futures_execution_update` → `mergeOrderUpdate`, `useFuturesTrading.js:550`,
where `PARTIALLY_FILLED` is an open status so the row stays with the new `z`),
and again through the folded account envelope (`foldFuturesWorkingOrder` →
`futures_account_state` → `applyAccountEnvelope`). Reading the code says they are
connected. Reading the record says nothing at all, and the operator is describing
what they see, which no amount of reading the code answers.

**The marks stop at the market lane.** `time-the-frame-from-exchange-to-screen`
specified the five marks for "a market-data **or account** frame" and built them
for the market one: `markOutboundFrame` stamps only frames sent through
`workstationFrameDelivery`, and only `useFuturesProductionWorkstation` reports a
commit. Account traffic goes out on `ACCOUNT_FRAME`
(`binance-connection.js:1135`), which carries no marks, and
`useFuturesTrading` measures nothing. The desk's own record for 2026-08-18 holds
**20 067 `frame` lines, every one of them `depth`, `candles` or `header`, and not
one about an order**. The one leg the operator complains about is the only leg
never timed.

So the two questions that keep coming back — *did the report arrive*, and *when
was it drawn* — have no answer today, and each recurrence costs another day of
waiting for the market to repeat itself.

**What the record can already do, and what it cannot.** An execution report
schedules a one-resource `unstated` read, so a fill leaves a trace: on
2026-08-16 the desk wrote 93 of them, 27 with no command behind them. That says a
report arrived within about 400 ms of something. It cannot say which order, what
the exchange said about it, or whether the screen changed — and on a partial fill
those are the whole question.

## What Changes

- The frames the private stream produces — the execution report and the account
  envelope folded from it — carry the same five marks the market lane already
  carries, and the renderer closes them with the commit that put them on screen.
- A frame line about an order names **which** order (the same identity the
  `command` and `answer` lines carry, so a day can be read as one story) and what
  the exchange said about it (`NEW`, `PARTIALLY_FILLED`, `FILLED`, …).
- The line states whether the screen actually changed: `DELIVERED` when the
  working orders the desk holds moved, `UNCHANGED` when the report arrived and
  left them as they were. An arrival that draws nothing is the operator's
  complaint stated exactly, and it is invisible today.
- The day's summary prints the order frames it holds — few enough per day to be
  listed rather than aggregated — so a reported moment is looked up rather than
  grepped for.

## Non-goals

- No new event kind. `frame` carries this, as `fault` carried the private
  stream's endings.
- No sampling on this lane. The market lane samples because it runs at ten books
  a second; account traffic is tens of events a day, and sampling a partial fill
  is losing the case this is built for. The record's own byte bounds stay the
  ceiling.
- No money value, and that includes the tempting one: the filled *fraction* of an
  order is not recorded. `PARTIALLY_FILLED` already says a fill was partial, and
  the record's rule against amounts is worth more than one convenience field.
- Spot is left alone. The complaint, the stream and the surfaces are futures.
- Not a fix. This measures the leg; if it turns out to be slow or broken, that is
  the next change and it will be the first one with numbers behind it.

## Impact

- `electron/services/binance-connection.js`,
  `electron/services/desk-diagnostic-record.js`,
  `src/utils/deskFrameRouter.js`, `src/hooks/useFuturesTrading.js`,
  `scripts/read-desk-record.mjs`.
- Modifies one requirement in `desk-diagnostic-record` — the one that already
  says "market-data or account frame" and was only half built.
- Operator-visible only through the record: a desk that can be asked when a fill
  arrived and when it was drawn, instead of an operator being asked what and
  where.
