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
chart hands over today.

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

## Residuals

- The new candle socket still costs one handshake through the proxy per
  switch (~1.3 s); a pool of interval sockets is not in scope.
- Index klines are fetched per switch for the basis overlay; unchanged.
