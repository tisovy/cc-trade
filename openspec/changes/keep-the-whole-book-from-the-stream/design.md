# Design — keep the whole book from the stream

## Code map

- Protocol: `futures-workstation-order-book.js` `applyDiff` (`:690–733`):
  buffering phase, duplicate drop, bridge rule (`awaitingBridge && U <=
  lastUpdateId`), `pu` chain (`:726`) → `gap`; `bootstrap` (`:735–826`):
  retains buffered diffs with `u >= snapshot.lastUpdateId`, refuses a
  buffer that begins beyond the snapshot, retires levels the snapshot's
  own bests cross; `applyDelta` (`:827`): apply both sides, `trimSide`,
  crossed check on the bests.
- Band: `bandOfSnapshot` (`:327`), `holdsMarket` (`:639`),
  `rangeShortfall` (`:584`), `FUTURES_WORKSTATION_BAND_ROOM_SHARE` (`:360`),
  `groupSide(…, band)` marks `whole` per row (`:490`).
- Retention: `RETAINED_LEVELS_PER_SIDE` 10 000, `EVICTION_SLACK` 500
  (`:70–86`), `trimSide` (`:283`), `parsedBound` (`:223`).
- Service: `ensureDepthCovers` (`futures-production-workstation-service.js:665`)
  → `deepenDepthPage` (`:430`) → `recoverBook(session, 'DEPTH_RANGE_SHORT' |
  'DEPTH_BAND_WALKED', {immediate})` (`:730`); callers at `:609`, `:1061`,
  `:1430`, `:1664`; `recoverBook` (`:1705`) with the widening cooldown;
  `depthRange` from the panel's reading (`:199`); `DEPTH_RESYNC_CODES`
  (`:135`).
- Transport: `FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES` ladder (`:44`),
  `DEPTH_1000` weight 20; `createSocket` close → `onDisconnect('SOCKET_CLOSED')`
  (`:515`); frame `upstreamMs` is computed per delivery
  (`binance-connection.js:8565`).
- Record: `status` line fields (`desk-diagnostic-record.js:230`), `fault`
  (`:208`).

## Decisions

### D1. Bootstrap at the deepest page, once

`FUTURES_PRODUCTION_WORKSTATION_DEPTH_PAGES` keeps its ladder for the read
budget's arithmetic, but a session opens at `{limit: 1000, weight: 20}` and
never climbs. 20 once per session (and per proven gap) against a public
ceiling of 600 is fifteen contracts a minute at worst. The `depthRange`
the panel states stays — it bounds delivery (`toRendererRows`) — and stops
being an input to any read.

### D2. `ensureDepthCovers` and `deepenDepthPage` are removed

Not gated, removed: their every outcome is a read the protocol does not
call for. `recoverBook` keeps `DEPTH_SEQUENCE_GAP`, `CROSSED_ORDER_BOOK`,
`MALFORMED_DEPTH_FRAME`, bootstrap codes and the reconnect path; the
`DEPTH_RANGE_SHORT` / `DEPTH_BAND_WALKED` codes leave the vocabulary (the
record's closed set is amended, and the summary tool stops expecting them).

### D3. Keep every level; bound the work by the rows

`trimSide` and the two constants go. `FuturesWorkstationBookSide` keeps its
`Map`; `bestPrice` becomes O(1) amortised by caching each side's best and
recomputing only when the best is deleted (scan) or a nearer price is
inserted (compare). Delivery already selects the nearest `rows` without
ordering the tail (`Bounded order-book delivery…`); the parsed-decimal
cache bound follows the book (unbounded, entries evicted with their level).
Measured basis to re-take in the change: a 20 000-level side at ten diffs a
second must stay under the 2026-08-14 figure for 10 000 (1.3 ms a diff).

### D4. The band is a marker

`bandOfSnapshot` is kept as `page` — the price span the bootstrap page
proved — used by `groupSide` for `whole` and by nothing else. `holdsMarket`
and `rangeShortfall` are removed with their callers. `stale` for a book
means only: gap being recovered, or bootstrap not yet bridged.

### D5. Reach from the whole book

`reach` is measured from the retained levels with the same dropped-share
rule, stated on every delivery (there is no deeper page to defer to).

### D6. Crossing evidence

A crossed book raises as today, and the `fault` line for `CROSSED_ORDER_BOOK`
carries `lastUpdateId` (string), the diff's `U`/`u`/`pu` (strings), and
`crossedLevels` — the count of retained levels at or beyond the opposite
best. Counts and identities, no price. Open question the evidence answers:
whether the four stream crossings of 2026-09-02 were the exchange's or a
level the book should have dropped.

### D7. Close cause and lag

`createSocket`'s close handler names `closeCode` (the WebSocket close code,
bounded to the standard range, or `NO_CODE`) and `closedBy`
(`exchange` / `desk` / `transport`), and the session records
`lastUpstreamMs` — the upstream lag of the last frame delivered before the
close. Both reach the `status` line under `SOCKET_CLOSED` and the
`fault` line for the reconnect.

## Residuals

- The held pool (8 contracts) still bootstraps each held book once; with D2
  their background cost is one page per gap, which the record will show by
  symbol.
- Whether the exchange's `@depth@100ms` restates every far level is what
  «keep everything» relies on; measured 2026-08-14 (6 197 levels a side by
  ten minutes on AKEUSDT). If a listing ever proves otherwise, the marker
  of D4 is what says so on screen.
