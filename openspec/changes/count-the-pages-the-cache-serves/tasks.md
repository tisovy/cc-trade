# Tasks

## 1. The renderer

- [ ] 1.1 `useFuturesProductionWorkstation`: after `candleHistoryCache.readPage`, send `report_candle_cache_read` with the contract, the rounded duration and `hit`/`miss` through `sendMessage`, in a try/catch, before the page is applied or the request is sent (D1, D5).
- [ ] 1.2 Hook tests: a cache hit sends one report with `cache: 'hit'` and no history request; a miss sends the report with `miss` and then the request; `sendMessage` throwing on the report does not change what the read does. Bite: all three fail on the tree before 1.1.

## 2. The main process

- [ ] 2.1 `binance-connection.js`: `report_candle_cache_read` → `diagnosticRecord.record('timing', { phase: 'candle-cache-page', durationMs, outcome: 'ok', cache, code: null, symbol })` (D2).
- [ ] 2.2 Tests asserted on `describeDeskDiagnosticEvent` rather than a mocked `record()` (a mocked record does not see what `RECORDED_FIELDS` drops): a well-formed report becomes a `timing` line with those six fields; a report with a symbol outside the exchange's alphabet, a `cache` outside `hit`/`miss`, or a non-count duration is dropped whole.

## 3. The summary

- [ ] 3.1 `read-desk-record.mjs`: `candle-cache-page` with `cache: 'hit'` counts into `pages.cache`; the block prints cache, store and exchange pages and `weight not spent 5×(cache+store)` (D3, D4).
- [ ] 3.2 Test on a fixture record with cache hits, cache misses, store hits and exchange pages: the block's three lines exactly; a miss is not counted anywhere.

## 4. Optional — the owner strikes or keeps

- [ ] 4.1 `interval` on candle timing lines: `RECORDED_FIELDS.timing` gains `interval` optional; the store client, the transport's `contract-klines` and `candle-history` timings and the cache report carry it; the summary states `store misses` by interval (D6).

## 5. Verification

- [ ] 5.1 `npm run -s check:circular check:runtime-mock check:futures-production check:command-path`, `npx vite build`, `npx vitest run`, `npx eslint`.
- [ ] 5.2 Live: the renderer part under HMR, the main part after the desk is stopped. Open a contract and interval visited on an earlier day and scroll left: the record shows `candle-cache-page … hit` lines with no `candle-store-page` or `candle-history` line for those pages; the next day's «Candle reads» states cache, store and exchange pages and the weight not spent for cache and store together.
