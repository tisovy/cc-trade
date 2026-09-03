# Design — switch the interval without leaving the desk

## Code map

- Service `selectInterval` (`futures-production-workstation-service.js:757–855`):
  `session.candles = []`, `session.indexCandles = []`,
  `emitStatus(session, LOADING)` (`:789`), `stream.selectInterval` (new
  socket; transport `:961–999`), `bootstrapInterval` (klines), emit series,
  `emitStatus(session, LIVE)` (`:827`); failure → `scheduleIntervalResync`.
- Renderer `FuturesWorkstationView.jsx:297–345`: `candleSelectionOwned`
  requires `state.interval === selectedInterval`; `candles` null otherwise;
  `aggregateState` from `state.status`; `resourceState(resource) =
  resource?.state ?? aggregateState`; `chartCandles` from history + live;
  `chartPickable = chartCandles.length > 0` (`:368`);
  `onTradingGesture={chartPickable ? … : undefined}` (`:1182`).
- Interval state `FuturesProductionWorkstation.jsx:91`
  (`useState(DEFAULT_FUTURES_INTERVAL)`); symbol history store
  `src/utils/futuresSymbolHistory.js` (no interval).
- Record `display` fields (`desk-diagnostic-record.js:217`): `event`,
  `symbol`, `from`, `cause`.

## Decisions

### D1. The status the switch publishes is the candles', not the session's

`selectInterval` publishes the candles resource as `loading` (a
resource-scoped status the renderer already reads through
`resourceState`) and leaves the session status untouched. The session goes
`LOADING` only for what actually restarts it (generation start, reconnect).
On failure, `scheduleIntervalResync` marks the candles resource `stale`
with the reason and retries; the session stays live throughout.

### D2. The chart keeps drawing the last series it had

`candleSelectionOwned` no longer nulls the series: the view holds the last
delivered series and its interval, draws it with `candlesState = 'loading'`
stated beside the chart (the existing non-live notice), and replaces it when
the new interval's series arrives. `chartPickable` stays true while any
series is drawn; a pick during the switch carries `describeFuturesPriceReading`
with state `loading` and the last candle's age — the same object a stale
chart hands over today. The chart frame also renders a small progress spinner
from `intervalSwitchPending`, the authoritative `candlesSwitching` flag gated
to the selected candle owner. This remains true when a rapid switch returns to
the interval of the held series before either request settles; comparing only
the held and selected interval would incorrectly call that in-flight chart
live. The spinner has an accessible loading name and `pointer-events: none`, so
it states the wait without turning the retained chart into a blocked loading
curtain.

### D3. The interval is stored beside the contract

`futuresSymbolHistory` gains `lastInterval` (validated against
`FUTURES_WORKSTATION_INTERVALS`); the workstation seeds from it and writes on
every change. Per operator, not per contract: the operator reads the same
timeframe across contracts and changes it by hand.

### D4. `interval-shown` on the display line

`display` gains `event: 'interval-shown'` with `interval`, `from` (the
interval left) and `cause` (`operator` | `restored`); the `symbol` field
names the contract. Declared and asserted through
`describeDeskDiagnosticEvent`.

### D5. A history read belongs to the interval of the series it extends

During a switch the chart deliberately continues drawing the interval being
left. Its oldest candle is therefore not a valid `endTime` for a history
request stamped with the interval just selected. The hook refuses that read
while `liveInterval` names another interval, and exposes a new history callback
when the selected interval's series lands so the chart retries its left edge
behind the correct window.

The shared viewport helper treats rows as prepended only when the first row
previously drawn is still present immediately after them. A new interval's
window that reaches farther back but contains none of the previous series is a
replacement, not a prepend, so it must not shift the visible logical range.

## Residuals

- The new candle socket still costs one handshake through the proxy per
  switch (~1.3 s); a pool of interval sockets is not in scope.
- Index klines are fetched per switch for the basis overlay; unchanged.

## Implemented 2026-09-03 — what changed against this design

- D1 landed simpler than written: the service publishes no status for a
  switch at all (the failure path was already candles-scoped). A switch that
  recovered from a candle-socket failure still clears the reason it left.
- D2 rides an explicit hook flag, `candlesSwitching`, set on an interval-only
  change and cleared by the first candles frame at the new interval. The
  view draws the held series under `loading` while it is set. The flag, not
  the interval on the series, is the switch: a series delivered at another
  interval outside a switch is simply not this selection's (the burst
  harness replays 1m frames under a 15m selection and must read live).
- D3 lives in its own store, `futuresIntervalHistory.js`, rather than inside
  the contract history's five pure functions.
- D4 carries `interval` and `fromInterval` as their own display fields — an
  interval does not pass the symbol validator that `from` uses.
- D5 was added after operator verification exposed two coupled failures: the
  held series could seed a history request for the newly selected interval,
  and the replacement window could be mistaken for hundreds of prepended
  rows. Both are renderer-only; the history protocol remains unchanged.
