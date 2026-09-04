# Count the pages the cache serves

## Why

The renderer keeps delivered history in IndexedDB (`FuturesCandleHistory`,
per contract and interval, up to 5 000 rows) and serves the next page from it
without any request when it holds the page whole. That read leaves nothing in
the record — no timing line, no frame. On 2026-09-04 two 1h pages of
USELESSUSDT (2026-07-21..08-31 and 06-09..07-21) reached the chart between
06:41Z and 06:49Z with neither a `candle-store-page` nor a `candle-history`
line; the journal read had to reconstruct them from the page the store was
asked for next, whose end (2026-06-09 15:00Z) is exactly 2 000 bars behind
the window. The day's «Candle reads» stated pages store 12, exchange 15,
weight not spent 60, and did not know about the pages that cost nothing at
all.

The record's own requirement is that a day can be asked what each source
saved. With the cache invisible, the store's share reads as the whole saving,
and a page the exchange served cannot be told from one the cache served.

## What Changes

- The renderer states every cache read of a page: `candle-cache-page`, the
  contract, how long it took, `hit` or `miss` — through the same
  fire-and-forget report the screen already sends (`report_display_event`),
  so a report can never block the desk.
- The main process records it as a timing line in the record's existing shape
  (phase, durationMs, outcome, cache, code, symbol). Nothing new in
  `RECORDED_FIELDS`; a malformed report is dropped as any half fact is.
- The summary's «Candle reads» counts pages by three sources — cache, store,
  exchange — and the weight not spent counts cache and store pages together.
- Optional, the owner's call (task 4): `interval` on candle timing lines. The
  same journal read had to join every candle line to the renderer's
  `interval-shown` events to know which interval a miss was on.

## Impact

Files: `src/hooks/useFuturesProductionWorkstation.js` (the report around
`candleHistoryCache.readPage`), `electron/services/binance-connection.js`
(one more `report_*` action beside `report_display_event`),
`scripts/read-desk-record.mjs` (the block), their tests, the record's spec.
Line rate: one line per page read — a scroll is one page. No price or row in
the line. The renderer part deploys under HMR; the main-process part waits
for the desk to be stopped (`electron/**` is not copied into a running desk,
2026-09-03).
