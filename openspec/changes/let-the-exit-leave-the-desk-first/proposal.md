# Let the exit leave the desk first

## Why

The operator, 2026-09-02, after an evening on AKEUSDT: «активно трейдил и не
мог выйти из позиции … нажал перезагрузку … мог улететь в ликвидацию вообще».

Measured (`desk-2026-09-02-000.jsonl`, 21:40:40–21:41:07Z):

1. **The desk's own weight window was full at the moment the exit was
   needed.** `spent` 760–809 of a self-imposed 800 by the 41st second of the
   minute. What filled it, none of it the operator's: the fill-driven history
   fan-out (orders + trades pages at weight 5 for every held contract, a
   serial pager at ~2 requests/s — 107 requests in one minute with zero
   commands and zero account frames), the per-fill income `credit-confirm`
   (4 pages × 30; 14 income requests in each of 21:37 and 21:40), the
   30-second beat at 90 when the private stream had been quiet. The exchange
   allows 2 400 a minute per address; the desk stopped itself at a third of
   it, and the fill-burst design note that «the ceiling is the exchange's»
   was wrong — `futures-production-workstation-transport.js` states the
   2 400 in its own budget comment.
2. **A command's answer waited for a read it did not need.**
   `trade.adjustPositionMargin` answered in **24 362 ms**: its handler
   (`binance-connection.js:7470`) awaits the full four-resource, 90-weight
   `reason: 'command'` pass unconditionally. `1b5e6b0` freed the leverage and
   margin-mode commands from this; the margin handler kept it. The pass's two
   weight-40 reads were `deferred` **19 314 ms** (urgent standing, 766/800):
   the 40-weight command reserve of `44986d3` is smaller than the 90-weight
   read it was meant to make room for.
3. **The exit never reached the main process.** Between 21:40:41 and
   21:40:55 the record holds four `trade.cancelOrder` lines for one order and
   **no** `placeOrder`. While the command pass ran, its positions resource
   read `loading` (`binance-connection.js:2416`), and the ticket's exit path
   requires `positionsResource.status === 'ready'`
   (`FuturesTradingTicket.jsx:316`) — the exit was withheld on screen with
   «No current confirmed position», and a withholding leaves no journal
   line. Four cancels for one order went out because nothing on the row said
   one was in flight; three came back `-2011`.
4. **Two reduce-only exits were refused by the desk** (`QUANTITY_EXCEEDS_LEG`
   at 21:00:24Z and 21:46:03Z): a staged exit larger than the leg the desk
   held after a partial fill. The refusal names its condition and nothing
   else — neither the requested size nor the leg reaches the popup or the
   record.

Then the operator reloaded the window. It did not help: the queue lived in
the main process.

## What Changes

- **A trading command never waits for the desk's own ceiling.** Placement,
  amendment, cancellation, cancel-all, market close and position-margin
  requests carry `command` standing: the weight window books their weight
  but never refuses them for the desk's own capacity arithmetic. Only the
  exchange's own limit (an observed used-weight within a stated margin of
  2 400, or a `429`/`418` window) holds a command back. The urgent-overtake
  bound does not apply to commands.
- **The ceilings are raised toward the exchange's.** Ordinary standing may
  spend the window to **1 200**; urgent standing (the reads a command waits
  on, proof reads) to **1 700**; the public reader keeps its 600, and
  1 700 + 600 stays below 2 400. The command reserve becomes the difference
  (500) and is stated against the measured 90-weight pass it has to admit.
- **The margin handler answers when the exchange answers.** Its consequence
  read is issued, not awaited; with the private stream carrying, it is
  narrowed to positions and balances. The unresolved path still waits for
  its drain.
- **The renderer withholds an exit only for what makes the exit wrong.** A
  positions or balance reading being re-confirmed (`loading` over a prior
  success) does not disarm the exit; a `stale` balance blocks new exposure
  only. A command the renderer withholds is reported to the record as an
  outcome of its own (`withheld`, with the readiness code).
- **One cancel in flight per order.** A second cancel of an order whose
  cancel has not answered is not sent; the row states that a cancel is in
  flight until the answer or the 15-second watcher settles it.
- **A refusal states both numbers.** The `QUANTITY_EXCEEDS_LEG` popup names
  the requested size and the open leg; the record carries their ratio in
  basis points (a count, no money). The ticket's exit confirmation shows
  the leg beside the size being sent.
- **The record names a request's route** (closed vocabulary, no URL), so a
  weight-5 request is never again attributed by pattern-matching.

## Impact

- Specs: `futures-live-readiness` (budget standings and ceilings — this
  block supersedes the reserve half of `keep-the-desk-live-through-a-fill-burst`,
  whose scenarios are carried here), `trading-command-integrity` (margin
  command answer; exit not withheld on re-confirmation; refusal numbers;
  cancel in flight), `futures-order-visibility` (the stale «loading is not
  authority» scenario retired), `desk-diagnostic-record` (route on the
  request line; `command` standing on the deferred line; withheld
  outcomes; refusal ratio).
- Code: `electron/services/binance-connection.js` (`RateLimiter`,
  `FUTURES_COMMAND_WEIGHT_RESERVE`, `handleFuturesAdjustPositionMargin`,
  `assessFuturesReduction` rejection detail, `onOperation` route),
  `electron/services/futures-trading-adapter.js` (route per endpoint),
  `electron/services/desk-diagnostic-record.js` (declared fields),
  `src/components/features/futures/FuturesTradingTicket.jsx`
  (`positionCommandReady`, exit confirmation), `src/utils/futuresReadiness.js`
  (stale balance vs exposure), `src/hooks/useFuturesTrading.js` (cancel in
  flight, withheld report).
- Not touched: the income scheduler's cadence, the history fan-out's shape,
  the periodic beat (they stop mattering to commands once commands do not
  share their ceiling; their own cost is a follow-up), the order book, the
  interval switch (own changes).
