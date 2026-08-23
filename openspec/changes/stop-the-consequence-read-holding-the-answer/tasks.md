## 1. Confirm the measured chain before touching it

- [x] 1.1 Re-run the 2026-08-23 reading against the journal with fresh eyes: the
  five toggles, the `deferred` line (`waitedMs: 55093, spent: 796, ceiling:
  800`), the `observedWeight` reset 704 → 1 across the 08:27:00 minute
  boundary, and the two `-4046` answers. The stall must be reproducible from
  the record alone before any edit claims to remove it.
  Confirmed 2026-08-23 against `desk-2026-08-23-000.jsonl` before editing:
  answers 1 823 / 56 752 / 52 132 / 48 044 / 45 202 ms, the `deferred` line at
  08:27:56.614 with exactly those figures, 704 at 08:26:57.999 → 1 at
  08:27:00.532, `-4046` at 08:27:59.092 and 08:28:00.117.
- [x] 1.2 Blast radius by grep (GitNexus `impact` still refuses on this index):
  callers of `refreshFuturesAccountState` with `reason: 'setting'`, both
  configuration command handlers, `reconcilePhysicalResponse`,
  `reservationWait`, and every test that asserts the `answer` timing of these
  commands. Coordinate with the uncommitted resource-scoped refresh work in
  the same file before editing.
  Done 2026-08-23: `reason: 'setting'` is sent by the two handlers alone;
  `reconcilePhysicalResponse` has one production caller (`observeResponse`);
  `reservationWait` is called only from `reserve`; the two existing
  margin-mode tests survive the detach because the pass's operations are
  requested synchronously inside the handler. Coordination held: the peer
  session confirmed its file work committed (`ac3a1a3`) and that the
  uncommitted `RateLimiter` fairness hunks at 597–683 belong to a third
  session — this change was built on top of the working tree and staged by
  its own hunks only.

## 2. Release the answer, keep the read

- [x] 2.1 Emit the `trade.setMarginType` answer after the configuration re-read
  broadcast; run the account pass detached with its failure reported through
  `reportDetachedFuturesAccountRefreshFailure`, or scoped-awaited only if the
  design records why the screen would be wrong without it.
  Done 2026-08-23: detached on the existing pattern, reason `'setting'`; the
  answer now closes on the configuration broadcast.
- [x] 2.2 The same for `trade.setLeverage`, which the 2026-08-22 change measured
  at 26–49 s under the same window.
- [x] 2.3 Drop `withCeiling` from the mode-change re-read and verify the held
  ceiling survives a bracket-less configuration answer.
  Verified by `re-reads a margin-mode change without the bracket table and
  keeps the held ceiling`: no second bracket request, `maxLeverage` 125 still
  broadcast after the mode change.
- [x] 2.4 Verify by measurement that a second toggle pressed one second after
  the first answers in round-trip time while the first's account pass is still
  deferred.
  Measured in the suite's scaled time: `answers a margin-mode change and the
  next toggle while the account pass is still out` drives both toggles through
  the per-contract lane with the pass provably in flight (its payload never
  answers) and both answers land inside the drain. The live half of this
  measurement is gate 5.2.

## 3. Let the budget forget with the exchange

- [x] 3.1 Expire or shrink the observed baseline at the exchange's minute
  boundary, keeping both conservative directions: never below locally booked
  unanswered work, never extending spend beyond what the exchange still
  reports.
  Done 2026-08-23: the baseline is stamped at the start of the interval it was
  observed in (`intervalStart = now - (now % windowMs)`), so the window prunes
  it exactly at the exchange's boundary. A sample received after a boundary
  can only describe that interval or an older one, so the stamp never releases
  spend early; unresolved local reservations keep their own timestamps.
- [x] 3.2 Re-run the seven existing `RateLimiter` suites unchanged, plus the
  2026-08-22 change's deferred-record tests.
  483 tests green across `rate-limiter-production`, `rate-limiter`,
  `binance-connection`, `desk-diagnostic-record`, `trading-command-registry`
  and `futures-trading-adapter` suites, in the pre-change copy and again in
  the working tree; not one existing expectation edited.

## 4. Tests that bite

- [x] 4.1 Run each new test against the pre-change code in a copy of the tree
  (never the working tree — the desk runs from it); anything that passes there
  is a watchman and is named as one.
  All six bit the pre-change copy on 2026-08-23: the two lane tests failed by
  timeout (the answer really did wait), the ceiling test counted a second
  bracket read, the three budget tests held the expired spend. No watchmen.
- [x] 4.2 A command-lane test: with the budget one weight short of a 90-weight
  pass, a margin-mode toggle answers without waiting the window out, and a
  second toggle on the same contract is admitted behind it in round-trip time.
  `answers a margin-mode change and the next toggle while the account pass is
  still out` (the deferred pass stood in by one whose payload never answers —
  the lane semantics are identical), plus the same shape for `setLeverage`.
- [x] 4.3 A baseline test: an observed weight recorded late in minute N stops
  deferring admissions once the exchange's counter has rolled to minute N+1.
  `releases an observed baseline when the exchange interval that reported it
  ends`, `keeps locally booked unanswered work when the exchange interval
  rolls`, and `admits a small read once the boundary passes instead of
  deferring a full window` — the last replaying the 08:26:58 → 08:27:00
  journal shape at 796/800.

## 5. Verification and operator gate

- [x] 5.1 `OPENSPEC_TELEMETRY=0 openspec validate stop-the-consequence-read-holding-the-answer --strict`
  Valid, 2026-08-23, after the implementation evidence above was written in.
- [ ] 5.2 Operator check, live: toggle a flat contract's mode twice within a few
  seconds during a session whose minute already carried a book bootstrap; both
  answers should land in about a second and the journal should carry no
  `deferred` line against either command's own reads. Keep unchecked until the
  operator confirms.
- [ ] 5.3 Archive only after the operator confirms live behaviour; otherwise
  record the observed gap as a tracked task or a follow-up change.
