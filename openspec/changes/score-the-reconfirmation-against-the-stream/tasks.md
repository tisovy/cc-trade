# Tasks

## 0. Measured first, 2026-09-03 (see proposal.md)

- `settled` lines 2026-09-02 (16) and 2026-09-03 (4): `missing: 0,
  differing: 0` are literals at `binance-connection.js:3489` since `ac1800e`;
  `compareFuturesSettledReadings` has no caller. `history-trades` requests
  2026-09-03: 88, none scored. Operator's ruling: the counters are the
  evidence for ending a read; a month of zeros ends it, one non-zero keeps it.

## 1. The history line (main process)

- [x] 1.1 Shadow of the stream: per contract, a bounded map trade identity →
      `{ price, quantity, commission, commissionAsset, realizedPnl, time }`
      as exact strings, fed at the execution-report site (`:4596`) beside
      `noteFuturesHistoryActivity`; bound `FUTURES_HELD_HISTORY_MAX_TRADES_PER_CONTRACT`
      newest per contract and the review window; cleared where the
      per-activation history state is cleared. The stream epoch's connect
      time is recorded beside `futuresHistoryStreamConnected = true`.
- [x] 1.2 `handleFuturesHistory`: at the per-contract acceptance (`:6943`)
      score the accepted rows against the shadow — `returned`, `restated`
      (time before the epoch's connect), `held`, `unreported`, `differing`
      (D2, D3); `vouched` from the proof captured at the start against the
      epoch at acceptance. Sum across covered contracts; one
      `diagnosticRecord.record('history', …)` per pass, including the
      all-failed early return (`outcome: failed`) and the obsolete path
      (`abandoned`). Fields: `reason`, `contracts`, `reads`, `returned`,
      `restated`, `held`, `unreported`, `differing`, `vouched`, `outcome`,
      `code`.
- [x] 1.3 `desk-diagnostic-record.js`: the `history` kind with those fields
      (`count` throughout, `reason` from `HISTORY_REASON`
      `fill|open|refresh|full|continuation|unstated`, `code` tolerated), a
      comment stating why a zero beside `vouched: 0` is not evidence.
      Done 2026-09-03: the renderer's set is `FUTURES_HISTORY_READ_REASONS`
      (`fill|open|refresh|full|stream|bootstrap`), `stream` and `bootstrap`
      added for the two callers D4 had not named; the record adds
      `continuation` and `unstated`.
- [x] 1.4 The read names its reason (D4): `createFuturesAccountHistoryCommand`
      carries `reason`; `scheduleHistoryGapRead` → `fill`, the review's open →
      `open`, ↻ → `refresh`, full re-read → `full`; the continuation walker →
      `continuation`; absent → `unstated`. Grep the canon and comments for the
      gap read described as unscored or as «one read per burst» only — a rule
      lives in more than one place.
      Done: the stream reconcile → `stream`, the activation basis read →
      `bootstrap`; the dock names `open` / `refresh` / `full`. The canon
      states the score only in this change's deltas;
      `confirm-a-fill-burst-once/design.md` keeps its residual as the record
      of when the read had none.

- [x] 1.5 The span's newest end (D2, after the first live lines): rows newer
      than the pass began, less `FUTURES_HISTORY_REPORT_FLIGHT_MS`, are
      `restated`, never `unreported`. Found on the first non-zero live line —
      37 of 86 rows «unreported» on a read that went out while the order was
      still filling, all 86 held 0.35 s later.

## 2. The settled score, restored (main process)

- [x] 2.1 `readFuturesSettledMoney`: capture the held rows before the walk;
      on `verifyFullWindow`, compare them per successfully answered lane
      inside `[coveredFrom, coveredTo]` with `compareFuturesSettledReadings`
      (extended to take the lane's span and type); `verified` = lanes
      compared, `missing` / `differing` the sums. Delete the literals at
      `:3489`; a warn line on any non-zero, as `4898a02` had.
- [x] 2.2 `desk-diagnostic-record.js`: the `settled` field comments say what
      `verified: 0` means for the two zeros beside it.

## 3. The summary

- [x] 3.1 `read-desk-record.mjs`: a `Reconfirmation` block — settled passes
      run / compared / `missing` / `differing`; history reads run / vouched /
      `returned` / `restated` / `held` / `unreported` / `differing`. Present
      whenever either kind occurred, zeros included. Fixture with the real
      shapes in `read-desk-record.test.mjs`.

## 4. Tests that bite, then the suite

- [x] 4.1 Against a `git archive` copy of HEAD first (never the live tree —
      an edit is a deployment): a gap read returning exactly the fills the
      stream reported → `held: n, unreported: 0, differing: 0, vouched: 1`
      (HEAD: no `history` line); the exchange returns one fill the stream
      never reported → `unreported: 1`; a commission restated → `differing: 1`;
      a reconnect inside the window → the older rows are `restated`, not
      `unreported`; an epoch change mid-pass → `vouched: 0`; the shadow's
      projection equals `tradeRowFromReport` on the same report; a
      `verification` settled pass whose held row the exchange no longer
      states → `missing: 1` (HEAD: 0); an extension pass → `verified: 0`.
      Assert through `describeDeskDiagnosticEvent`, never a mocked `record()`
      — the journal writes only declared fields. Name any test that passes on
      HEAD a guard, with the number.
      Done 2026-09-03 against the HEAD copy: every new case fails there (20
      failures across the seven edited suites, all new or re-pointed), none
      is a guard. `verified` on a settled pass is now the count of lanes
      compared, so the one existing assertion of `verified: 1` on a six-lane
      verification became `verified: 6`.
- [x] 4.2 Full suite, `eslint .`, build. Scope by grep (GitNexus MCP absent).
      Done 2026-09-03: full suite green, `eslint .` clean, build — see the
      commit. Scope by grep: the seven files in the proposal's Impact plus
      the new `futures-history-reconfirmation.js` and the two dock/hook
      call sites.

- [x] 4.3 The newest-end cut bites: the unit case (a row newer than the pass
      began → restated, the bound itself judged) and the integration case (a
      fill inside the read's own flight → `restated: 1`, one old enough →
      `unreported: 1`) fail on `c3ea7c5`; the five existing score cases let
      a report's flight pass before they read, as the burst timer does.

## 5. Operator verification (live) and the gate

- [ ] 5.1 A scalp with fills, then the summary: one `history` line per
      burst read with `reason: fill`, `vouched: 1`, and the counts; the
      hourly `verification` settled line with `verified` equal to the lanes
      it walked. Record in `live-verification-ledger.md`.
- [ ] 5.2 The gate, stated in the ledger: thirty consecutive daily summaries
      with `unreported: 0` and `differing: 0` on vouched history reads, and
      `missing: 0` and `differing: 0` on compared settled passes, open the
      change that ends the read. One non-zero keeps it, and its line names
      the day.
