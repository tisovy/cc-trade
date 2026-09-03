# Score the reconfirmation against the stream

## Why

The operator, 2026-09-03: «у нас в журнале организован подсчёт, чтобы мы могли
сверять данные, полученные по сокетам, с REST и в какой-то момент совсем от
REST-запросов отказаться, чтобы экономить лимиты».

Two REST reads exist only to reconfirm what the private stream already
delivered: the income pass armed by a fill or a funding charge (the `settled`
line) and the trade-history gap read ten seconds after a fill burst (`request`
lines, route `history-trades`, since `9604090`). Dropping either needs evidence
that the socket was enough — a run of passes that found nothing the stream had
not already reported. Today neither read produces that evidence:

- **The settled line's score is a constant.** `binance-connection.js:3489`
  writes `missing: 0, differing: 0` literally. The comparison that once
  produced them, `compareFuturesSettledReadings`
  (`futures-settled-income-store.js:341`, bounded to the span the re-read
  covered), lost its only caller in `ac1800e` (2026-08-23, the lane-based
  walk) and has been dead since — its unit test still passes. `verified` is 1
  on a `verification` pass and 0 otherwise: it says a full-window walk ran,
  not that anything was compared. The canon at `futures-order-visibility`
  («A kept reading is verified against the exchange, not trusted») still says
  «the disagreement SHALL be recorded», and the archived
  `keep-the-settled-reading-across-restarts` closed its gate 4.2 on exactly
  these two fields.
- **The history read has no line at all.** Each `history-trades` request
  states its route and weight. None says whether the exchange returned a
  trade the stream never reported, or a row whose price, quantity,
  commission or realized PnL differed from the execution report the desk had
  folded (`futuresHeldHistory.js:605`, `tradeRowFromReport` `:532`). Stated as a
  residual in `confirm-a-fill-burst-once/design.md` (`a56c2f1`); not begun.

Measured in the operator's journal (`~/.config/cc-trade/diagnostics`):

| Day | `settled` passes | `missing` / `differing` | `history-trades` requests | What they found |
|---|---:|---|---:|---|
| 2026-09-02 | 16 | 0 / 0 — constants since `ac1800e` | — (route unnamed before 09-03) | not recorded |
| 2026-09-03, to 13:30 UTC | 4 (one `verification`) | 0 / 0 — constants | 88 | not recorded |

So the sixteen zeros the operator was shown as «the socket was enough for the
money yesterday» measured nothing, and the eighty-eight reads today measured
nothing either. A month of zeros is the evidence for ending a read; a single
non-zero is the reason it stays. Neither can be collected until the lines exist.

## What Changes

- **A `history` record line per trade-history pass**, counts only: the rows
  the exchange returned; of those, how many fell outside the span the stream
  stood for (`restated`); of the rest, how many the stream had reported
  (`held`), how many it never reported (`unreported`), how many differed from
  the stream's own report (`differing`); and whether the stream stood for the
  whole span (`vouched`). The read names its reason from a closed vocabulary
  (`fill`, `open`, `refresh`, `full`, `stream`, `bootstrap` from the renderer;
  `continuation` and `unstated` from the main process). No money enters the
  line.
- **The settled score measured again.** `missing` / `differing` come from
  comparing the rows held before a full-window pass with what the pass
  answered, lane by lane, inside the span the pass walked; `verified` counts
  the lanes compared. A pass that compared nothing writes 0 and the summary
  lists it as run, not compared.
- **The daily summary states both scores**, so a month of zeros can be read
  off thirty summaries rather than thirty files.
- **Not in this change:** ending either read. That is the operator's decision
  on the evidence, and its own change (gate stated in `tasks.md` §5).

## Impact

- Specs: `desk-diagnostic-record` (ADDED: a reconfirmation read keeps its own
  score), `futures-order-visibility` (MODIFIED: the recorded disagreement is a
  measured count).
- Code: `electron/services/binance-connection.js` (execution-report site
  `:4596`, `handleFuturesHistory` `:6240` / `:6943`, `readFuturesSettledMoney`
  `:3423` / `:3489`), the new `futures-history-reconfirmation.js` (shadow,
  projection, score), `desk-diagnostic-record.js` (`history` kind),
  `futures-settled-income-store.js` (the comparison, per lane),
  `trading-command-validation.js` (the reason crosses the boundary),
  `scripts/read-desk-record.mjs`; renderer: `src/utils/tradingCommands.js`,
  `useFuturesTrading.js` and `FuturesPortfolioDock.jsx` name the read's
  reason. Tests beside each. Implemented 2026-09-03; §5 (live) open.
- An edit under `electron/**` restarts the live desk; eleven files copied at
  once killed the dev server on 2026-09-03. Deploy one file at a time, or with
  the desk stopped by the operator.
