# Keep the desk live through a fill burst

## Why

The operator, 2026-08-30, after a day of live trading: «разок приложение
зависло на филлах — я тогда пытался еще двигать ордера, в общем когда идет
PARTIALLY FILLED — то какие-то тормоза возникают».

Measured the same evening (`desk-2026-08-30-002.jsonl`, 17:10–20:10Z, bursts
of 25–59 `PARTIALLY_FILLED` a minute on SKRUSDT), two distinct mechanisms
behind the one symptom:

1. **The screen stops keeping up.** One partial fill produces two to three
   account-lane frames (execution report, folded account envelope, the
   `ACCOUNT_UPDATE` for the same fill), each its own WebSocket macrotask and
   its own un-batched React render. At burst peaks the renderer received
   **32–46 orders/account frames a second**, each commit costing **p50
   400 ms** (quiet baseline: 17 ms) — ~16× oversubscribed, frames queuing to
   **6.4 s** behind the book. 286 of the session's 409 order-frame journal
   lines read `NOT_DRAWN`. The commit is expensive because the *review* is
   glued to the *fill*: every report synchronously re-sorts the whole held
   history (up to 8 000 fills/contract), rebuilds the BigInt round fold
   (twice per position), reconciles the wallet ledger, and tears down and
   recreates every chart price line with a forced reflow per handle.
2. **Commands queue behind the desk's own reads.** At 18:47:00Z the weight
   window stood at `spent: 799–800` of 800 and commands deferred 4–33 s:
   `trade.placeOrder` answered in 9 573 ms, `trade.replaceOrder` in
   11 532 ms, six cancels at 4.2–5.4 s — every one `ok`; the exchange
   refused nothing. An **urgent weight-1 request waited 9 229 ms**: urgent
   standing orders the queue but confers no capacity, and the limiter has no
   reservation concept at all. What spent the window: fifteen 90-weight
   `reason: refresh` passes in seven minutes (the 30-second reconcile beat,
   which runs at full width even while the private stream is delivering the
   very same orders and balances), the burst's ordinary-standing
   credit-confirm income pages, and the bootstrap volley after the 18:47:24Z
   restart.

Neither mechanism misprices anything — frames that did not draw were
superseded, every command landed — but both put seconds between the
operator's hand and the book during exactly the moments a scalper acts.

## What Changes

- **The budget keeps a command's weight standing.** Ordinary-standing
  reservations may not take the weight window past `ceiling − reserve`;
  urgent standing (trading commands and the reads they wait on) may use the
  full ceiling. A command arriving at a busy minute finds room instead of
  waiting the window out.
- **The reconcile beat defers to the stream that is already reporting.** A
  `periodic` account refresh is held while the private stream has spoken
  within the beat interval and the last full pass is younger than a stated
  quiet ceiling; held beats are counted and the count reaches the journal on
  the next pass. Manual refresh, bootstrap, reconnect and command-driven
  reads are untouched — the cause is named by the caller.
- **Executions commit once per cluster, and every report is folded.** The
  renderer drains account-lane frames arriving inside a short measured
  window in one state commit: the first report of a quiet moment applies
  immediately, the cluster behind it folds in arrival order into the same
  commit. Nothing is dropped or superseded in transport — the account lane's
  lossless promise holds end to end.
- **The review fold leaves the fill path.** The round index, wallet-ledger
  reconcile and settled-money derivations trail the execution state on a
  bounded timer instead of recomputing inside every fill's commit. Working
  orders, positions and chart plates stay immediate; the closed-rounds
  review is allowed to be a bounded moment behind during a burst.
- **Chart price lines are diffed, not rebuilt**, so a fill on one order no
  longer recreates every other order's line and handle.
- **The frame instrument stops calling supersession a fault.** A report
  drained behind a newer report of the same order in the same commit gets
  its own fourth reading (`SUPERSEDED`); `NOT_DRAWN` keeps meaning what the
  operator means by it — the newest state of an order is not on the screen.

## Impact

- Specs: `futures-live-readiness` (budget reserve),
  `futures-order-visibility` (beat deference; batched execution commit;
  review off the fill path), `desk-diagnostic-record` (fourth frame reading;
  held-beat count on the read line).
- Code: `electron/services/binance-connection.js` (RateLimiter, refresh
  handler), `electron/services/desk-diagnostic-record.js` (declared fields),
  `src/hooks/useFuturesTrading.js` (drain, review trailing, verdicts),
  `src/utils/futuresHeldHistory.js` (batch fold),
  `src/components/FuturesWorkstationChart.jsx` (price-line diff),
  `src/App.futures-burst.test.jsx` (the cadence suite).
- Not touched: the renderer outbox (account lane stays lossless and
  unsuperseded), the mark/print feed, the income walk, per-contract command
  serialization, the 420 s stream watchdog.
