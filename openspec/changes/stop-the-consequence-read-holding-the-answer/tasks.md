## 1. Confirm the measured chain before touching it

- [ ] 1.1 Re-run the 2026-08-23 reading against the journal with fresh eyes: the
  five toggles, the `deferred` line (`waitedMs: 55093, spent: 796, ceiling:
  800`), the `observedWeight` reset 704 → 1 across the 08:27:00 minute
  boundary, and the two `-4046` answers. The stall must be reproducible from
  the record alone before any edit claims to remove it.
- [ ] 1.2 Blast radius by grep (GitNexus `impact` still refuses on this index):
  callers of `refreshFuturesAccountState` with `reason: 'setting'`, both
  configuration command handlers, `reconcilePhysicalResponse`,
  `reservationWait`, and every test that asserts the `answer` timing of these
  commands. Coordinate with the uncommitted resource-scoped refresh work in
  the same file before editing.

## 2. Release the answer, keep the read

- [ ] 2.1 Emit the `trade.setMarginType` answer after the configuration re-read
  broadcast; run the account pass detached with its failure reported through
  `reportDetachedFuturesAccountRefreshFailure`, or scoped-awaited only if the
  design records why the screen would be wrong without it.
- [ ] 2.2 The same for `trade.setLeverage`, which the 2026-08-22 change measured
  at 26–49 s under the same window.
- [ ] 2.3 Drop `withCeiling` from the mode-change re-read and verify the held
  ceiling survives a bracket-less configuration answer.
- [ ] 2.4 Verify by measurement that a second toggle pressed one second after
  the first answers in round-trip time while the first's account pass is still
  deferred.

## 3. Let the budget forget with the exchange

- [ ] 3.1 Expire or shrink the observed baseline at the exchange's minute
  boundary, keeping both conservative directions: never below locally booked
  unanswered work, never extending spend beyond what the exchange still
  reports.
- [ ] 3.2 Re-run the seven existing `RateLimiter` suites unchanged, plus the
  2026-08-22 change's deferred-record tests.

## 4. Tests that bite

- [ ] 4.1 Run each new test against the pre-change code in a copy of the tree
  (never the working tree — the desk runs from it); anything that passes there
  is a watchman and is named as one.
- [ ] 4.2 A command-lane test: with the budget one weight short of a 90-weight
  pass, a margin-mode toggle answers without waiting the window out, and a
  second toggle on the same contract is admitted behind it in round-trip time.
- [ ] 4.3 A baseline test: an observed weight recorded late in minute N stops
  deferring admissions once the exchange's counter has rolled to minute N+1.

## 5. Verification and operator gate

- [ ] 5.1 `OPENSPEC_TELEMETRY=0 openspec validate stop-the-consequence-read-holding-the-answer --strict`
- [ ] 5.2 Operator check, live: toggle a flat contract's mode twice within a few
  seconds during a session whose minute already carried a book bootstrap; both
  answers should land in about a second and the journal should carry no
  `deferred` line against either command's own reads. Keep unchecked until the
  operator confirms.
- [ ] 5.3 Archive only after the operator confirms live behaviour; otherwise
  record the observed gap as a tracked task or a follow-up change.
