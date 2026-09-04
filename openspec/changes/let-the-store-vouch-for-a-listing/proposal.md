# Let the store vouch for a listing

## Why

A history page is served from the local candle store whole or not at all
(`read-candles-from-the-nearest-source`, D5): a short answer never reaches the
renderer, because the renderer reads a short page as the contract's first
candle, and the store cannot tell the desk whether its first minute is the
contract's first minute or merely the first minute it collected.

For a contract listed after the store began collecting, that caution costs
every page. `hunter`'s collector refreshes the exchange's universe every five
minutes and catches a new contract up from its `onboardDate`, so the store
holds such a contract from its very first minute — on 2026-09-04 the first
stored minute equals the exchange's `onboardDate` to the minute for all four
contracts listed since the fill: GRVTUSDT (2026-07-31 12:45Z), DOSUSDT (08-11
15:00Z), 牛来USDT (08-30 11:30Z), MARSCOINUSDT (09-01 09:45Z). Yet a page that
reaches before the listing comes back shorter than `limit`, is refused as not
whole, and the exchange is asked for the same short page: on MARSCOINUSDT that
evening three of five pages went to the exchange for this reason alone (15m,
4h, 5m), each a weight-5 read of 360–620 ms where the store answers in 20 ms.
The renderer's own IndexedDB store refuses a short page for the same reason,
so the read repeats on every visit.

The desk already reads `onboardDate` in the exchange's catalogue and drops it.
With the listing minute beside the page, the store's short answer is
verifiable: its first minute is the listing minute, every missing minute lies
before it, and nothing is missing between the listing and the page's end. That
is exactly the page the exchange would send.

## What Changes

- The contract catalogue keeps `onboardDate` (`normalizeFuturesWorkstationExchangeInfo`),
  optional, as the exchange states it.
- A page read from the store carries the contract's listing minute. The store
  client serves a short page when, and only when, the store's first minute is
  that listing minute, the page began before it, every minute the store lacks
  lies before it, and the buckets from the listing to the page's end are all
  present. The first bucket may start before the listing minute — the
  exchange's own first kline does too, built from the same minutes.
- Everything else is unchanged: a page entirely after the listing is still
  served only whole; a contract the store holds from later than its listing
  (USELESSUSDT, 龙虾USDT — the fill boundary) still goes to the exchange; a
  vouched page reaches the renderer as any short page does and ends the
  contract's history there.
- The timing line for a vouched page is `candle-store-page ok hit`, as for a
  whole one.

## Impact

Files: `electron/services/futures-workstation-market-contract.js` (one kept
field), `electron/services/futures-workstation-candle-store.js` (`servePage`
with a listing minute), `electron/services/futures-production-workstation-service.js`
(`readStorePage` passes the session's contract's listing minute), their
tests. Renderer untouched. Deploy is a main-process change — `electron/**`
must not be copied into a running desk (2026-09-03); deploy with the desk
stopped.

Weight: one exchange page (weight 5) per interval per visit of each listing
younger than a page, saved. Risk: a wrong vouch would end a contract's history
early on the chart; the rule requires the store's first minute to equal the
exchange's listing minute, and a store that started collecting later than the
listing is refused as before.

Non-goals: the renderer's IndexedDB store keeps refusing short pages (the
store answers in 20 ms, and the renderer has no listing minute of its own);
a listing minute the store holds later than the exchange states stays the
exchange's page.
