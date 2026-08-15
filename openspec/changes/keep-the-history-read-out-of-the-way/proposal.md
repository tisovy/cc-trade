## Why

Found while auditing `read-the-whole-session`, and left standing by it: widening
the history fan-out made a review cost the desk time it does not own.

Every futures REST read goes through one admission queue — `RateLimiter(800,
60_000, 150)` — which serializes admission and spaces each request 150ms from the
last. The first review of a session admits two income pages plus two reads for
each of twelve contracts: twenty-six requests and 3 750ms of that queue, measured
on 2026-08-16. The `Full` button is thirty-two requests and 4 650ms.

What follows the operator's order is in the same queue. With the private stream
up, a placement is not read back at all — the frame states it — but the wallet
the fill moved is read, and behind a fan-out that read waited 3 150ms. A leverage
change is worse: `setLeverage` is itself admitted through this queue, so the
change reached the exchange 3 150ms after the operator asked for it, and the
account read behind it 3 600ms after. Nothing is lost and nothing is wrong on
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
- What the operator's command needs of the queue — the command itself where it is
  admitted through it, and the read that follows it — is admitted ahead of a
  history fan-out already queued, so a review in flight cannot delay the desk
  learning what its own order did, nor delay the order.
- A stream of urgent admissions may not stall a fan-out already under way: what
  overtakes is bounded, so the review still finishes.

## Impact

- Affected specs: `futures-order-visibility`
- Affected code: `electron/services/binance-connection.js` (the fan-out and the
  limiter's admission), `src/hooks/useFuturesTrading.js` and
  `src/components/features/futures/FuturesPortfolioDock.jsx` (the request carries
  which view asked)
- Not a correctness fault: every reading is right, and this changes when they
  arrive rather than what they say.
