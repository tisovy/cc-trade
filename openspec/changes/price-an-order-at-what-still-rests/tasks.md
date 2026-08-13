## 1. One Size, And It Is The One Still Working

- [x] 1.1 Value an order at its remainder — the size it was placed at less the part that has traded — in the single derivation every order surface already shares.
- [x] 1.2 Read the filled part as the stream names it (`z`) and as a snapshot names it (`executedQty`), which is the reading the drag already performs.
- [x] 1.3 State the working contract count on hover, so the exact figure agrees with the value beside it.
- [x] 1.4 Leave the dock's filled column alone: what has traded is a different question, and it already has its own column.
- [x] 1.5 Treat a fully filled order as resting nothing rather than as a negative size — it is off the book by the time anything asks.

## 2. Verification

- [x] 2.1 `OPENSPEC_TELEMETRY=0 openspec validate price-an-order-at-what-still-rests --strict` before and after.
- [x] 2.2 Measured against the pre-change derivation. Verbatim: `Expected: "500"`, `Received: "1000"` — an order of `10` at `100` with `5` filled, stated at twice what rests.
- [x] 2.3 Full suite green — 1884 passed.
- [ ] 2.4 Operator check: partially fill a working order and read its size on the chart, in the rail and in the ticket total. Added to `verify-the-desk-in-one-sitting`.
