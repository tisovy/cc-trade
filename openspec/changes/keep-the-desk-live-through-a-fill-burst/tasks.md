# Tasks

## 0. Measured first, 2026-08-30

- Operator: «зависло на филлах … когда идет PARTIALLY FILLED — какие-то
  тормоза»; all commands landed `ok`, nothing mispriced.
- `desk-2026-08-30-002.jsonl`: bursts 25–59 PARTIALLY_FILLED/min; arrival
  peaks 32–46 orders+account frames/s; commit p50 400 ms (quiet 17 ms);
  frame `totalMs` to 6 428 ms; 286/409 order frames `NOT_DRAWN`.
- 18:47:00Z: window `spent: 799–800/800`, deferred waits 9.2–14.5 s (urgent
  weight-1: 9 229 ms; 17:27:59Z urgent weight-5: 33 574 ms); answers
  placeOrder 9 573 ms, replaceOrder 11 532 ms, cancels 4.2–5.4 s,
  feeValuation 30 192 ms. Fifteen 90-weight `refresh` passes 18:40–18:46.
- Full mechanism map with line numbers: `design.md`. Evidence recorded in
  `openspec/live-verification-ledger.md`, The 2026-08-30 Operator Sitting.

## 1. The budget answers the hand (main process)

- [x] 1.1 `RateLimiter`: `reservationWait()`/booking take the request's
      standing; ordinary capacity is checked against
      `maxWeight − FUTURES_COMMAND_WEIGHT_RESERVE` (40, measured basis
      stated at the constant), urgent against `maxWeight`. Exchange
      backpressure (`429`/`Retry-After`) is not subject to the reserve.
      The `deferred` journal line is unchanged in shape.
- [x] 1.2 The `account.refresh` handler holds a `periodic: true` pass while
      (a) the private stream delivered a frame within the beat interval and
      (b) the last completed pass is younger than
      `FUTURES_RECONCILE_MAX_QUIET_MS` (300 000). Held beats are counted;
      the next pass's `read` line carries `heldBeats` — declare the field
      in `desk-diagnostic-record.js` AND assert it through
      `describeDeskDiagnosticEvent` (the record writes only declared
      fields; a mocked `record()` proves nothing). Manual refresh,
      bootstrap, reconnect, command-driven reads untouched.
- [x] 1.3 Correct the false narrowing comment at the refresh handler
      (`binance-connection.js:7573`) and grep for the same claim stated
      anywhere else — headings, canon, comments (a rule lives in more than
      one place; grep by meaning, not name).

## 2. One commit per cluster (renderer)

- [ ] 2.1 `useFuturesTrading.handleMessage` queues account-lane frames and
      drains in one state update: first frame after quiet applies
      immediately; frames within `FUTURES_EXECUTION_COMMIT_WINDOW_MS`
      (100, measured basis at the constant) fold into one trailing drain,
      in arrival order, none dropped.
- [ ] 2.2 `futuresHeldHistory`: batch fold of N execution reports with one
      filter+sort+bound pass; result byte-identical to N sequential
      upserts (assert equality against the sequential fold).
- [ ] 2.3 The review chain (`roundTradeHistory` → round index → wallet
      ledger → settled money) follows a `reviewGeneration` trailing
      `tradeGeneration` by `FUTURES_REVIEW_FOLD_TRAIL_MS` (1000): at most
      one fold per second during a burst, immediate catch-up when the
      burst ends, immediate outside one. Working orders, positions,
      plates, lastExecution stay on the immediate path.
- [ ] 2.4 `FuturesWorkstationChart`: price lines keyed by order identity,
      diffed — only changed/added/removed orders touch
      `createPriceLine`/`removePriceLine`; unrelated orders' lines and
      handles are not recreated by another order's fill.

## 3. The instrument tells the truth in a burst

- [ ] 3.1 The drain judges each pending frame at its own commit; an entry
      behind a newer report of the same order in the same drain reads
      `SUPERSEDED` (new code in `FRAME_DELIVERY_CODES`, declared in the
      record, added to the canon's readings-kept-apart). `NOT_DRAWN`
      remains "the newest state of this order is not on the screen".

## 4. Tests that bite, then the suite

- [ ] 4.1 Each new test verified failing against the pre-change tree
      (`git archive` → scratch copy — an edit is a deployment; never run
      mutation tests in the live tree). At minimum: limiter — ordinary
      refused above `ceiling − reserve` while urgent weight-1 admits at
      the same spend (HEAD: both defer); beat — held while stream speaks,
      runs at the quiet ceiling, runs when the stream is silent, manual
      refresh unaffected, `heldBeats` reaches the written line (assert at
      `describeDeskDiagnosticEvent`); drain — N frames in one window = one
      commit with every fill folded (HEAD: N commits), first-frame
      immediacy; review — fold count bounded per trailing window while
      openOrders update per drain (HEAD: fold per commit); chart — spy on
      create/remove price line counts under one order's fill; instrument —
      older same-order report in a drain reads `SUPERSEDED`, newest judged
      against the screen (HEAD: `NOT_DRAWN`).
- [ ] 4.2 Extend `App.futures-burst.test.jsx`: under the recorded burst
      shape (clusters of 5–7 frames per 200 ms), commits per second are
      bounded by the window and the execution-apply bound
      (`EXECUTION_APPLY_BOUND_MS`) still holds; count commits, not
      wall-clock, where determinism needs it.
- [ ] 4.3 Full suite, eslint on touched files, the four repository guards,
      build. Scope check by grep (GitNexus impact returns 0/LOW even for
      plain ESM imports into .jsx — grep is authoritative).

## 5. Operator verification (runbook, live)

- [ ] 5.1 Next burst session, by hand: while an order is PARTIALLY_FILLED,
      dragging another order stays smooth and commands answer promptly —
      no multi-second freeze.
- [ ] 5.2 Journal read (Claude, after that session): orders-lane
      `NOT_DRAWN` near zero with `SUPERSEDED` carrying the burst;
      committedMs p50 back to tens of ms; no urgent `deferred` above ~1 s;
      `heldBeats` > 0 while trading with the stream alive; `refresh`
      weight per minute down against 2026-08-30's fifteen-in-seven.
- [ ] 5.3 Quiet-side control: with the stream down (the D1 proxy stop, or
      naturally), the beat runs again at 30 s — the journal shows `refresh`
      passes resuming while the stream is silent.
