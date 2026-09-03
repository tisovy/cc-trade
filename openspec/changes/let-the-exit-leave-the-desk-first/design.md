# Design — let the exit leave the desk first

## The evening, by line (desk-2026-09-02-000.jsonl, UTC)

| When | Line | Reading |
|---|---|---|
| 21:40:20–41 | `request` ×73, observed 220 → 771 | 14 income pages (30 each) + 55 weight-5 reads in 40 s |
| 21:40:40.890 | `command trade.adjustPositionMargin` | operator adds margin |
| 21:40:41.236 | `read reason:command resources:4 weight:90` | handler's unconditional full pass |
| 21:40:45–51 | `command trade.cancelOrder` ×4, one `identity` | nothing on the row said one was in flight |
| 21:40:41–55 | no `placeOrder` | the exit was withheld in the renderer |
| 21:40:55.445 | `link renderer-disconnected` | operator's reload |
| 21:41:00.55/.70 | `deferred urgent w=40 waited 19 314 / 19 464` | the pass's two order lists, reserve 40 < 90 |
| 21:41:00.40 | `deferred urgent w=1 waited 2 195 spent 809/800` | a command held for the desk's own ceiling |
| 21:41:05.252 | `answer adjustPositionMargin 24 362 ms` | answered when the pass answered |
| 21:41:05.9–07.3 | `answer cancelOrder` 20 012 / 17 324 / 16 689 / 15 538 ms; `outcome -2011` ×3 | queued behind the drain |
| 21:44:12–31 | `deferred urgent w=40` 2 958 / 5 393 / 2 660 | margin ×2 at 7 214 / 4 428 ms |
| 21:46:00.25 | `deferred urgent w=1 waited 1 803 spent 810/800` | a replace held 1.8 s |
| 21:00:24, 21:46:03 | `outcome placeOrder rejected QUANTITY_EXCEEDS_LEG` | staged exit larger than the leg |

Whole session: `request` weight 5 ×2 055 of which ~1 070 are account reads
the `read` line accounts for; the rest have no line — history pages at
`FUTURES_HISTORY_READ_WEIGHT` (5), a serial pager (`readFuturesHistoryGap`,
`binance-connection.js:6289`) walking `FUTURES_TRADE_HISTORY_WINDOW.MAX_REQUESTS`
(8) pages × 2 views × held contracts. In 21:48Z: 107 such requests, 0
commands, 0 account frames. Income (30) ×181 in 35 passes; the two 14-page
minutes are `credit-confirm` bursts on fills.

## Code map

- `RateLimiter` (`binance-connection.js:437–900`): `maxWeight` 800
  (`:1413`), `commandWeightReserve` 40 (`FUTURES_COMMAND_WEIGHT_RESERVE`,
  `:414`), `reservationWait(weight, urgent)` (`:607`): ceiling = urgent ?
  max : max − reserve; `nextAdmission()` (`:653`) urgent passes ordinary up
  to `MAX_ADMISSION_PASSES` (8); `reserve()` (`:739`) re-queues on capacity
  and writes `deferred` with `standing: urgent|ordinary`.
- Observed baseline: `reconcilePhysicalResponse` replaces local charges with
  the exchange's `x-mbx-used-weight-1m` — so `spent` already includes the
  public reader's (transport) spend on the same address.
- Command handlers: placement `:5866`, cancel `:7251`, modify `:7289`,
  cancel-all `:7344/7354`, margin `:7462` — all `execute(fn, 1|0, 0, {urgent:true})`.
- Margin handler `:7436–7515`: `await refreshFuturesAccountState({reason:'command'})`
  at `:7470` on the happy path; unresolved path `:7487` with `waitForDrain`.
  `reconcileAfterFuturesCommand` (`:4132`) is what the order handlers use.
- Pass marks resources `loading` at `:2416` (`markFuturesResourceLoading`),
  broadcast before admission.
- Reduction guard: `assessFuturesReduction` (`:5688`), refusal emitted
  `:5831` with `{cause}`; `FUTURES_REDUCTION_REFUSALS` texts `:5752`.
- Renderer: `FuturesTradingTicket.jsx:311–317` `positionSizingReady` (ready,
  or loading over a prior success) vs `positionCommandReady` (ready only);
  `:508–515` EXIT refused locally when not `positionCommandReady`;
  `resolveSubmitBlockReason` `:481`. `futuresReadiness.js:208` `stale`
  balance blocks every action. `useFuturesTrading.js:1773` `cancelOrder`
  sends unguarded; `awaitCommandOutcome` `:1672` holds the 15 s watcher.
- Record: `desk-diagnostic-record.js` `RECORDED_FIELDS` — `request` (`:369`),
  `deferred` (`:356`), `outcome` (`:476`), `display` (`:217`, the renderer's
  reporting path via the link).

## Decisions

### D1. Three standings; the desk's ceilings do not bind a command

`command` standing is added beside `urgent` and `ordinary`. `reservationWait`
for `command` compares only against the exchange margin
(`FUTURES_EXCHANGE_WEIGHT_LIMIT` 2 400 − `FUTURES_EXCHANGE_WEIGHT_MARGIN`
20) and the `429`/`418` backpressure floor; the weight is still booked so
the observed baseline stays honest. `nextAdmission()` lets a `command`
entry go first without counting or being bounded by passes — a cancel
during a 30-entry drain must not wait for the fairness cap that exists to
keep housekeeping alive. Ordinary keeps the bound.

Rejected: *a separate limiter for commands* — the exchange counts them on
the same address; two counters that do not see each other are how 2 600 gets
sent. *Weight 0 for commands* — a cancel is 1 at the exchange; booking what
the exchange books is the only way the baseline reconciles.

### D2. Ceilings 1 200 / 1 700, reserve 500, public 600

Operator's floor: «лимиты поднять до 1200 минимум». Ordinary 1 200 admits
the 21:40Z minute's whole housekeeping (697 charged, 809 observed) with room.
Urgent 1 700 keeps 1 700 + 600 (public, `FUTURES_PRODUCTION_WORKSTATION_READ_BUDGET`)
= 2 300 < 2 400, honouring the presentation canon's «the two ceilings together
stay below the exchange's». The reserve is therefore 500, and its stated
basis is the 90-weight command pass plus a proof read plus a config read
(90 + 5 + 6), against which 40 was measured on a burst that had no margin
command in it.

### D3. The margin command answers on the exchange's answer

Happy path: `void reconcileAfterFuturesCommand({ streamCannotReport: null })`
semantics — with the stream carrying, a narrowed `positions`+`balances` read
(`reason:'command'`, urgent) is issued and not awaited; without it the full
pass is issued and not awaited. The answer is emitted after
`noteFuturesMutation()`. The unresolved branch keeps `waitForDrain` — that
is the case the canon names («the screen is wrong until the read answers»).

### D4. The renderer's exit gate asks the sizing question, not the status

`positionCommandReady` := `positionSizingReady` (ready, or loading over a
prior success) — the main process is the authority and already proves the
leg against its newest reading. `futuresReadiness.js`: `stale` balance
returns attention only when `exposureIncreasing`; an exit passes with the
age stated by the existing reading notice. A withheld command is reported
through the renderer's diagnostic path (the `display` channel's transport)
as `outcome { action, result:'withheld', code }` — no price, no size.

### D5. One cancel in flight per order

`useFuturesTrading`: a `cancelsInFlight` set keyed by order identity; a
second `cancelOrder` for a held key returns `false` without sending; the
identity is released by the answer (`futures_execution_update`,
`command_rejected`, `command_unresolved`) or the existing 15 s watcher. The
row reads «cancelling…» from the same set.

### D6. The refusal states both numbers, the record their ratio

`FUTURES_REDUCTION_NOT_CONFIRMED` detail for `QUANTITY_EXCEEDS_LEG` carries
`requestedQuantity` and `openQuantity` (contract units, renderer-facing);
the `outcome` line carries `requestedToLegBps` = floor(requested / leg ×
10 000), a bounded count. The ticket's EXIT confirmation prints the leg
beside the staged size. Canon `futures-order-entry-fidelity` («refused, not
re-sized») stands: nothing is cut to fit.

### D7. The request line names its route

`onOperation` entries gain `route` from a closed vocabulary set by the
adapter per endpoint: `account`, `balance`, `positions`, `orders`,
`algo-orders`, `order`, `cancel`, `replace`, `cancel-all`, `margin`,
`income`, `history-orders`, `history-trades`, `symbol-config`,
`leverage-bracket`, `position-mode`, `listen-key`, `time`, `klines`,
`other`. Declared in `RECORDED_FIELDS.request`; absent → `other`.

## Residuals (recorded, not owned here)

- The history fan-out and the credit-confirm cadence keep their cost; with
  commands off their ceiling they cannot stall the hand, but they still burn
  ~600 weight a minute during a scalp. Follow-up: coalesce the fan-out per
  minute and cap pages per activity revision.
- The 30 s beat runs whenever the private stream has been quiet 30 s
  (`futuresPeriodicBeatIsHeld`, `:4101`) — 224 of 313 gaps on 2026-09-02.
- Dedup inherits standing (2026-08-23 residual) — moot for capacity at
  1 700, the queue-order half stands.
