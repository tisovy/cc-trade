## Why

The operator measured a move of `+10.62%` on the chart and then looked at an
order book that showed nothing past 1–2% of price. The book was not thin — the
market was there. The desk was refusing to look at it.

The depth pipeline reads a thousand levels per side from `/fapi/v1/depth`
(weight 20), keeps five hundred of them, and hands **twenty-four** to the
renderer. Grouping happens in the renderer, *after* delivery, so a display step
of N ticks needs `rows × N` raw levels to fill fourteen rows. At the operator's
`0.0001` step on a `0.00001`-tick contract that is 140 levels against 24
delivered; at `0.001` it is 1400 against 24. One cap explains both screenshots,
and it explains them as "the feed ran out", not "the market is empty" — which
is the only kind of lie a depth display can tell.

Three separate bounds sat on top of that cap and would each have killed the
feed silently rather than degrading it, had the level count been raised alone:

- The delivered level count was written twice — once in the order book, once in
  the payload validator — with no link between them. A book larger than the
  validator accepts is dropped whole.
- `FUTURES_WORKSTATION_EVENT_MAX_BYTES` was sized around the old frame. Above
  it the service throws `OUTBOUND_FRAME_TOO_LARGE` and depth stops.
- The renderer's bounded JSON parser had a default budget of 8,192 nodes. A
  full book is 8,020. The margin was 172 nodes — one field away from
  `JSON_RESOURCE_LIMIT` on every frame.

The same read also found the pressure split (`B 53.37% / 46.63% S`) stated
without the range it covers. It is measured over exactly the rows on screen, so
the identical number means opposite things at a 0.3% book and a 10% book.

## What Changes

- The delivered book is the whole retained book: **1,000 levels per side**,
  which is what the exchange serves and what the desk already pays weight 20
  for. Nothing is discarded between the read and the screen.
- 1,000 is the ceiling on purpose. Past it Binance publishes no snapshot to
  bridge against, so a deeper book could only be stitched from diff traffic and
  would under-report resting liquidity — the same lie, further from the mid.
- The delivered level count becomes one shared constant, and the parser's node
  budget is derived from it, so the payload rules and the parser bounds cannot
  drift into a configuration that is legal to build and impossible to read.
- The order book's pressure legend states the price range the rows on screen
  actually cover (`±X%`), beside the split measured over them.
- Working orders are sized in USDT, like every other order surface on the desk.
- Three hot paths are made to pay for the extra depth rather than the operator:
  - the local book sorts on a price parsed once per level instead of re-parsing
    both sides of every comparison, and reads best bid/ask by scan instead of by
    two full sorts per diff;
  - the renderer's bounded parser counts a string's bytes instead of encoding it
    into a throwaway buffer behind a throwaway `TextEncoder`, and takes an
    unescaped span verbatim instead of re-parsing it;
  - grouping stops when the next display row opens instead of walking the whole
    delivered book to fill fourteen rows.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: the delivered book is bounded by the
  exchange rather than by the transport; the pressure split carries the range it
  is measured over.
- `futures-order-visibility`: a working order's size is stated in USDT.

## Impact

- Renderer: `src/utils/futuresWorkstationProtocolShared.js`,
  `src/utils/futuresProductionWorkstationProtocol.js`,
  `src/utils/futuresOrderBook.js`,
  `src/components/features/futures/FuturesWorkstationView.jsx`,
  `src/components/features/futures/FuturesPortfolioDock.jsx`,
  `src/components/features/futures/FuturesWorkstation.css`.
- Main process: `electron/services/futures-workstation-order-book.js`.
- No new exchange traffic and no additional REST weight: the snapshot was
  already read at `limit=1000`. The change is what happens to it afterwards.
- Measured cost per depth update at 1,000 levels per side, against the same
  code before the three optimizations: main process 2.5–2.8 ms (was 3.2 ms at
  the same depth), renderer 3.6 ms (was 11.5 ms). At the stream's 10 updates a
  second that is roughly 6% of one core across both processes.
- Frame size: 142 KB on a real book, 216 KB for the widest book the protocol
  calls legal, against a 256 KiB ceiling.
