## Why

Opening a contract gives the trader 80 candles and nothing behind them. At the
default 15m that is twenty hours: not enough to see the range the price is
working in, and scrolling left runs off the end of the data instead of loading
more.

The 80 is not a Binance limit. The workstation fetches 99 klines
(`REQUEST_LIMITS.KLINES`), keeps up to 500, and delivers only the last
`RENDERER_CANDLES: 80` to the renderer, because a single protocol event is
bounded to 15 KB and every candle row is validated. That bound is deliberate
and is not worth trading away for depth — the contract catalogue already shows
the alternative, delivering hundreds of contracts as `offset/total/complete`
pages that the renderer buffers.

Binance itself has the depth: `/fapi/v1/klines` — already the reviewed
public-read route the workstation uses — serves up to 1500 candles per call and
any point in history through `endTime`, at weight 5. Nothing new has to be
trusted, connected, or authenticated to read it.

## What Changes

- **New**: a `candleHistory` resource, requested by the renderer and delivered
  as bounded pages, carrying candles strictly older than the live window. The
  live 80-candle window, its 15 KB frames and its per-tick update path are
  untouched — history is immutable data behind the tail, not a second writer to
  it.
- **New**: a `load.candleHistory` action carrying the contract, the interval and
  the exclusive `endTime` to read behind.
- On bootstrap the renderer asks for history once, so a freshly opened contract
  shows roughly 1000 candles instead of 80.
- Scrolling left past the loaded edge asks for the next page and prepends it,
  keeping the visible range anchored on the bars the trader was looking at.
  Requests are single-flight, and a page shorter than the request marks the
  start of the contract's history so the chart stops asking.
- History is discarded whenever the contract or the interval changes: an
  interval's candles are never shown under another interval's tail.
- **New**: a closed candle never changes, so history is cached in IndexedDB per
  contract and interval and survives a restart. A page already held is applied
  without asking the exchange at all — no request, no weight, no round trip on
  a lossy link. The Spot chart already caches its candles this way; this gives
  the Futures chart the same property.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: chart history depth, on-demand paged
  candle history, and viewport-preserving prepend.

## Impact

- Protocol: `src/utils/futuresWorkstationProtocolShared.js` (new action, new
  resource, payload validator), `src/utils/futuresProductionWorkstationProtocol.js`
  (request builder). Protocol version `5` → `6`; renderer and backend ship
  together, and the version guard makes a mismatch fail closed rather than
  silently misparse.
- Main process: `electron/services/futures-production-workstation-transport.js`
  (`endTime`/`limit` on the existing klines route, weight 5),
  `electron/services/futures-workstation-market-contract.js` (kline bound
  raised to the requested page size), `electron/services/futures-production-workstation-service.js`
  (request handling, paged emission, session ownership).
- Renderer: `src/hooks/useFuturesProductionWorkstation.js` (page buffer,
  `loadCandleHistory`), new `src/utils/futuresCandleHistoryCache.js` (IndexedDB,
  own database so the existing Spot cache cannot be disturbed),
  `src/components/features/futures/FuturesWorkstationView.jsx`,
  `src/components/features/futures/FuturesWorkstationChart.jsx` (merged series,
  left-edge detection, viewport preservation).
- No new dependency, no new route, no credentials. Cold-start latency is
  unchanged: bootstrap still fetches 99 candles at weight 1 and history arrives
  after the first paint.
- The Spot chart (500 candles, no paging) is out of scope here and follows in
  its own change.
