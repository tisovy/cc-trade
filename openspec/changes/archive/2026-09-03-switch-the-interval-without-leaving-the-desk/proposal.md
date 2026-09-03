# Switch the interval without leaving the desk

## Why

The operator, 2026-09-02, on AKEUSDT: «когда были резкие прострелы — у меня
включался в этот момент другой график, и в какие-то моменты я не мог
выставлять ордера».

Measured (`desk-2026-09-02-000.jsonl`): 45 chart-interval switches in the
session (100 the day before — switching timeframes through a spike is how
the operator reads it), and every one of them is a `status … loading` line
for the **whole session**: `selectInterval`
(`futures-production-workstation-service.js:757`) empties the candle
series, publishes `LOADING` for the session, opens a new candle socket
through the proxy (`interval-stream`, ~1.3 s) and reads the klines, then
publishes `LIVE` 1.7–2.5 s later. In the renderer the session status is the
aggregate state of every panel that does not carry its own: the book and
the tape read `loading`, the candles are `null`, `chartPickable` is false,
and the chart gesture is unbound for the switch. Forty-five times two
seconds of a blind desk, each at the moment the operator chose to look
closer.

The interval is also the one selection the desk forgets: the contract is
restored on mount, the interval falls back to `15m`
(`FuturesProductionWorkstation.jsx:91`). The reload at 21:40:55Z brought the
operator back on a fifteen-minute chart in the middle of a scalp.

## What Changes

- **An interval change touches only the candles.** The session stays
  `live`; the book, the tape and the header are neither re-stated nor
  restated as loading; only the candles resource reads `loading` while the
  new interval's series is fetched, and the chart keeps the last drawn
  series under a stated state until the new one lands.
- **The chart stays pickable through the switch.** A price picked or a
  gesture made during the switch carries the reading it was taken off — the
  last candle, with its age — exactly as a stale chart does today.
- **The switch is visibly in progress.** A compact spinner sits over the held
  chart while the selected interval's candles are arriving, without covering
  the series or intercepting chart gestures, and leaves with the switching
  state.
- **History follows the series actually on screen.** While the previous
  interval is held through a switch, the chart does not request a page for the
  newly selected interval behind the previous interval's oldest candle. Once
  the new series lands, left-edge loading resumes behind that series, without
  a gap or a viewport jump.
- **The interval is remembered.** The last selected interval is restored on
  mount and after a reload, per operator; `15m` is the default only where
  none was stored.
- **The record sees the switch.** The renderer reports `interval-shown`
  with the interval left and the cause, so the journal reads a switch as a
  switch and not as a status transition to be inferred from timing phases.

## Impact

- Specs: `futures-workstation-presentation` (default interval → restored
  interval; market-data state does not disarm order entry, extended to the
  switch; a new requirement for what an interval change touches),
  `desk-diagnostic-record` (display transitions include the interval).
- Code: `electron/services/futures-production-workstation-service.js`
  (`selectInterval` status scope), `src/components/features/futures/FuturesWorkstationView.jsx`
  (aggregate vs candles state, pickability through the switch),
  `src/components/features/futures/FuturesProductionWorkstation.jsx`
  (interval persistence), `src/utils/futuresSymbolHistory.js` or a sibling
  store, `src/hooks/useFuturesProductionWorkstation*.js` (candles-scoped
  status and interval-owned history reads), `src/utils/chartSeriesDraw.js`
  (distinguish a prepended page from a replacement interval window),
  `desk-diagnostic-record.js` (display vocabulary).
- Not touched: the candle socket protocol, the interval picker, the
  history-page protocol, the book and tape delivery.
