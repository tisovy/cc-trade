# Design — read candles from the nearest source

## Code map

- Live window: `futures-production-workstation-service.js` `startGeneration`
  (`:1043`, `deliverBootstrapResource('contractKlines')` `:1273` →
  `emitCandleSeries`) and `selectInterval` (`:681`, `intervalBootstrapping =
  true` `:714`, the exchange window `:746`). The transport reads 99 klines at
  weight 1 (`KLINES: 99`, `KLINES_99: 1`); the renderer is handed the newest
  80 (`RENDERER_CANDLES`, `toRendererCandleRows`). A candles frame carries
  exactly `series`, `interval`, `rows` (`validateCandles`) and a `state`.
- History: renderer `useFuturesProductionWorkstation.js` `loadCandleHistory`
  (`:839`): the IndexedDB run first (`futuresCandleHistoryCache.js`,
  `readPage` serves only a full contiguous page ending at `endTime`), else
  `load-candle-history` to main; service `loadCandleHistory` (`:532`) →
  transport `readCandleHistory` (`:706`, `endTime − 1`, limit 1 000, weight
  5) → `emitCandleHistory`; the renderer writes every served page back to its
  cache (`:738`) and reads `total < 1000` as the history's start (`:743`).
- Rows: `normalizeFuturesWorkstationKlines(text)` (`market-contract.js:411`)
  takes the exchange's 12-tuples and answers `{ openTime, closeTime, open,
  high, low, close, volume, closed }` with canonical decimals, sorted, no
  duplicates, ≤ 1 000 rows.
- Boundary: `scripts/check-futures-workstation-boundaries.mjs` — network
  modules and `fetch(` only in the reviewed transport; compositions must not
  read the environment; a workstation module is any file named `*workstation*`.
- Record: `timing` lines carry `phase` (free identifier), `durationMs`,
  `outcome`, `cache` (`hit|miss|shared|stale`), `code`.
- `hunter`: `ui/backend/api/candles.py` `GET /api/candles/{symbol}` with
  `market=usdm`, `tf` ∈ 1m 5m 15m 30m 1h 4h 1d 1w, `from`/`to` (half-open,
  floored to the minute), `limit` ≤ 20 000; answers `bars[{time (s), open,
  high, low, close, volume}]`, `coverage_complete`, `gap_count`,
  `actual_from`, `actual_to`; buckets by Timescale `time_bucket`, weeks
  Monday-aligned as Binance's; partial buckets from the minutes that exist;
  spans the database does not cover are topped up from Binance REST
  (`topup_usdm_bars`, up to 8 × 1 500 klines) when the backend holds a REST
  client — it does (`app.state.fuel_client`). Served by `ui.service`
  (systemd user unit, `Restart=always`), separate from the scanner that
  writes the minutes (`hunter-runtime.service`).

## Decisions

### D1. One reviewed loopback reader, in main

`futures-workstation-candle-store.js` is the second network module of the
workstation, beside the transport, and the boundary guard is taught its
shape: `node:http` only, one `http.request`, GET, no headers, no agent, a
URL whose host is loopback, `market=usdm` and `topup=false` in the query, a
body ceiling, a 1 500 ms deadline. It reads its URL from
`FUTURES_CANDLE_STORE_URL` itself, as the transport reads its proxy; the
compositions stay environment-free. The production composition constructs
it; the verification composition does not, and its deterministic transport
stays the only source there.

Rejected: *the renderer reading `hunter` directly* — the renderer has no
network but the one reviewed loopback WebSocket, and that is the rule that
keeps credentials and hosts out of the bundle. *Reading Postgres directly* —
a driver and a password in the desk's environment for what an existing,
tested endpoint already answers; kept as the fallback design if `hunter`'s
UI backend proves too volatile.

### D2. The store answers exactly what the exchange would, or nothing

Bars become the exchange's 12-tuples (`openTime = time × 1000`, `closeTime =
openTime + interval − 1`, amounts printed to eight places and trimmed, the
fields the store has no value for as zero) and go through
`normalizeFuturesWorkstationKlines`, so a row that would not pass from the
exchange does not pass from the store either.

A **page** is served only when `coverage_complete`, `gap_count = 0` and the
answer holds exactly `limit` buckets: the same rows the exchange would send
for `[endTime − limit × interval, endTime)`. Anything less is «not covered»
and the next source is asked — a short store answer must never reach the
renderer, which reads a short page as the contract's first candle.

A **window** is served as the whole buckets between the first minute the
store has of the span and its last, provided no minute between the two is
missing: `gap_count` must equal the minutes outside `[actual_from,
actual_to)`, and a bucket that starts before `actual_from` or ends after
`actual_to` — built by the store from part of itself — is trimmed off. So a
database that started on 2026-07-30 17:20 serves the daily bars from
2026-07-31 on and not a 30 July made of seven hours, a scanner a few minutes
behind shortens the window instead of failing it, and a young listing's
first partial candle is the exchange's to draw. (The first cut served the
partial bucket at the head and refused a window whose tail the scanner had
not reached; audit, 2026-09-04.) The window ends at the newest bucket that
closed at least `SETTLE_MS` (3 min) ago and starts where the exchange's
80-row window will start (`currentBucket − 79 × interval`), so the
exchange's window shares its first bar and lands as an append, never a shift.

Both spans are asked only on the interval's buckets. The exchange's weekly
candles open on Monday 00:00 UTC and so do the store's weekly buckets; the
epoch was a Thursday, and a week floored to it asked the store for a window
opening on a Thursday, answered with a bucket made of four days. The store
knows the week's epoch offset (`FUTURES_CANDLE_STORE_WEEK_EPOCH_OFFSET_MS`),
and a page whose `endTime` is not on a bucket — the renderer always ends a
page at the open of the oldest bar it draws — is the exchange's to answer.

### D3. Three sources, and why the renderer's cache stays first

The operator's order is database → app cache → exchange. Both free sources
hold closed candles, and a closed candle does not change: whichever of the
two holds the whole page answers with the same rows. The renderer's cache is
in-process and answers in a millisecond; the store is a loopback request and
a query over a compressed hypertable. So the renderer keeps asking its own
cache first and main asks the store before the exchange — app cache → store
→ exchange in effect, one round trip to main in every case, and the store's
pages are written to the app cache on the way back so the desk still has
them when `hunter` is down. If the operator wants the database consulted
first regardless, the renderer skips its cache read; the wire does not change.

### D4. The window arrives twice, and the switch waits for the second

On `startGeneration` and `selectInterval`, once the session is shown and its
`interval` set, the service reads the store's window and emits it as a
`candles` frame under `loading` — the same frame, the same validator, no new
field on the wire — unless the exchange's window has landed meanwhile
(`session.candles` non-empty, or the interval epoch moved). Main's own
`session.candles` stays as it was: the provisional rows are the renderer's
picture, not the state the stream applies to, so the kline events queued
through `intervalBootstrapping` are folded onto the exchange's rows as
before.

The renderer's `candlesSwitching` now ends on the first candles frame at
the selected interval that is not `loading`, rather than on any frame at it:
the veil and the ring stay over the store's bars until the exchange's `live`
window replaces them, and a switch that fails still ends the wait with its
`unavailable` frame and reason, as before. (Ended on `live` alone, the first
cut kept the veil over that reason for the whole retry ladder; audit,
2026-09-04.) The view already draws a `loading` resource at the selected
interval; nothing there changes.

Background contracts read nothing from the store: `emitResource` refuses a
session that is not shown, and the read is skipped before it is made.

### D5. `hunter` must not read the exchange on the desk's behalf

`topup=false` on the candles endpoint skips `topup_usdm_bars`. Five lines
and a test in `hunter`; FastAPI ignores the unknown parameter until
`ui.service` is restarted, and until then a page beyond the store's oldest
minute makes `hunter` read Binance from the same IP — so the desk side ships
only with the flag, and the restart is the operator's step in `tasks.md`.

### D6. What the record says

`candle-store-window` and `candle-store-page` timing lines, each with the
contract's `symbol`: `outcome: ok` with `cache: hit` when served, `cache:
miss` with `code: NOT_COVERED` when the store had less than the whole,
`outcome: error` with the transport's code (`STORE_UNREACHABLE`,
`REQUEST_DEADLINE_EXCEEDED`, `HTTP_REJECTED`, `INVALID_STORE_ANSWER`, …),
`outcome: aborted` when the session that asked moved on first, `outcome:
skipped` while a 30 s cooldown after an error holds, and one `fault` line
per session when the store is off or its URL refused. The summary's «Candle
reads» block counts windows and pages by source, states the exchange weight
the store's pages did not spend (five per page), and counts the abandoned
reads apart from the store's failures.

## Residuals

- The store is 35 days deep today and deepens by a day a day; pages behind
  that come from the exchange as before.
- The renderer's cache hits leave no line in the record (renderer-side, as
  before), so «pages from the app cache» is not in the summary.
- The `loading` window's pick carries the age of the previous series'
  last live reading (`liveObservedAt` is carried across); a pick during the
  second the exchange's window takes is stated as loading, as today.
- Intervals the store does not know (none today: the desk's seven are all in
  `hunter`'s eight) fall through silently.
