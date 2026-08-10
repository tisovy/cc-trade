## Why

The desk drops into `RESYNCHRONIZING` when the market moves hardest — the
operator reports it on a sharp buy or sell, "как будто не справляется сокет".
That is the moment the desk exists for, and there is a mechanism in the code
that would produce exactly this behaviour at exactly that moment.

**A frame the market makes big enough closes the socket.**

Every upstream stream is opened with a hard ceiling on one frame
(`electron/services/futures-production-workstation-transport.js:312`):

```js
maxPayload: FUTURES_WORKSTATION_JSON_LIMITS.WS_FRAME_BYTES,   // 64 KiB
```

and the message handler enforces the same ceiling a second time (`:339`), by
closing the connection with `1009 frame too large`. `ws` answers an over-`maxPayload`
frame the same way on its own: it closes the connection.

So a single oversized frame does not drop *that frame* — it drops **the stream**.
The close reaches `onDisconnect('SOCKET_CLOSED')`, which reaches
`handleDisconnect` (`futures-production-workstation-service.js:874`), which
schedules a resync of the whole session: depth, tape, header and candles go with
it, and the chart goes read-only until the session comes back.

`<symbol>@depth@100ms` carries every level that changed in the last 100 ms. On a
quiet book that is a few hundred bytes. In a violent move it is every level a
sweep touched plus every level the makers re-posted — the one condition where
the frame can reach tens of kilobytes, and the one condition where losing the
book costs the operator money.

This has not been measured on this desk yet, which is why the first task is to
measure it rather than to change it. What is certain from the code is the
consequence: whatever makes one frame exceed the ceiling takes the whole session
down and resynchronizes it.

## What Changes

- **Measure first.** Record the actual frame sizes the desk receives on a liquid
  contract during a burst, and the size distribution of `@depth@100ms` against
  the ceiling. The change that follows is decided by that reading.
- **A frame that is too large stops being a reason to lose the market.** The
  ceiling exists to bound memory against a hostile or broken peer, not to hang up
  on Binance during a spike. Either the ceiling rises to what the exchange
  actually sends on the busiest contracts with room to spare, or an oversized
  frame is dropped and the book is re-bootstrapped without tearing down the
  session — whichever the measurement supports.
- **A resync says what caused it.** `SOCKET_CLOSED` is what the desk shows today
  whether the exchange went away, the desk hung up on an oversized frame, or the
  connection was lost. Those are different facts, and the operator can only act
  on the one that names itself.
- **The renderer keeps up with a burst.** Whether the flicker under load is also
  a renderer problem is answered by the same measurement; the per-tick rebuild
  work is already scoped in `stop-rebuilding-the-desk-on-every-tick`, and this
  change does not duplicate it.

## Capabilities

### Modified Capabilities

- `futures-workstation-presentation`: a burst of market data does not take the
  market data away.

## Impact

- `electron/services/futures-production-workstation-transport.js` — the frame
  ceiling and what happens at it.
- `electron/services/futures-workstation-json.js` — the ceiling itself, which is
  shared with the local renderer protocol and must be considered separately for
  each direction.
- `electron/services/futures-production-workstation-service.js` — the reason a
  resync carries.
- Related, not merged: `switch-contracts-without-tearing-the-desk` fixes a
  *different* cause of the same symptom (a teardown that throws mid-handshake and
  leaves two contracts alive). Both can be true at once, and the operator has
  seen both.
