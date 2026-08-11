## Why

Selecting a contract costs 24 weight, and 20 of it is one line:

```js
{ symbol, limit: String(FUTURES_PRODUCTION_WORKSTATION_REQUEST_LIMITS.DEPTH) }  // 1000
```

Binance prices `/fapi/v1/depth` by page: **limit 5, 10, 20 and 50 all cost 2**,
100 costs 5, 500 costs 10, 1000 costs 20. The desk buys the thousand every time.

What it draws is fourteen rows a side (`VISIBLE_DEPTH_LEVELS_PER_SIDE`, up to 200
when the panel is tall), grouped into a price step the operator picks from
`GROUPING_MULTIPLIERS` — 1, 2, 5, 10, 25, 50, 100 or 500 ticks. At the default
step, fourteen rows span fourteen ticks. A fifty-level snapshot covers that many
times over, for a tenth of the price.

The thousand is not wasted in principle — it is what a 500-tick step needs. It is
wasted in practice, on every switch, because the desk buys the depth the coarsest
possible step would need before knowing whether the operator wants it.

## What Changes

- **The snapshot is bought at the smallest page that covers what is read.** The
  default is 50 levels a side — weight 2, the free maximum, since 5, 10, 20 and
  50 all cost the same. Deeper pages are bought only when the display needs
  them.
- **The book states how deep it is proven.** A snapshot proves a price band:
  every level inside it is either from the snapshot or from a diff that has
  landed since, so it is exact. Outside it the book knows only the levels a diff
  happened to touch. The delivered book is truncated to the proven band, so a
  coarse step can never aggregate a half-known region into a row that
  understates the market.
- **A step that needs more range buys more range.** When the rows on screen —
  count times step — need a wider band than the current snapshot proved, the
  desk takes the next page size (100, then 500, then 1000) and re-bridges it,
  exactly as a book recovery does today. Selecting a coarser step is an operator
  action, so paying weight at that moment is paying for something asked for.
- **The depth a contract is read at is remembered with the rest of how its book
  is read**, so returning to a contract the operator reads at a 100-tick step
  opens at the page that step needs rather than climbing to it.

## Trade-offs this accepts

- **The market can walk out of the proven band.** A fifty-level band on a fast
  contract is left behind sooner than a thousand-level one, and re-establishing
  it costs another snapshot and another bridge — the same brief re-buffer a
  recovery causes today. At weight 2, ten of those in a minute still cost less
  than one of today's snapshots. The band is required to cover the visible rows
  with margin precisely so this stays rare.
- **A grouping change can now cost a request.** It is bounded (one snapshot, at
  most weight 20 — what every switch costs today) and it is caused by an
  operator action.
- **The book is truncated to what it can prove.** On a thin contract a fifty-level
  page may not reach far enough for the step in use, and the panel will show
  fewer rows until the deeper page lands. Showing fewer rows that are right is
  the whole point; the alternative is rows that quietly understate the book.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the depth snapshot is bought at the page
  the reading needs, and the book states the band it can prove.

## Impact

- `electron/services/futures-production-workstation-transport.js` — the depth
  read takes its page size, and the weight registry names one entry per page.
- `electron/services/futures-workstation-order-book.js` — the book records the
  band its snapshot proved and delivers within it.
- `electron/services/futures-production-workstation-service.js` — the bootstrap
  and the recovery ask for the page the current reading needs; a reading that
  needs more takes a deeper snapshot without tearing the session down.
- `src/utils/futuresProductionWorkstationProtocol.js`,
  `src/hooks/useFuturesProductionWorkstation.js`,
  `src/components/features/futures/FuturesWorkstationView.jsx` — the desk states
  the range its rows need; the existing per-contract memory of how a book is
  read carries the page with it.
- Composes with `keep-the-contracts-warm`: a held contract's book costs nothing
  to return to, and a shallow book is cheap enough to hold several of.
