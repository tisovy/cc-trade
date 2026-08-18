## 0. What Was Measured

- [x] 0.1 Read the operator's timing log: one `depth` and three `depth-retry`, all `ok`, then `aggregate-ready … error`, cycling — four snapshots read and all four refused by the book.
- [x] 0.2 Reproduce against the live exchange through the operator's own proxy: `PYPLUSDT`, `TBTUSDT` and `GSUSDT` returned the same `lastUpdateId` on all four attempts with **zero** diffs delivered in 2.5 s; `BTCUSDT` bridged on the first attempt. The failure is the quiet market, not the transport.
- [x] 0.3 Establish the blast radius: `DEPTH_BOOTSTRAP_GAP` throws into `scheduleResync`, which closes the streams and rebuilds the generation, so the book takes the chart, tape and header with it and ends at `RECONNECT_EXHAUSTED`.

## 1. A Quiet Snapshot Is The Book

- [x] 1.1 Refuse a bootstrap only when a buffered diff *proves* a gap — one that starts beyond the snapshot's update id — rather than whenever none straddles it.
- [x] 1.2 Go live on a snapshot no buffered diff contradicts, and record that the bridge is still owed.
- [x] 1.3 Accept as the bridging diff the first one that either continues from the snapshot's update id or straddles it; anything else is the sequence gap it already is.
- [x] 1.4 Prove by test that a book with an empty buffer goes live on the snapshot and draws it.
- [x] 1.5 Prove by test that the first diff after a quiet bootstrap is applied whether it chains or straddles, and that one starting beyond the snapshot still asks for a recovery.
- [x] 1.6 Keep refusing a snapshot a buffered diff proves stale, and keep refusing a buffer with a hole in it — both existing tests stand unchanged.

## 2. A Failed Book Costs The Book

- [x] 2.1 Stop throwing out of the bootstrap when the book cannot be bridged: bring the session live without it.
- [x] 2.2 Mark the book stale and start a recovery on its own cooldown, the way a live sequence gap already does.
- [x] 2.3 Report the aggregate as reached-without-the-book rather than as a failure, so the timing log says which of the two happened.
- [x] 2.4 Prove by test that a bootstrap that cannot bridge leaves the header, candles and tape live and the status `live`, and that the book arrives when the recovery bridges.

## 3. The Fault Reaches The Operator

- [x] 3.1 Wire `onInternalError` through the operator composition to the log, with its phase and reason code.
- [x] 3.2 Give the two bootstrap bridge failures distinct codes, so "the snapshot was not bridged" and "the buffer had a hole" stop arriving as one.
- [x] 3.3 Keep the reporter bounded to the codes the log already accepts — a fault line carries no market payload.
- [x] 3.4 Prove by test that the composition passes the reporter through and that the boundary check still pins both compositions.

## 4. Verification

- [x] 4.1 `npm run lint`, `npx vitest run`, `npm run check:futures-production`, `check:command-path`, `check:circular`, `check:runtime-mock`.
- [x] 4.2 `OPENSPEC_TELEMETRY=0 openspec validate bootstrap-the-book-on-a-quiet-market --strict`.
- [x] 4.3 Operator confirms on live data — step 10, «Тихий контракт открывается со стаканом», in `verify-the-desk-in-one-sitting/runbook.md`: a thin contract opens with a book on the first snapshot, and a book that cannot be built leaves the chart and tape alive.
- [x] 4.4 Separate the chart from the book in that step, so the item can be settled at all. *(The 2026-08-12 pass met every book expectation on TBTUSDT — both sides filled from the first snapshot, held across every grouping step, no resync, alive in 1.5 s — and was still recorded as not closing this item, because the chart went `STALE` after ten seconds and that disarmed price picking, gestures and order lifting. The threshold is unchanged and still flat (`FUTURES_PRODUCTION_WORKSTATION_FRESHNESS.CANDLES_MS: 5_000`), so on a contract with no trades the chart still leaves `live`. What changed is that `let-the-desk-act-on-a-stale-chart` made that a label rather than a lockout. The book is judged here; the chart's behaviour is step 11, and the flat threshold itself is named in the runbook's "not ready" list as having no change behind it yet.)*
