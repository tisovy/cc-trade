## Why

On 2026-08-11 the operator reported the desk unusable on contract switch and on
launch: both sides of the book empty, the chart in `RESYNCHRONIZING`, cycling
every few seconds. The timing log shows the shape exactly, four times per cycle:

```
depth 344ms ok
depth-retry 343ms ok
depth-retry 346ms ok
depth-retry 346ms ok
aggregate-ready 4124ms error
```

Four snapshots read successfully, and the book refused all four.

**A market that has not moved cannot be bridged, and the desk read that as a
broken book.**

Binance's depth-sync algorithm bridges a snapshot to the diff stream by finding
the buffered diff that straddles it: `U <= lastUpdateId <= u`. The desk requires
one (`futures-workstation-order-book.js:343`). On a contract where nothing has
changed since the snapshot was taken, **no such diff exists and none ever will**
— `<symbol>@depth@100ms` publishes only when a level changes. The snapshot is
not stale in that case; it is exactly the current book.

Measured against the live exchange through the operator's own proxy, four
snapshots of `PYPLUSDT`, `TBTUSDT` and `GSUSDT` over 2.5 s each returned the
*identical* `lastUpdateId` with zero diffs delivered — the desk's four attempts,
reproduced, all failing. `BTCUSDT` bridged on the first attempt. The desk works
on liquid contracts and cannot open a quiet one at all.

**And a book that could not be built took the whole desk with it.**
`DEPTH_BOOTSTRAP_GAP` is thrown out of the bootstrap
(`futures-production-workstation-service.js:750`) into `scheduleResync`, which
closes every stream and starts a new generation: chart, tape, header and candles
all go, and every bootstrap read is paid again. The service already argues the
opposite for a *live* book — "the book is the one resource the desk can lose
without losing the desk" — but the bootstrap path never got that treatment. With
`RECONNECT_ATTEMPTS: 8`, a quiet contract ends at `UNAVAILABLE`.

**None of it was written down.** `onInternalError` carries the reason for every
one of these faults and the operator composition never passes it
(`binance-connection.js:1589` wires `onTiming` only), so it defaults to a no-op.
The operator could see that something failed and never what.

## What Changes

- **A quiet snapshot is the book.** When no buffered diff straddles the
  snapshot *and none proves a gap*, the desk goes live on the snapshot and
  bridges against the first diff that arrives: it must either continue from the
  snapshot's own update id or straddle it, and a diff that starts beyond it
  proves a real gap and re-reads as it does today. A snapshot that a buffered
  diff proves stale is still refused, exactly as now.
- **A book that cannot be built is a stale book, not a dead desk.** A bootstrap
  that cannot bridge leaves the session live — tape, header, candles and chart
  keep delivering — with the book marked stale and rebuilt in the background on
  its own cooldown, matching what a live book already does with a sequence gap.
- **Every recovered fault reaches the operator's log**, with its phase and its
  reason, and the two ways a bootstrap can fail to bridge stop sharing one code.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: a contract nobody is trading opens like
  any other, and a book that cannot be built costs the book only.

## Impact

- `electron/services/futures-workstation-order-book.js` — the bridge rule and
  the first diff after a quiet bootstrap.
- `electron/services/futures-production-workstation-service.js` — a failed book
  bootstrap no longer resynchronizes the session.
- `electron/services/binance-connection.js` — the fault log the operator reads.
- `electron/services/futures-production-workstation-composition.js` and its
  verification twin — the reporter has to reach the service.
- Related, not merged: `hold-the-book-through-a-spike` fixes the same symptom
  from the opposite end of the market — a burst too large to accept rather than
  a market too quiet to bridge.
