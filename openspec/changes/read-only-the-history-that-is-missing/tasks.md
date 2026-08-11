## 0. Counted Before Changing

- [x] 0.1 One refresh is up to 360 weight: income discovery up to 8 pages × 30 = 240, plus 12 contracts × 2 reads × 5 = 120. The account bucket is 800 a minute.
- [x] 0.2 It is also ~4.8 seconds before any network time: 32 admissions at the limiter's 150ms spacing.
- [x] 0.3 Nothing survives a restart: the review is rebuilt from zero every run, while closed candles beside it are served from a local store for exactly the reason that applies here — a settled order never changes.

## 1. The Store

- [x] 1.1 A local store per contract, modelled on `futuresCandleHistoryCache.js`: terminal orders and trades, bounded, with the identity and time each contract is covered up to. `src/utils/futuresHistoryStore.js`: IndexedDB `FuturesAccountHistory`, one record per contract holding the rows, `orderCursor`, `tradeCursor` and `readAt`. Bounds: 200 orders and 1 000 trades a contract — the read's own depth — and 24 contracts, twice the fan-out, dropped by oldest reading first. Cursors are derived from the rows rather than tracked beside them, so they cannot drift from what is actually held, and they are compared as integers, which is what an `orderId` past 2⁵³ needs.
- [x] 1.2 Only terminal rows are stored — a working order is not history. A `NEW` or `PARTIALLY_FILLED` order is dropped on the way in: stored, it would present itself as settled in the next run, when the exchange may have filled or cancelled it while the desk was closed.
- [x] 1.3 An unreadable or unavailable store degrades to reading, never fails the review. Both store methods answer "nothing stored" / `false` rather than raising, whatever the layer beneath them does — no caller can be broken by it.
- [x] 1.4 The store is presented on launch before any read is issued, stamped with when each contract was read. `restoreFuturesHistoryFromStore` builds the held review from the records; the hook seeds it on mount and steps aside if an exchange answer arrived first. The whole review is stamped with its *stalest* contract's reading — a review is only as fresh as the oldest thing in it — and per-contract stamps live in the new `coverage` field on the held review, which §2.2 is what carries into the command. `discoveryComplete` is `false` for a restored review: the store names what it holds, which is no claim about what the account traded.
- [x] 1.5 Restore an empty-but-covered contract as a valid reading: `restoreFuturesHistoryFromStore` now retains its symbol, coverage and age even when both row lists are empty; store tests cover the empty reading.

## 2. The Read Asks For The Gap

- [x] 2.1 `getOrderHistory` and `getTradeHistory` read forward from an identity — `orderId` and `fromId`, which is how the exchange pages them. `fromOrderId` / `fromTradeId` on the adapter, carried as digits because an `orderId` outgrows a double and one rounded into the query asks for a row that does not exist; an identity that is not digits reads the newest page, as before. Both endpoints answer from the identity *forward*, oldest first, so an answer that fills the limit means the gap was deeper than a page and the caller asks again from the last identity it received. Nothing calls it with an identity yet — that is 2.2.
- [x] 2.2 The held review states per-contract `readAt`/order/trade cursors and `createFuturesAccountHistoryCommand` carries that coverage with the incremental/full choice.
- [x] 2.3 Electron records stream activity revisions and skips a covered contract only when its successful REST proof still matches the uninterrupted authenticated stream epoch.
- [x] 2.4 Loading, failure, close, replacement and deactivation invalidate stream trust; the next refresh consequently reads every covered contract.
- [x] 2.5 A round-robin slot advances across one otherwise skipped contract per refresh and scans past already-required contracts, proving a stable twelve-contract set within twelve refreshes.
- [x] 2.6 Typed-command validation bounds coverage to 24 uppercase contracts, keeps only safe timestamps and digit-string cursors, and successful payloads return per-endpoint `readFrom` origins for correct gap/full merging.

## 3. Discovery Is Asked For A Reason

- [x] 3.1 The contracts an income walk found are held for ten minutes; a refresh inside that reuses them and issues no income read. The walk answers which contracts were traded *somewhere other than this desk* — a trade made here already seeds the fan-out from the account's own positions and orders.
- [x] 3.2 What is held is what the walk found, not what the fan-out chose: the seeds are re-read from the account each time, so a contract cannot outlive the position that put it on the list.
- [x] 3.3 The held answer carries the walk's own `discoveryComplete`, so a held refresh cannot read as a wider review than the walk was.
- [x] 3.4 Deactivating the market drops it, like every other held reading.
- [x] 3.5 Test: two refreshes in a row walk income once and cover the same contracts; past the hold it is walked again.
- [x] 3.6 Fresh store coverage is used as persisted discovery without an income request; workstation opening waits for hydration and presents a restored review without an automatic read.
- [x] 3.7 The ordinary ↻ sends coverage for an incremental read; a separate visible `Full` control sends `full: true` and bypasses persisted and in-memory discovery.

## 4. Proof

- [x] 4.1 Test: a launch with a populated store presents the review with no request issued. `useFuturesTrading.test.js` — "presents the review the store holds without issuing a read": rows, stamp and coverage on screen, and the only frame sent is the account refresh the subscription always sends. Two tests beside it: a reading that succeeded is stored and a reading that failed is not, and a store that answers after the exchange did does not overwrite the newer reading.
- [x] 4.2 Test: `reads a stream-dirty cursor gap...` proves inclusive multi-page forward reads start at the supplied order/trade identities, stop on a short page, and deduplicate the boundary row.
- [x] 4.3 Test: the same three-contract scenario proves the dirty contract plus one rotation read while the other unchanged contract issues no endpoint read.
- [x] 4.4 Test: `invalidates every history proof...` disconnects the authenticated socket and proves the next refresh reads all covered contracts.
- [x] 4.5 Test: `rotates one idle contract...` proves exactly one endpoint pair per refresh and all twelve contracts within twelve refreshes.
- [x] 4.6 Test: a refresh inside the hold issues no income page (see 3.5).
- [x] 4.7 Test: `bypasses persisted and in-memory discovery...` first primes both caches, then proves Full walks recent and older discovery and reads every named contract with null origins.
- [x] 4.8 Test: an unreadable store behaves exactly as no store. `futuresHistoryStore.test.js` — a store whose reads answer nothing and whose writes throw leaves the review unread and reports a write that did not happen, and a store that raises on open does the same rather than propagating.
- [x] 4.9 Weight test states and proves idle = 2 endpoint admissions × 5 = 10, full = 8 income × 30 + 24 endpoint admissions × 5 = 360, so idle is 1/36 (about 2.8%).
- [x] 4.10 Tests cover empty-contract restoration, bounded command normalization, incremental per-endpoint row merging, store hydration gating and the explicit Full control.
- [x] 4.11 Discovered during the targeted run: when the standard IndexedDB store is provably unavailable, initialize hydration as ready instead of scheduling a redundant state update; this removed the new React `act(...)` warnings without changing the real IndexedDB path.
- [x] 4.12 Discovered during manual audit: union fresh coverage into a held in-memory discovery answer, so a contract learned after the cache was created remains in rotation and is included in the next post-disconnect all-contract read; a three-read reconnect regression test covers it.
- [x] 4.13 Discovered during persistence audit: pass `readFrom` to the store, merge cursor-origin endpoints and replace null-origin endpoints, preventing a full read's removed rows from reappearing after restart; the mixed order-gap/trade-full and empty-full store test covers it.
- [x] 4.14 Discovered against the design's memory bound: cap Electron's multi-page gap accumulator to the endpoint depth and cap held REST/stream rows per contract to the store's shared 200-order/1,000-trade limits; backend and held-review tests cover page-boundary deduplication and eviction.
- [x] 4.15 Discovered during multi-renderer audit: bind stream proofs to the resulting order/trade cursors and require the requesting coverage to match, so a stale second renderer reads its own gap; a rotation-positioned two-contract test proves it.
- [x] 4.16 Discovered in the real adapter path: normalize safe numeric and string history IDs to digit strings before pagination and discard already-rounded unsafe numbers; adapter tests cover safe, 64-bit string and unsafe-number cases.
- [x] 4.17 Discovered during teardown audit: closing the last renderer now calls `forgetFuturesHistoryState` before its detached authenticated socket's guarded close can be ignored; a reconnect test proves discovery is walked again and no closed-stream answer survives.
- [x] 4.18 Discovered during activation-race audit: history discovery and response emission are bound to both the shared Futures activation and the requesting renderer activation; an obsolete income walk stops before another page or endpoint request, cannot repopulate discovery, and a switch-away/back regression test proves only the new activation's contracts answer.
- [x] 4.19 Discovered during persistence failure audit: default IndexedDB `put`/`delete` transactions now carry an explicit success result and `writeReading` returns `false` on an abort/null result; injected put- and eviction-delete failures cover both paths.
- [x] 4.20 Discovered during exchange-contract audit: paginate `/fapi/v1/income` by Binance's `page` parameter instead of advancing `startTime`, so a page boundary containing identical millisecond timestamps cannot skip contracts while claiming discovery is complete; spec/design, adapter tests and backend regression tests cover the numbered request and identical-timestamp boundary.
- [x] 4.21 Discovered during final teardown-race audit: closing the last renderer advances the shared Futures activation generation before forgetting state, so an income request already in flight cannot repopulate stale discovery after disconnect; spec/design and a delayed-response reconnect regression test prove the old contract reaches neither the detached renderer nor the new activation.
- [x] 4.22 Live operator feedback: hide `CANCELED`/`CANCELLED` rows from the order-history presentation without removing them from held/persisted data or changing coverage cursors; panel regression covers both spellings, the visible filled row, and the unchanged held input.
- [x] 4.23 Live operator request: deterministic App-level stress coverage drives three consecutive 100 ms cycles of at least 2 MiB each through the real Gateway, Futures hook, protocol parser and order-book view; every boundary renders the newest book, remains live, and answers both book and workspace controls without relaxing the 256 KiB per-event limit.

## 5. Verification

- [x] 5.1 Final verification passed after the complete audit, its fixes, live-feedback filtering, and App stress coverage: targeted history/protocol/UI/backend tests (11 files / 285 tests), `npm run lint`, full `npm test` (101 files / 1,484 tests), `npm run build`, `npm run check:futures-production`, and `npm run check:command-path`; additional circular-import and runtime-mock guards also passed.
- [x] 5.2 Operator confirmed on live data: the review is on screen immediately at launch, ↻ answers in about 2 seconds, closed positions appear in about 6 seconds, and a trade made in Binance's app appeared after a full re-read of about 8 seconds.
- [x] 5.3 Record the repository-wide mandatory implementation order in `AGENTS.md`: production code first, tests for that behaviour only afterward.
- [x] 5.4 Discovered by the production boundary check: remove a storage implementation name from the isolated workstation's source comment; the component still receives only hydrated state, and the rerun passed.
- [x] 5.5 Discovered during final staging: concurrent desk-diagnostic edits shared the backend and its test file. Keep every diagnostic hunk in the working copy but outside this change's index, then verify the exact staged snapshot and audit all 90 GitNexus changed symbols, 106 direct edges and 86 affected flows.
- [x] 5.6 Final staged GitNexus audit: conservative enclosing-symbol mapping reports CRITICAL (118 symbols / 40 flows) because `setupBinanceConnection` spans most of the backend file and the adapter/store files are mapped as whole containers. The exact hunks modify only `setupBinanceConnection`, `getTradedSymbolPage`, and `createFuturesHistoryStore.writeReading`; each has LOW upstream impact. Every d=1 caller/importer (`electron/main.js`, the backend/adapter/store tests, and `useFuturesTrading`) was inspected and exercised by the targeted/full/build/boundary checks.
- [x] 5.7 Live-feedback staged GitNexus audit reports LOW (8 files / 50 indexed symbols / 0 affected processes / no d=1 dependencies). The graph omits the JSX import edge, so the real `FuturesHistoryPanel` consumers (`FuturesPortfolioDock` and its panel test) were checked manually and exercised by targeted/full tests; the new stress harness and test add no production caller.

## 6. Stated Limits, Not Fixed Here

- [x] 6.1 Confirmed unchanged in code and design: `new RateLimiter(800, 60000, 150)` still owns Futures REST admission; the optimization removes reads and does not alter spacing.
- [x] 6.2 Confirmed unchanged in code and tests: `FUTURES_HISTORY_MAX_SYMBOLS` remains 12, every discovery return still slices to it, and the rotation/weight tests exercise the full twelve-contract bound.
