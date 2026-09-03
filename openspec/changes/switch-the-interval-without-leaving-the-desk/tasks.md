# Tasks

## 0. Measured first, 2026-09-02

- 45 interval switches, each a session-wide `loading` of 1.7–2.5 s; the
  reload restored the contract and not the interval.

## 1. Main process

- [ ] 1.1 `selectInterval`: candles-scoped `loading`/`live`/`stale` status;
      session status untouched; `interval-bootstrap` failure marks candles
      stale with the reason and retries on the existing schedule.

## 2. Renderer (Lead React)

- [ ] 2.1 `FuturesWorkstationView`: keep the last delivered series during a
      switch; `candlesState` from the candles resource; book, tape, header
      unaffected; `chartPickable` while any series is drawn; a pick during
      the switch carries the loading reading and its age.
- [ ] 2.2 `FuturesProductionWorkstation` + `futuresSymbolHistory`: persist
      `lastInterval`, restore on mount; `15m` only when none stored.
- [ ] 2.3 Report `interval-shown` (`interval`, `from`, `cause`) through the
      display channel; declare in `desk-diagnostic-record.js`; assert through
      `describeDeskDiagnosticEvent`.

## 3. Tests that bite, then the suite

- [ ] 3.1 Against a `git archive` copy of HEAD first: a switch publishes no
      session `LOADING` (HEAD: publishes); the view keeps the series and
      `chartPickable` during a switch (HEAD: null, false); the book's state
      stays live through a switch (HEAD: loading); reload restores the
      stored interval (HEAD: 15m); `interval-shown` reaches the record.
- [ ] 3.2 Full suite, eslint, the four guards, build.

## 4. Operator verification (runbook, live)

- [ ] 4.1 Switch intervals through a moving market: the book and tape do not
      blink, a gesture during the switch stages an order with the reading's
      age stated, the chart replaces its series without going blank.
- [ ] 4.2 Reload: the chart comes back on the interval it was on.
- [ ] 4.3 Journal read: `interval-shown` lines match the switches; no
      session `loading` line for a switch.
