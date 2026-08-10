## 0. Measure Before Changing

- [ ] 0.1 Record the frame sizes actually delivered on `<symbol>@depth@100ms`, `@aggTrade`, `@ticker` and `@kline` for a liquid contract over a session that includes a sharp move: the maximum, the 99th percentile and the count above the 64 KiB ceiling.
- [ ] 0.2 Record whether any session in that window was resynchronized, and with what reason.
- [ ] 0.3 State the reading in the change before touching the ceiling — if no frame comes near 64 KiB, the cause is elsewhere and this change says so rather than raising a limit for nothing.

## 1. The Ceiling Stops Costing The Market

- [ ] 1.1 Decide from the measurement: raise the ceiling to the exchange's real maximum with headroom, or drop the oversized frame and recover, and record why.
- [ ] 1.2 Apply it to the upstream direction only; the ceiling on frames this desk *accepts from the renderer* is a different rule with a different threat behind it, and is not widened here.
- [ ] 1.3 Prove by test that a frame above the old ceiling no longer ends the session, and that the book afterwards matches the exchange.

## 2. A Resync Names Its Cause

- [ ] 2.1 Give a desk-initiated close its own reason code, distinct from `SOCKET_CLOSED`.
- [ ] 2.2 Carry that reason to the workspace's reason line.
- [ ] 2.3 Prove by test that each of the three causes reaches the operator under its own name.

## 3. Under Load, End To End

- [ ] 3.1 Drive the service with a burst — a depth diff per 100 ms carrying hundreds of levels, plus a heavy tape — and assert the session stays live throughout.
- [ ] 3.2 State plainly whether the renderer keeps up at that rate, and if it does not, hand the finding to `stop-rebuilding-the-desk-on-every-tick` rather than fixing it here.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms on live data during a volatile session: a sharp move no longer sends the workspace to `RESYNCHRONIZING`, and any resync that does happen states a cause they can act on.
