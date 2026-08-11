## 0. What Was Measured

- [x] 0.1 Read the bounds against the data they bound: `@depth@100ms` is a diff and carries every changed level, while the desk bounded it at the snapshot's 1 000 per side, at `maxNodes: 8_192` and at `maxPayload: 64 KiB` — none derived from the book the desk retains.
- [x] 0.2 Establish the consequence in code: a refused frame throws, and `handleStreamFrame` answers a throw by resynchronizing the whole session rather than the book.
- [x] 0.3 Record, from a live session, the largest depth diff actually delivered on a volatile contract, and confirm it now passes. Until then the new bounds are derived, not observed. **Read on 2026-08-11**: five minutes of `@depth@100ms` on seven contracts — the four biggest movers of the day over 50M USDT turnover (BLUAI +94%, BEAT −61%, TST −35%, BMT −32%) and the three busiest (BTC, ETH, SNDK), 19 000 frames. The largest diff came from BLUAIUSDT, the contract the operator reported the spike on: **1 137 levels on one side, ~8 308 parser nodes, 40 657 bytes**. That single frame breaks *both* old bounds — past the 1 000-level snapshot rule and past the flat 8 192-node parse budget — so the old desk would have thrown `INVALID_DEPTH_LEVELS` on it and resynchronized the whole workspace. The defect reproduces on live data in five minutes of watching. Against the new bounds the same frame is 28.4 % of the level bound, 25.8 % of the node budget and 7.9 % of the byte ceiling: it passes, with roughly 3.5× headroom on the binding dimension. Ordinary traffic is far below that — BTCUSDT means 1.3 KB a frame, p99 7.5 KB.

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
- [x] 2.4 Give a desk-initiated refusal its own reason code, distinct from `SOCKET_CLOSED` and from `MALFORMED_STREAM_FRAME`, and carry it to the workspace's reason line. Three codes now stand apart: `STREAM_FRAME_REFUSED` (the desk dropped a frame past its own ceiling — stated on the reason line once per five seconds, session stays live), `CONNECTION_ROTATED` (the desk retired the socket on its 24-hour schedule) and the socket's own reason carried into the resync instead of the flat `SOCKET_DISCONNECTED` every ending used to report. The reason line keeps the last code until the next status carries one, so the rebuild that follows a refused depth frame takes the code back off it — a refusal stated and then repaired would otherwise name a condition that is over for the rest of the session. Stated limit: a refusal on the tape or header socket leaves no book to rebuild, so its code stays on the line until the next status event.

## 3. A Refused Frame Costs The Book, Not The Desk

- [x] 3.1 Recover from a dropped or rejected depth frame by re-bootstrapping the *book* — the snapshot plus the buffered diffs — rather than by tearing down the session's streams, tape, header and candles.
- [x] 3.2 Prove by test that a rejected depth frame leaves the tape, the header and the candles live throughout.
- [x] 3.3 Prove by test that a book that cannot be rebuilt at all stays stale while the desk keeps delivering, rather than escalating to a session resync.
- [x] 3.4 Keep the last delivered book on screen while it is being rebuilt, and stop the freshness monitor raising on a book that has no view to send — that raise was itself a path to a session resync.

## 4. Under Load, End To End

- [x] 4.1 Drive the service with a burst — a diff per 100 ms carrying thousands of levels, plus a heavy tape — and assert the session stays live throughout. Ten seconds of market at the exchange's own cadence: 100 diffs of 2 000 levels a side in sequence, 21 prints a tick beside them, header, mark and candles on every tick (`futures-workstation-service.test.js`, "holds a live session through a burst of full-width diffs and a heavy tape"). The session stays live and on generation 1, every one of the 100 diffs is applied and delivered, no resource goes stale, and the absorbed-fault log is empty — no book recovery, no refused frame, no resync. The main process spends ~2 s of CPU on those 10 s of market.
- [x] 4.2 State plainly whether the renderer keeps up at that rate; if it does not, hand the finding to `stop-rebuilding-the-desk-on-every-tick` rather than fixing it here. **The renderer's data path keeps up with room to spare; its rebuild path is not measured here and is not this change's to fix.** Measured on this machine against the shared renderer modules, one depth frame is 118 KB of 1 000 levels a side and costs: parse and validate 2.68 ms, state apply 0.004 ms, grouping both sides plus wall marking 0.07 ms ungrouped — 2.75 ms a frame, 2.7 % of a 100 ms tick. At a 50× grouping step the grouping walks deep into the book and costs 1.67 ms instead, taking the frame to ~4.4 ms, still under 5 % of the tick. What is *not* measured is React reconciliation and paint: every depth frame replaces `resources.depth` with a new object, so the whole workstation subtree re-renders (the chart and the ticket are memoized; the view is not), and jsdom numbers would not transfer to Chromium. That is `stop-rebuilding-the-desk-on-every-tick` §3, where these numbers are now recorded.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `check:command-path`, `check:circular`, `check:runtime-mock`.
- [ ] 5.2 Operator confirms on live data (gathered as item 2 of the third pass in `verify-the-desk-in-one-sitting/runbook.md`) during a volatile session: a sharp move no longer sends the workspace to `RESYNCHRONIZING`, and any resync that does happen states a cause they can act on.
