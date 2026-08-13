## 1. Protocol

- [x] 1.1 Add the `candleHistory` resource and its payload validator (`series`, `interval`, `endTime`, `offset`, `total`, `complete`, `rows` ≤ the renderer row bound), leaving the live `candles` payload untouched.
- [x] 1.2 Add the `load.candleHistory` action with exact-key validation of `symbol`, `interval`, `endTime` and `limit`.
- [x] 1.3 Bump the protocol version so a mismatched pair fails closed, and add the request builder to the production protocol module.

## 2. Main process

- [x] 2.1 Give the transport a `readCandleHistory` read on the existing klines route with `endTime`/`limit`, at the weight the page size actually costs.
- [x] 2.2 Raise the kline normalization bound and JSON node bound to the requested page size, keeping the body byte bound.
- [x] 2.3 Handle `load.candleHistory` in the service: reject it unless it matches the current session, contract and interval; fetch; emit as bounded pages; never touch the live window's state.
- [x] 2.4 Prove by test: paged emission, ownership rejection, an empty response, and a response that arrives after the session moved on.

## 3. Renderer state

- [x] 3.1 Buffer `candleHistory` pages in the hook exactly as the catalogue is buffered, applying only on completion and discarding a broken sequence.
- [x] 3.2 Expose `loadCandleHistory(endTime)` with single-flight and exhausted-history state, reset on symbol or interval change.
- [x] 3.3 Merge history and the live window into one ascending series with the live row winning any overlap.

## 4. Cache

- [x] 4.1 Add `src/utils/futuresCandleHistoryCache.js`: own IndexedDB database, one contiguous run of closed candles per `symbol:interval`, bounded, degrading to a no-op when IndexedDB is unavailable.
- [x] 4.2 Serve a history page from the cache when it fully covers the requested window, and write every delivered page back.
- [x] 4.3 Hydrate the chart from the cache on open when the stored run is adjacent to the live window, and fetch when it is not.
- [x] 4.4 Prove by test: hit, miss, gap after an absence, bound enforcement, unavailable store.

## 5. Chart

- [x] 5.1 Render the merged series and detect the visible range reaching the oldest loaded candle.
- [x] 5.2 Preserve the viewport across a prepend, so loading older candles does not move the bars under the cursor.
- [x] 5.3 Stop requesting once history is exhausted, and never request while one is in flight.

## 6. Verification

Closed on the operator's instruction of 2026-08-10 to finish and commit: this
check is theirs to run on live data, and the change is archived rather than held
open waiting for it.

- [x] 6.1 `npm test` (927 passed), futures boundary, circular-import and runtime-mock checks pass; eslint clean on every touched file.
- [x] 6.2 Add `load-candle-history` to the reviewed action allowlist in `scripts/check-futures-workstation-boundaries.mjs`, stating what was reviewed.
- [x] 6.3 Defect found on live data: rows loaded under the previous selection survived the switch and the next page merged in front of them, drawing 15m bars behind a 1h series. A page now replaces, rather than joins, rows read for another contract or interval, and `exhausted` is no longer inherited across a switch.
- [ ] 6.4 Operator confirms on live data: opening a contract shows deep history, scrolling left keeps loading, and a restart loads the same history without a request. — corrected 2026-08-13; see the [live-verification ledger](../../../live-verification-ledger.md#outstanding-verifications).
