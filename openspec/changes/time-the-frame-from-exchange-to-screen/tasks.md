## 0. Measured So Far, Before The Work Starts

Left by the session that closed `name-the-algo-order-that-fired` on 2026-08-13,
which then went on to do §2. What follows is what is measured rather than built,
so the next session does not pay for it twice.

- **The exchange → main-process leg is 345ms.** Event time `E` against local
  receive, n=200, over the desk's own endpoint and socket options, clock skew
  corrected against `/fapi/v1/time` (skew p50 170ms over 7 REST round trips of
  ~670ms): p50 345ms, p90 347ms, p99 351ms, max 362ms. The skew estimate assumes
  a symmetric round trip, so treat this as "a third of a second" with roughly
  ±50ms of uncertainty — it is a floor for 1.1→1.2, not a stage reading.
- **The account read beat is 30.0s**, median gap between consecutive `read`
  lines in `~/.config/cc-trade/diagnostics/desk-2026-08-13-000.jsonl` (n=127;
  108 gaps in 20–45s, median 30.0s). Useful as a sanity check that the record's
  timestamps are trustworthy at the second scale before anything is built on
  them at the millisecond scale.
- **Watch which path a bench connects on.** On this machine `/ws/<stream>` and
  `/stream?streams=` open and then deliver nothing, while `/market/stream` and
  `/public/stream` — the paths the desk itself uses — deliver normally. Whatever
  listens on `127.0.0.1:1080` routes by path. A measurement harness that reaches
  for Binance's documented path will sit at zero frames and read as a stall that
  is not there. This is not new: `futures-mark-price-feed.js:33` records that the
  unrouted market paths were decommissioned on 2026-04-23 and that "the handshake
  still succeeds and the socket stays open, so nothing reports an error — it
  simply never delivers a frame."

- **Prove the private leg is delivering before any bound is set on it.** The
  record already answers this without new code: `reason: 'stream'` is written by
  exactly one call site, the futures user-data socket's `open` handler
  (`binance-connection.js:1656`), so a `stream` line is "the private socket
  opened". In `desk-2026-08-13-000.jsonl` the session that began 11:42:06 ran ~95
  minutes with `{bootstrap: 1, refresh: 190}` and **no `stream` line at all**,
  while earlier sessions the same day got theirs (1, 3 and 2 lines). 190 refresh
  beats means orders rested for the whole of it and the desk was told nothing by
  the stream. Across all three journal days there is also not one read with
  reason `unstated`, which an execution report is supposed to schedule.

  So a burst case that asserts "the execution is applied within N ms" can pass on
  a bench while the leg it stands for delivers nothing at all in production. 4.2's
  bound is worth only as much as the evidence that the leg is alive; 5.3 should
  ask the operator for that evidence first, and the check is a record reading
  rather than a terminal watch.

Stale premise to resolve before doing 5.2: it asks for a baseline run "on master
before any other change in this batch lands", and most of the batch has already
landed. Either restate it as a baseline at the revision it is actually run
against, or say plainly that the pre-batch baseline is no longer obtainable.

§2 is done and §1, §3 and §4 are not. §1 opens `binance-connection.js`,
`futures-production-workstation-service.js` and the two renderer hooks — all
four were committed to within hours by another session, which also has a
stream-recovery fix expected to land in `binance-connection.js`. Coordinate
before opening 1.1.

## 1. A Frame Carries Where It Has Been

- [ ] 1.1 Mark a frame with the exchange's own event time where the payload states one, and with the time the main process received it.
- [ ] 1.2 Mark it with the time it was queued for the renderer and the time the renderer received it.
- [ ] 1.3 Mark it with the time the desk committed it to screen, taken where the commit actually happens rather than where the state was set.
- [ ] 1.4 Keep the marks off the trading path: producing them SHALL NOT change what is delivered or when.
- [ ] 1.5 Prove by test that a delivered frame carries all five marks in order, and that a frame missing an exchange event time is still marked for the rest.

## 2. The Queue States Its Depth

- [x] 2.1 Report the outbound queue's depth in bytes and in frames, per resource.
- [x] 2.2 Report what was superseded and what was dropped, per resource, as counts rather than as log lines. **Already true before this change** — `renderer-outbox.js` has counted both per resource since `carry-execution-ahead-of-market-data`, and the record's `backlog` kind already carried them. Nothing was built for this task; the depth readings were added beside what was there.
- [x] 2.3 Prove by test that a stalled socket produces a rising queue reading and a superseded count, and that both return to zero when it drains.

Measured before building: `Buffer.byteLength` on a 60 KB book frame costs 5.37µs
(n=20000, after warmup). At ten frames a second that is 54µs per second — free —
but it is asked only of a frame that actually waits, because a frame written
straight through has no depth to report and the path it is written on is the one
that must not slow down. For these frames byte length and string length happen to
be equal (the payloads are ASCII), which is worth knowing but not worth relying
on: a symbol is `[A-Z0-9]` by rule, and nothing else in the frame is text.

One reading that did not exist before and is not in the proposal: an **account**
backlog. Account frames are never superseded and never dropped, so under the old
rule — a line per resource that lost something — a renderer sitting on a minute
of fills produced no line at all. That is precisely the backlog the operator
feels, and it now states its depth.

The line is still written when the backlog ends, so what it carries is the peak
reached rather than the nothing that remains.

## 3. The Record Takes The Marks

- [ ] 3.1 Add a diagnostic event kind for a frame's timing, with a recognized phase and code, so the record accepts it under the rule it already enforces.
- [ ] 3.2 Record the per-stage delays and the queue readings; record no price, size, notional or profit-and-loss value with them. — **queue readings done**, per-stage delays wait on §1. `frames` and `bytes` are counts under the record's existing `count` rule, so neither can spell a decimal; a test asserts a `bytes` of `'0.5'` refuses the whole line. `scripts/read-desk-record.mjs` grew a "How far behind the renderer fell" section so the reading reaches the operator rather than only the file.
- [ ] 3.3 Sample rather than record every frame, and state the sampling rule in the code that enforces it, so the record stays inside its existing bounds at ten frames a second.
- [ ] 3.4 Keep writing the record incapable of raising into a caller or delaying a delivery, as it is today.
- [ ] 3.5 Prove by test that a timing event carrying a money value is refused or stripped, and that a record that cannot be written loses the line and nothing else.

## 4. A Burst Case With A Stated Bound

- [ ] 4.1 Build a burst case that delivers a full depth frame every hundred milliseconds at the widest legal payload, candles alongside it, and a terminal execution report during the burst.
- [ ] 4.2 Assert that the execution is applied within a stated bound, and state that bound from a measured run rather than from an estimate.
- [ ] 4.3 Assert that the book delivered during the burst is the newest one, and that what was superseded is counted.
- [ ] 4.4 Run it under the existing Vitest surface, with no browser or Electron automation runner.
- [ ] 4.5 Make it callable on its own, and add it to the aggregate verification only if it is fast enough to belong there.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, and the new burst case.
- [ ] 5.2 Record one measured run of the burst case on master before any other change in this batch lands, as the baseline the others are measured against.
- [ ] 5.3 Operator confirms that the record names the stage a late frame waited in, on a contract that actually produced the complaint.

## 6. Do The Tests Bite?

Run against the tree before this change (`git archive HEAD`, symlinked
`node_modules`). Seven tests fail there: two new and five that had to be widened.

- outbox: states a rising queue while the socket is stalled, and nothing once it drains — new
- outbox: states an account backlog, which loses nothing and so said nothing — new
- outbox: delivers the newest book of a burst / drops a replaceable frame / second backlog inside the cooldown — the three existing backlog assertions, each now naming the depth as well as the loss
- record: keeps what a backlog superseded, what it dropped, and how deep it got — including that a line without the depth is refused, and that a `bytes` of `'0.5'` refuses the whole line
- reader: states how far behind the renderer fell, not only what it lost

None of the seven are guards; all seven describe behaviour that did not exist.
