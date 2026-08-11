## Why

The desk drops into `RESYNCHRONIZING` when the market moves hardest — the
operator reported it twice on 2026-08-11, the second time on BLUAI on a sharp
upward spike. That is the moment the desk exists for.

**The desk bounded a diff as if it were a snapshot.**

`<symbol>@depth@100ms` carries every level that *changed* in the last hundred
milliseconds. That has nothing to do with the thousand levels per side Binance
serves in a depth *snapshot*: a sweep that lifts the book, with the makers
pulling and re-posting behind it, restates far more levels than the book is
deep. The desk applied the snapshot's bound to the diff, in two places:

- `normalizeLevelArray` (`futures-workstation-market-contract.js:127`) failed
  the frame with `INVALID_DEPTH_LEVELS` past 1 000 levels on a side;
- `validateDelta` (`futures-workstation-order-book.js:131`) applied
  `SNAPSHOT_LEVELS_PER_SIDE` to the diff again.

A failure there is a throw, and `handleStreamFrame`
(`futures-production-workstation-service.js:793`) answers a throw with
`scheduleResync(session, 'MALFORMED_STREAM_FRAME')` — which closes every stream,
stops the order book, and starts a whole new generation: depth, tape, header and
candles all go, and the chart is read-only until the bootstrap reads come back.

Two more ceilings sat under the same rule and were reached the same way. The
parse budget for a stream frame was a flat `maxBytes: 64 KiB, maxNodes: 8_192`,
and the socket itself was opened with `maxPayload: 64 KiB` — and answered an
oversized frame by **closing the connection** (`1009 frame too large`), which is
the same resync by another route. None of the three was derived from the data
the desk had already decided to hold: the renderer-bound direction learned this
lesson already, and says so at `FUTURES_WORKSTATION_EVENT_MAX_NODES` — "a frame
the payload rules accept but the parser refuses is a feed that simply stops".
The exchange-bound direction never got the same treatment.

So the harder the market moved, the more certain the desk was to refuse the
update — and to resynchronize the whole workspace to recover from refusing its
own data.

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
