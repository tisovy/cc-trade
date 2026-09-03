# Tasks

## 0. Measured first, 2026-09-02

- 45 interval switches, each a session-wide `loading` of 1.7–2.5 s; the
  reload restored the contract and not the interval.

## 1. Main process

- [x] 1.1 `selectInterval`: candles-scoped `loading`/`live`/`stale` status;
      session status untouched; `interval-bootstrap` failure marks candles
      stale with the reason and retries on the existing schedule.
      **As landed 2026-09-03**: the service publishes no session status for a
      switch at all — the renderer knows the interval it asked for and holds
      the last series itself; the failure path was already candles-scoped
      (`UNAVAILABLE` on the candles resource, session live with the reason)
      and is unchanged; a switch that recovered from a candle-socket failure
      still clears the reason on the status line.

## 2. Renderer (Lead React)

- [x] 2.1 `FuturesWorkstationView`: keep the last delivered series during a
      switch; `candlesState` from the candles resource; book, tape, header
      unaffected; `chartPickable` while any series is drawn; a pick during
      the switch carries the loading reading and its age.
- [x] 2.2 `FuturesProductionWorkstation` + `futuresSymbolHistory`: persist
      `lastInterval`, restore on mount; `15m` only when none stored.
- [x] 2.3 Report `interval-shown` (`interval`, `from`, `cause`) through the
      display channel; declare in `desk-diagnostic-record.js`; assert through
      `describeDeskDiagnosticEvent`.

## 3. Tests that bite, then the suite

- [x] 3.1 Against a `git archive` copy of HEAD first: a switch publishes no
      session `LOADING` (HEAD: publishes); the view keeps the series and
      `chartPickable` during a switch (HEAD: null, false); the book's state
      stays live through a switch (HEAD: loading); reload restores the
      stored interval (HEAD: 15m); `interval-shown` reaches the record.
      **Done 2026-09-03**: six of the new/rewritten tests fail on a
      `git archive` copy of the pre-change tree — the service's three
      switch tests (a session `status` frame there), the view's «keeps
      drawing the last series under loading», the container's picker
      report and the stored-interval restore. The record's `interval-shown`
      test bites through the display vocabulary.
- [x] 3.2 Full suite, eslint, the four guards, build. **2026-09-03**: 3 003 tests green, `eslint .` clean, four guards ok, build ok.

## 4. Operator verification (runbook, live)

- [ ] 4.1 Switch intervals through a moving market: the book and tape do not
      blink, a gesture during the switch stages an order with the reading's
      age stated, the chart replaces its series without going blank.
- [ ] 4.2 Reload: the chart comes back on the interval it was on.
- [ ] 4.3 Journal read: `interval-shown` lines match the switches; no
      session `loading` line for a switch.
