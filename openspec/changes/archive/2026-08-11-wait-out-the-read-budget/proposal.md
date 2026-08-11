## Why

The operator switched between contracts and the desk stopped: `RESYNCHRONIZING`
with `reason READ_WEIGHT_EXHAUSTED`, every header value a dash, the chart empty
and read-only. Nothing failed at the exchange. The desk refused its own read.

`FuturesWorkstationReadBudget` (`futures-workstation-read-budget.js:75`) is a
weight window that **rejects** when the window is full:

```js
if (used + entry.weight > this.maximumWeight) {
    entry.reject(new FuturesWorkstationReadBudgetError('READ_WEIGHT_EXHAUSTED'));
    continue;
}
```

That is a rate limiter answering "not yet" with "never". The account reader in
the same process already does the other thing — `RateLimiter.waitForCapacity`
(`binance-connection.js:336`) sleeps until the oldest weight ages out and then
proceeds. Two limiters, two philosophies, and the refusing one is in front of
the desk.

**What a minute of the desk actually costs, against a ceiling of 120:**

| Work | Weight |
|---|---|
| Contract switch: 1000-level book 20, contract klines 1, index klines 1, premium 1, ticker 1 | **24** |
| …whose depth bridge misses: up to three more snapshots | **up to 84** |
| One book recovery round: up to three snapshots, once per 5s | **up to 60** |
| Interval change | 2 |
| Scrolling the chart back one page | 5 |

Five contract switches fill the window. Two book recoveries fill it. The
operator does both routinely, and BEAT is exactly the kind of thin contract
whose book needs recovering.

The refusal then costs far more than the read would have. A refused bootstrap is
handled as a market-data fault: `scheduleResync` closes all three sockets,
spends one of eight reconnect attempts and re-opens them — so a local accounting
decision churns 24 upstream connections over 92 seconds, and if the window never
frees the desk ends `UNAVAILABLE` and stays there until the operator selects
something else. That is the amplification the phase-8 threat model named
(`docs/futures_phase8_workstation_threat_model.md:60`), reached from the other
direction.

## What Changes

- **A read with no room waits for it.** The budget computes the moment the
  window frees enough weight for the read at the head of its queue, sleeps until
  then and proceeds. `READ_WEIGHT_EXHAUSTED` is kept for the case it was named
  for: no room appears within a whole window.
- **A waiting read is still abandonable.** Selecting another contract aborts the
  reads of the one being left, whether they are in flight or waiting, so a
  waiting read never holds the window for a contract nobody is looking at.
- **The ceiling is stated against what the desk costs.** Binance answers USDⓈ-M
  public reads against 2400 weight per minute per IP; the account reader claims
  at most 800 of that. The workstation's 120 was a fifth of one contract switch;
  it becomes 600 — a quarter of the exchange's minute, leaving 1000 of it
  unspent even when the account reader is at its own ceiling.

## Trade-offs this accepts

- **A full window is now latency, not an error.** A switch made when the window
  is full takes as long as the window needs to free — up to a minute in the
  worst case, spent in `loading` with the previous contract's sockets already
  released. That is worse to look at than an instant answer and far better than
  a desk that resynchronizes for 92 seconds and then gives up. The bound is one
  window: beyond that the room is not coming from anything this desk did, and a
  refusal is the honest answer.
- **Head-of-line blocking.** The queue stays FIFO, so a 1-weight ticker read
  waits behind a 20-weight book snapshot that is waiting for room. Letting small
  reads overtake would starve the snapshot, which is the one read the book
  cannot be bridged without.
- **A higher ceiling is more traffic under a fault.** A loop that reads without
  end now reaches 600 rather than 120 before the window stops it. The
  concurrency cap of five, the queue cap of sixteen and the resync backoff all
  still apply, and 600 is a quarter of what the exchange permits.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: a public read the local budget has no room
  for waits for the window rather than failing the desk.

## Impact

- `electron/services/futures-workstation-read-budget.js` — the window delays
  rather than refuses; injectable timers so the delay is testable.
- `electron/services/futures-production-workstation-transport.js` — the ceiling
  becomes a stated constant sized against a contract switch.
- No renderer change: with the read served, the status the renderer is given is
  `live` rather than `resynchronizing`.
- Composes with `keep-the-contracts-warm` (a switch back to a held contract
  would cost no weight at all) and `hold-the-book-through-a-spike` (which makes
  a refused frame cost the book rather than a 60-weight recovery round). Both
  reduce the pressure this change absorbs; neither replaces it.
