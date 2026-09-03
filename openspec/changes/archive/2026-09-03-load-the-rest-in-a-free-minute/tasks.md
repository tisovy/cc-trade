# Tasks

## 0. Measured first, 2026-09-03 (see proposal.md)

- Audit of `c62242d`/`a904662`/`bce9043`/`9604090`: 3 004 tests green, 64
  bite on the pre-change tree; one defect (crossings counted twice in the
  summary), four residuals. Operator's ruling: background contracts never
  reconnect on their own; the shown one is always current; the rest load in
  a free minute; a reload rebuilds the shown contract only.

## 1. The pool (main process)

- [x] 1.1 `parkSession(session, code)`: close stream, stop book, clear every
      timer, keep `status` as `resynchronizing` with the code, set
      `session.parked`, record `fault { phase: 'park' }`. Called from
      `handleDisconnect`, `handleCandleDisconnect`, the freshness monitor's
      error path and `recoverBook` when `!isShown(session)`; the shown
      session keeps its ladder and cooldowns unchanged.
- [x] 1.2 `handleRequest`: SUBSCRIBE/SELECT_SYMBOL of a parked held symbol
      → `startGeneration(request, emit, 0)` (takes the screen); a live held
      symbol → `selectHeldContract` as today; no other session touched.
- [x] 1.3 Warmer: `WARM_CHECK_MS` 5 000, `WARM_ROOM_WEIGHT` 120,
      `WARM_FLOOR_MS` 15 000, stated at the constants. One parked session
      per tick, most recently shown first, only while the shown session is
      bootstrapped and live, the budget has room, and the floor has passed.
      A wake that fails parks again. `timing { phase: 'lazy-bootstrap' }`
      per wake.
- [x] 1.4 Transport: `readBudgetRoom()` → `{ usedWeight, maximumWeight }`
      from the public budget's snapshot; the boundary guard admits it.
- [x] 1.5 Grep the canon and comments for «reconnects on its own ladder»,
      «whole session, shown or not», «invisible unless it lands on the
      shown contract» stated as behaviour of a background session — a rule
      lives in more than one place.

## 2. The chart (renderer)

- [x] 2.1 `FuturesWorkstationChart.jsx`: the data effect depends on
      `[candles, measurementGeneration]`; after the generation reset the
      held series is drawn in full. Test at the chart level with the
      lightweight-charts mock: interval prop changes with the same
      `candles` reference → `setData` is called with those rows after the
      clear (pre-change: only the clear).

## 3. The record and the summary

- [x] 3.1 `applyDelta`: `lastUpdateId` on the evidence is the book's
      identity before the diff. `recoverBook` raises its opening fault
      without the caller's evidence; a crossing inside a round keeps its
      own. Assert through `describeDeskDiagnosticEvent` and through the
      service test: one crossing → exactly one evidence line.
- [x] 3.2 `read-desk-record.mjs`: fixture with the real shape (one
      crossing = one `stream` evidence + one bare `book-recovery` fault) →
      count 1; `Exchange refusals (n)` by route from `request` lines with
      status `429`/`418`; `park` faults and `lazy-bootstrap` timings
      appear under their phases.

## 4. Tests that bite, then the suite

- [x] 4.1 Against a `git archive` copy of HEAD first (never the live tree —
      an edit is a deployment): a background session's socket closes → no
      reconnect timer, no `startGeneration`, one `park` fault (HEAD:
      ladder + full bootstrap); a background gap → parked (HEAD: snapshot
      read); selecting a parked contract → rebuilt at once, taking the
      screen; a reload subscribe for a live held contract → no read, no
      socket, others untouched; the warmer wakes one per tick only when the
      shown session is live and the budget has room, floor respected, most
      recently shown first (HEAD: no warmer); the chart redraw (2.1); one
      evidence line per crossing; the summary counts 1 and lists refusals.
      Name any test that passes on HEAD a guard, with the number.
      Done 2026-09-03 against `2b38c50`: 13 of the new tests fail there and
      pass here (the parking, the gap, the resubscribe, the three warmer
      cases, the reviewed transport's `readBudgetRoom`, the chart redraw,
      the book's `lastUpdateId`, the exchange refusals and the faults by
      phase). Three are guards: the record keeping `park`/`lazy-bootstrap`
      (the phase vocabulary was already open), the summary counting one
      crossing per evidence line (the double line was the service's,
      fixed in `2b38c50` by the other session), and the `lazy-bootstrap`
      timing under its phase. The other session's `2b38c50` landed the
      `recoverBook` half of 3.1 before this change started; the book's
      identity before the diff is this change's.
- [x] 4.2 Full suite, `eslint .`, the four guards, build. Scope by grep
      (GitNexus MCP absent). 2026-09-03: 3 016 tests in 131 files green,
      eslint clean, circular/runtime-mock/futures-production/command-path
      passed, `vite build` passed — all on a `git archive` working copy;
      the eleven files were then copied into the live tree in one pass
      (an edit is a deployment).

## 5. Operator verification (runbook, live)

Transferred to `openspec/live-verification-ledger.md` as `OUTSTANDING` rows
on 2026-09-03 so the change could be archived; the ledger is where the
operator's sitting closes them. Kept here as written.

- [ ] 5.1 Stop the proxy on 127.0.0.1:1080 for thirty seconds with eight
      contracts held, then restore it: the shown contract reconnects on
      its ladder; the journal shows seven `park` faults and no
      `startGeneration` for them; `lazy-bootstrap` timings then arrive one
      at a time, at least fifteen seconds apart, only after the shown
      contract is live.
- [ ] 5.2 Reload the window during the outage: one subscribe, the shown
      contract only; no read for the others. (A renderer reload closes the
      whole runtime — `binance-connection.js` on the renderer's socket
      close — so the pool is empty afterwards and only the subscribed
      contract opens; the held-and-parked path is what a renderer socket
      that drops and returns without a reload exercises.)
- [ ] 5.3 Select a parked contract: it rebuilds at once (1–2 s) and takes
      the screen; the journal shows its bootstrap and nothing for the rest.
- [ ] 5.4 Journal read after a session: `Crossed books` equals the number
      of `stream` evidence lines; `Exchange refusals` is zero, or says
      which route was refused.
- [ ] 5.5 Leave a reconnecting contract: select another while the shown
      one is on its ladder; the journal shows one `park` fault for it under
      the ladder's reason and no bootstrap after.

## 6. Self-audit after the deployment, 2026-09-03

- [x] 6.1 A shown session that left the screen on its ladder, on its candle
      ladder or inside a recovery round finished it in the background — the
      rung's bootstrap and reads, the round's remaining pages, the candle
      rung through `selectInterval`'s fallback. `showSession` parks the
      outgoing session under the reason it was stating
      (`bookRecoveryReason` while a round runs).
- [x] 6.2 The warmer's one-wake-at-a-time check read «not bootstrapped» as
      «loading»: a wake whose contract had been delisted stood
      `unavailable` and held the warmer for good. The check asks for
      `loading` now.
- [x] 6.3 A wake that kept failing was tried every floor, ahead of the
      rest: `lazyWakes` orders the parked sessions (fewest failed wakes
      first, then most recently shown) and holds a failed one
      `FLOOR_MS × 2ⁿ`, to `HOLD_CEILING_MS`. The shown session's candle
      ladder and interval bootstrap hold the tick as its socket ladder
      does.
- [x] 6.4 Bite against the deployed tree (this change before 6.1–6.3): the
      six new tests and the rewritten failed-wake test fail there, 108
      pass; on the fixed tree 115/115. Full suite 3 022 tests in 131
      files, eslint, the four guards, the build and the artifact boundary
      green on the `git archive` copy; the two files then carried into
      the live tree one at a time (a multi-file copy killed the dev server
      the first time).
