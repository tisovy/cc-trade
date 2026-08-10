## 0. What Was Measured

- [x] 0.1 Read the bounds against the data they bound: `@depth@100ms` is a diff and carries every changed level, while the desk bounded it at the snapshot's 1 000 per side, at `maxNodes: 8_192` and at `maxPayload: 64 KiB` — none derived from the book the desk retains.
- [x] 0.2 Establish the consequence in code: a refused frame throws, and `handleStreamFrame` answers a throw by resynchronizing the whole session rather than the book.
- [ ] 0.3 Record, from a live session, the largest depth diff actually delivered on a volatile contract, and confirm it now passes. Until then the new bounds are derived, not observed.

## 1. A Diff Is Bounded As A Diff

- [x] 1.1 Bound a diff by `FUTURES_WORKSTATION_DIFF_LEVELS_PER_SIDE`, derived from the book depth rather than equal to it, in both the market contract and the order book.
- [x] 1.2 Derive the stream frame's byte and node budgets from that same bound, so no ceiling under it can refuse a frame the rules accept.
- [x] 1.3 Leave the snapshot bound where it is: Binance serves a thousand levels per side and a deeper snapshot is not a thing that exists.
- [x] 1.4 Leave the renderer-bound ceiling alone: what the desk accepts *from the renderer* is a different rule with a different threat behind it.
- [x] 1.5 Prove by test that a diff restating more levels than the book is deep is accepted, and that a frame past the new ceiling is still refused.

## 2. A Frame Is Not Worth The Connection

- [x] 2.1 Stop closing the upstream socket over an oversized frame: drop the frame and keep the stream.
- [x] 2.2 Report the drop, with its size, so a desk that starts refusing frames is visible rather than silent.
- [x] 2.3 Keep the reviewed socket options pinned — to the derived ceiling — in `check:futures-production`.
- [ ] 2.4 Give a desk-initiated refusal its own reason code, distinct from `SOCKET_CLOSED` and from `MALFORMED_STREAM_FRAME`, and carry it to the workspace's reason line.

## 3. A Refused Frame Costs The Book, Not The Desk

- [x] 3.1 Recover from a dropped or rejected depth frame by re-bootstrapping the *book* — the snapshot plus the buffered diffs — rather than by tearing down the session's streams, tape, header and candles.
- [x] 3.2 Prove by test that a rejected depth frame leaves the tape, the header and the candles live throughout.
- [x] 3.3 Prove by test that a book that cannot be rebuilt at all stays stale while the desk keeps delivering, rather than escalating to a session resync.
- [x] 3.4 Keep the last delivered book on screen while it is being rebuilt, and stop the freshness monitor raising on a book that has no view to send — that raise was itself a path to a session resync.

## 4. Under Load, End To End

- [ ] 4.1 Drive the service with a burst — a diff per 100 ms carrying thousands of levels, plus a heavy tape — and assert the session stays live throughout.
- [ ] 4.2 State plainly whether the renderer keeps up at that rate; if it does not, hand the finding to `stop-rebuilding-the-desk-on-every-tick` rather than fixing it here.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:command-path`, `check:circular`, `check:runtime-mock`.
- [ ] 5.2 Operator confirms on live data during a volatile session: a sharp move no longer sends the workspace to `RESYNCHRONIZING`, and any resync that does happen states a cause they can act on.
