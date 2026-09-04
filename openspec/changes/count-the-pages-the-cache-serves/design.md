# Design

## D1 — The report rides the path the screen already uses

`FuturesProductionWorkstation.jsx` reports `symbol-shown` and `interval-shown`
as `sendMessage({ action: 'report_display_event', … })`, and
`binance-connection.js` turns that into a `display` line. The hook receives
the same `sendMessage`; after `await candleHistoryCache.readPage(...)` it
sends `{ action: 'report_candle_cache_read', symbol, durationMs, cache: 'hit' | 'miss' }`
inside a `try {} catch {}`, before deciding what to do with the page. The
report is sent whether the read is then applied or abandoned (a selection
that changed under the read): the read happened, and the line says so.

## D2 — The main side records it as a timing, in the record's own alphabets

`binance-connection.js`: `diagnosticRecord.record('timing', { phase: 'candle-cache-page', durationMs, outcome: 'ok', cache, code: null, symbol })`.
`RECORDED_FIELDS.timing` already validates each field — `phase` and `cache`
against their alphabets, `durationMs` as a count, `symbol` against the
exchange's identity alphabet — and refuses the line whole otherwise. The
renderer's strings are never trusted beyond that. `cache` is `hit` or `miss`,
the words the store's lines already use.

## D3 — A miss is a line too, but not a count

A miss precedes the store's or the exchange's line for the same page, so the
summary counts only cache `hit`s into `pages.cache`; a miss is readable on the
line and never summed, or a page would be counted twice.

## D4 — The block

    Candle reads
      windows: store S, exchange E
      pages: cache C, store P (weight not spent 5×(C+P)), exchange X
      store misses …, errors …, skipped …, aborted …

`5` stays the exchange's weight for a 1 000-row klines read. The cache's
misses are not printed; `store misses` keeps its meaning.

## D5 — Duration

`performance.now()` around the IndexedDB read in the renderer, rounded to a
whole millisecond. IndexedDB reads are single-digit milliseconds; the number
is there so a slow profile can be seen, not to be tuned.

## D6 — The optional interval (owner's call)

`interval: optional(text(INTERVAL))` on `RECORDED_FIELDS.timing`; the store
client, the transport's `contract-klines` and `candle-history` timings, and
the cache report carry it; the summary could then state misses by interval.
It touches every candle timing emitter and is kept as a separate task the
owner can strike.

## Residuals

- A cache write that fails stays silent: it means a fetch next time, and the
  fetch is recorded.
- The cache line carries the contract, not the page's span; the store's line
  for the same page, when there is one, carries neither, and the span is
  readable from `hunter`'s access log only.
