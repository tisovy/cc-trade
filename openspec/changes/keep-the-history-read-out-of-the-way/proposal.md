## Why

Found while auditing `read-the-whole-session`, and left standing by it: widening
the history fan-out made a review cost the desk time it does not own.

Every futures REST read goes through one admission queue — `RateLimiter(800,
60_000, 150)` — which serializes admission and spaces each request 150ms from the
last. A history load now admits one to four income pages plus two reads for each
of twelve contracts: twenty-five to twenty-eight requests, three and a half to
four seconds of that queue. It was seventeen requests and about two and a half
seconds before this change, so the review got roughly sixty per cent more
expensive in time while getting cheaper in nothing.

The account refresh that follows a placement, a cancellation or a leverage change
uses the same queue (`runFuturesAccountRefreshPass`, same limiter instance). An
operator who opens the review and then works an order can therefore wait several
seconds before the desk re-reads what that order did — and the desk's own
heartbeat re-read is behind it too. Nothing is lost and nothing is wrong on
screen; it is stale for longer than the desk intends, at the one moment the
operator is acting.

Two things make it worse than it needs to be. The fan-out reads both the order
log and the fills for every contract, on every load, though the panel shows one
tab at a time — half of those twenty-four requests answer a tab nobody is looking
at. And a history read is never urgent, while the read that follows a mutation
always is; they are admitted in the order they arrive.

## What Changes

- The fan-out reads the endpoint the open view needs. Opening the other tab reads
  the other endpoint, once, rather than every load paying for both.
- A read that follows a mutating command is admitted ahead of a history fan-out
  already queued, so a review in flight cannot delay the desk learning what its
  own order did.

## Impact

- Affected specs: `futures-order-visibility`
- Affected code: `electron/services/binance-connection.js` (the fan-out and the
  limiter's admission), `src/hooks/useFuturesTrading.js` and
  `src/components/features/futures/FuturesPortfolioDock.jsx` (the request carries
  which view asked)
- Not a correctness fault: every reading is right, and this changes when they
  arrive rather than what they say.
