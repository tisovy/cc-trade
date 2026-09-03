# Tasks

## 0. Measured first, 2026-09-02 (see design.md)

- Operator: «не мог выйти из позиции … нажал перезагрузку … мог улететь в
  ликвидацию». `desk-2026-09-02-000.jsonl`: margin answer 24 362 ms; four
  cancels 15–20 s, three `-2011`; urgent w=40 deferred 19 314 ms at 766/800;
  urgent w=1 deferred 2 195 ms at 809/800; no `placeOrder` line during the
  stall; two `QUANTITY_EXCEEDS_LEG` refusals.

## 1. The budget (main process)

- [x] 1.1 `RateLimiter`: `command` standing. `reservationWait` for it checks
      only the exchange margin (`FUTURES_EXCHANGE_WEIGHT_LIMIT` 2 400 −
      `FUTURES_EXCHANGE_WEIGHT_MARGIN` 20, both stated) and the `429`/`418`
      floor; weight still booked. `nextAdmission` lets a `command` entry go
      first, uncounted by the overtake bound; urgent keeps the bound.
      `deferred` line writes `standing: 'command'` when the exchange margin
      held it (declare in `desk-diagnostic-record.js`, assert through
      `describeDeskDiagnosticEvent`).
- [x] 1.2 Ceilings: `futuresRestLimiter` `maxWeight` 1 700,
      `FUTURES_COMMAND_WEIGHT_RESERVE` 500 (ordinary ceiling 1 200), basis
      stated at the constant (90 + 5 + 6). Assert 1 700 + public 600 < 2 400
      in the existing ceilings-against-the-exchange test. Correct the design
      note in `keep-the-desk-live-through-a-fill-burst/design.md` («the
      ceiling is the exchange's») by a dated line, and grep the canon for
      «800» stated as the exchange's.
- [x] 1.3 Every command handler (`placeOrder`, `cancelOrder`, `modifyOrder`,
      `cancelAll` ×2, `adjustPositionMargin`, `closePosition` if separate)
      passes `{ standing: 'command' }`; proof/consequence reads stay urgent.
- [x] 1.4 `handleFuturesAdjustPositionMargin`: happy path issues
      `reconcileAfterFuturesCommand`-style read (narrowed to
      positions+balances when the stream carries) without awaiting; answer
      emitted after `noteFuturesMutation()`. Unresolved path unchanged
      (`waitForDrain`).

## 2. The refusal says the numbers

- [x] 2.1 `assessFuturesReduction` returns `requested` and `open` for
      `QUANTITY_EXCEEDS_LEG`; rejection detail carries both; `outcome` line
      carries `requestedToLegBps` (declared field, bounded count).

## 3. The renderer (Lead React)

- [x] 3.1 `FuturesTradingTicket.jsx`: `positionCommandReady` uses the sizing
      rule (ready, or loading over a prior success); EXIT confirmation shows
      the current leg beside the staged size.
- [x] 3.2 `futuresReadiness.js`: `stale` balance → attention only when
      `exposureIncreasing`; an exit proceeds with the reading-age notice.
- [x] 3.3 `useFuturesTrading.js`: `cancelsInFlight` per order identity;
      second cancel not sent; released on answer / rejection / unresolved /
      watcher timeout; working-order row states «cancelling…».
- [x] 3.4 A withheld command (readiness refusal, missing leg, cancel already
      in flight) is reported to the record as `outcome { result:'withheld',
      code }` through the renderer's diagnostic path; no price or size.

## 4. The record names the route

- [x] 4.1 `futures-trading-adapter.js`: every endpoint states its route from
      the closed vocabulary; `onOperation` carries it; `RECORDED_FIELDS.request`
      declares `route`; summary tool groups charged weight by route.

## 5. Tests that bite, then the suite

- [x] 5.1 Each new test run against a `git archive` copy of HEAD first
      (never mutate the live tree — an edit is a deployment): limiter —
      `command` admitted at spent 1 690/1 700 while urgent w=40 waits (HEAD:
      both wait); `command` held at observed 2 390 (exchange margin); ordinary
      refused above 1 200; margin — answer emitted before the pass resolves
      (HEAD: after); ticket — EXIT sent while positions `loading` over a
      prior success (HEAD: withheld); readiness — exit passes on `stale`
      balance (HEAD: blocked); cancel — second cancel not sent while first in
      flight (HEAD: sent); record — `route`, `requestedToLegBps`,
      `standing:'command'`, `withheld` reach `describeDeskDiagnosticEvent`.
      Name any test that passes on HEAD a guard, with the number.
      **Done 2026-09-03**: 28 of the new tests fail on a `git archive HEAD`
      copy (the margin answer times out at 5 011 ms there; the ticket
      withholds; the second cancel is sent; the stale exit is held; the
      record drops `route`/`withheld`/`command`). Guards, passing on HEAD by
      design: readiness «still holds an entry» and «still holds an exit on
      a failed reading»; limiter «measures a command as urgent where no
      exchange limit is stated», «does not shorten exchange backpressure»,
      «leaves a limiter with no reserve exactly at its ceiling», «admits an
      ordinary request larger than ceiling less reserve».
- [x] 5.2 Limiter stand: 300 requests mixed standings with random aborts;
      no command ever waits on capacity below the exchange margin; ordinary
      never books past 1 200; window never exceeds 1 700 + margin.
- [x] 5.3 Full suite, eslint on touched files, the four guards, build. Scope
      by grep (GitNexus `impact` returns 0/LOW for ESM imports — decorative).
      **2026-09-03**: 3 014 tests green (baseline 2 989 + 25), `eslint .`
      clean, four guards ok, `npm run build` ok. GitNexus MCP absent; scope
      by grep of every touched symbol.

## 6. Operator verification (runbook, live)

- [ ] 6.1 During a scalp with fills: add margin, then cancel and place within
      the same second — every answer under ~1 s; journal shows no `deferred`
      with `standing:'command'` and no urgent wait above ~1 s.
- [ ] 6.2 Exit while the account is re-reading (press refresh, then close):
      the close leaves; no `withheld` line for it.
- [ ] 6.3 Double-click cancel: one `cancelOrder` line, no `-2011`.
- [ ] 6.4 Journal read after: `request` lines grouped by `route`; per-minute
      observed weight never above 1 700 + 600.
