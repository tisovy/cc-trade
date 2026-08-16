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

**Resolved 2026-08-16, and it is the second of the two answers.** 5.2 asked for a
baseline run "on master before any other change in this batch lands". That run is
no longer obtainable, and saying so is worth more than approximating it.

The batch has landed. `carry-execution-ahead-of-market-data` §1–§4 are in `main`
— the two outbound lanes, the single serialization, the parse-once boundary and
the platform parser — and so is this change's own §2. There is no revision of
`main` left that is both "before the batch" and "now".

What *is* obtainable is not the same thing, and the difference matters. The
pre-batch tree can be copied out with `git archive` and driven, which is the
established technique here — `carry-execution`'s §5.1 measured 799931d
(2026-08-12, the commit before the batch) against the working tree exactly that
way. But the burst case does not exist at 799931d, so the harness driving it
would be this change's own, run against the old modules. That measures the old
*code*; it does not reproduce the old *run*, and calling the result a "baseline
on master" would be claiming a measurement nobody took.

So 5.2 is restated below as a baseline at the revision it is actually run
against, with the pre-batch comparison offered as the separate, honestly-labelled
thing it is. The number the burst case's bound is set from (4.2) comes from the
first, not the second.

~~§2 is done and §1, §3 and §4 are not.~~ **§1, §2 and §3 are done as of
2026-08-16.** §1 opened `binance-connection.js`,
`futures-production-workstation-service.js` and the two renderer hooks, and the
coordination this paragraph asked for did happen: three sessions were in this
tree at once, and the marks were built without touching the burst case or the
history path either of the others held. What made that cheap was keeping the
whole of §1 in one new module — `src/utils/frameMarks.js` — so the four contended
files took an import and a line each rather than a design.

## 1. A Frame Carries Where It Has Been

**The marks ride the transport envelope and never the protocol.** That is not a
preference, it is the lesson already paid for by `splitMarketGenerationStamp`:
the workstation channel validates an exact key set, so a frame still carrying a
stamp is refused as malformed — which is how a chart, a book and a tape that were
correct on both sides went dark between them. The stamp goes on after the event
is built and validated, and comes off in `readDeskFrame` before the far side
validates it. The protocol version does not move and no validator learns a new
field. `src/utils/frameMarks.js` is the whole of it.

**Two things §1 changed that anyone testing delivery should know, written here
because the session that owns §4 was not reachable by message.** Neither breaks
anything today — the full suite is green, burst case included — but both would be
puzzling to hit blind:

- The service's emitter is now `emit(event, frame, timing)`. The third argument
  is `{marks, frameBytes}`. Existing `emit: event => …` callers are unaffected.
- A **sampled** frame's delivered text carries the stamp, so `frame ===
  JSON.stringify(event)` does not hold for it. The existing assertion that it
  does (`hands the frame it measured to whatever delivers it`) still passes,
  because the sampler lives per-connection in `binance-connection.js` and the
  service is driven directly in that test — but a case built at the connection
  level would see a stamped frame roughly once per resource per ten seconds.

- [x] 1.1 Mark a frame with the exchange's own event time where the payload states one, and with the time the main process received it. *(Both in `handleStreamFrame`, and the receive mark is taken **before** the frame is read — the parse is the first thing a frame waits for, and a mark taken after it hides exactly the wait being asked about. **Discovered by running it, not by reading it:** the exchange's own event time is not `event.eventTime`. Each normalizer keeps what its resource means by "when" — a trade's is the trade's, a kline's its close, a ticker's the later of two — and none of those is when Binance sent the frame. It is read off `E` at the boundary in `normalizeFuturesWorkstationStreamFrame`, through `readFuturesWorkstationTimestamp`, because the upstream parser answers every integer as an exact-digit token and comparing one to a number silently yields null. That is the same token machinery `carry-execution` §4.8 kept its own parser for.)*
- [x] 1.2 Mark it with the time it was queued for the renderer and the time the renderer received it. *(Queued in `markOutboundFrame`, at the moment the frame is handed to the outbox — the point where it stops being the desk's and becomes the socket's, whether it is written straight through or held. Received in `readDeskFrame`, before the frame is read, so the reading counts as the renderer's own work rather than as time on the wire.)*
- [x] 1.3 Mark it with the time the desk committed it to screen, taken where the commit actually happens rather than where the state was set. *(An effect keyed on `state.revision`, not the reducer. A mark inside the reducer times the desk's bookkeeping and misses the render — and the render is the stage the complaint is about.)*
- [x] 1.4 Keep the marks off the trading path: producing them SHALL NOT change what is delivered or when. *(Three refusals, each of which would otherwise be worse than having no diagnostic. A sample that would push a frame past the byte ceiling **is not taken** — a book just under the limit, stamped, is a frame the far side will not parse, and a refused book is a market that looks like it went quiet. The stamp is spliced into the string that was already serialized and already measured, so it is not paid for twice. And `stampFrameMarks` is total: proven against twelve malformed mark sets and six non-frames that it never raises and never alters the frame it declines to stamp.)*
- [x] 1.5 Prove by test that a delivered frame carries all five marks in order, and that a frame missing an exchange event time is still marked for the rest. *(Two tests. `frameMarks.test.js` carries a frame through the real wire path — stamp, `readDeskFrame`, measure — and asserts the five marks are ordered and every leg non-negative; the service test asserts the first two marks come off a real stream frame, and that what the desk delivers **before** any stream frame has arrived states no upstream leg rather than inventing one. A frame with no usable exchange time reports `upstreamMs: null` and every other leg normally — null meaning **not knowable**, which covers both a frame that states no time and one whose stated time is ahead of local receipt. The second is not a corner: the desk's own measured skew against Binance is ~170 ms on a 345 ms leg, so reporting `0` there would claim the exchange reached the desk instantly.)*

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

Corrected by the audit of 2026-08-13: the reader printed the deepest backlog in
frames, the heaviest in bytes and one timestamp, in a single run of text — and
the two peaks need not be the same line. One book alone outweighs three status
frames, so the KB figure read as having happened at a minute it did not. The
time is now attached to the reading it was measured on and the other is named
`heaviest`. The test that covers it now uses two lines whose peaks differ, so
the format cannot silently go back to implying one event.

## 3. The Record Takes The Marks

- [x] 3.1 Add a diagnostic event kind for a frame's timing, with a recognized phase and code, so the record accepts it under the rule it already enforces. *(The `frame` kind carries the four gaps between the five marks plus the whole, as counts — a delay is a count of milliseconds, and `count` cannot spell a decimal, which is the same rule that keeps every other amount out of this file. `upstreamMs` alone is nullable: a frame stating no event time and a frame whose stated event time is ahead of local receive are the same case, and both say null rather than 0 — reporting 0 would claim the exchange reached the desk instantly. `frame` joins `estimate` as a **sealed** kind, so an unexpected field loses the whole line instead of being quietly not-copied: both are built for this record alone, so an extra property is a caller handing the privacy boundary something it never declared.)*
- [x] 3.2 Record the per-stage delays and the queue readings; record no price, size, notional or profit-and-loss value with them. — queue readings were already done; **the per-stage delays now land too.** `frames` and `bytes` are counts under the record's existing `count` rule, so neither can spell a decimal; a test asserts a `bytes` of `'0.5'` refuses the whole line. The same rule carries the delays: every leg is a count of milliseconds, which is precisely why a delay may sit in this file at all. `scripts/read-desk-record.mjs` grew a "Where a frame spent its time" section beside "How far behind the renderer fell" — the first says the desk was behind, the second says **which step** it was behind in, and only the second is an answer the operator can act on. A leg nobody could measure prints as `—`, never as `0`: `median([])` is 0, and a leg that reads as instant would send the operator looking in the wrong place.
- [x] 3.3 Sample rather than record every frame, and state the sampling rule in the code that enforces it, so the record stays inside its existing bounds at ten frames a second. *(One frame per resource per ten seconds, in `createFrameMarkSampler`, with the arithmetic that chose the number written beside it. Time-based rather than one-in-N deliberately: what has to stay bounded is the record's line rate, and the frame rate is the market's business — a one-in-fifty rule writes five lines a second on a busy contract and none at all on a quiet one, which is backwards on both counts. At five resources this is a line every two seconds, ~6 MB a day against the record's 32 MB bound.)*
- [x] 3.4 Keep writing the record incapable of raising into a caller or delaying a delivery, as it is today. *(Unchanged, and nothing new was added that could. The record's own write path is untouched. On the producing side the frame kind goes through `record()` like every other kind, and the two new sites that feed it — the stamp on the way out and the report on the way back — are both total; see 1.4. The report is answered before the credential gate and outside the market-scope machinery, because it reaches no exchange and moves no order, and a diagnostic that an unconfigured desk could refuse would go missing exactly when the desk is worth asking about.)*
- [x] 3.5 Prove by test that a timing event carrying a money value is refused or stripped, and that a record that cannot be written loses the line and nothing else. *(First half proven directly: `frame` joins `estimate` as a **sealed** kind, so a `markPrice` offered beside the delays loses the whole line rather than being quietly not-copied — both kinds are built for this record alone, so an undeclared field is a caller handing the privacy boundary something it never declared. Second half: already proven and **not duplicated**. `record()` routes every kind through one `writeEvent`, and the four degradation tests — cannot open, write fails, stream fails after handover, disk stops keeping up — are generic over kinds. A frame-shaped copy of them would pass for the wrong reason and prove nothing this change did; saying so is worth more than another green tick.)*

## 4. A Burst Case With A Stated Bound

- [x] 4.1 Build a burst case that delivers a full depth frame every hundred milliseconds at the widest legal payload, candles alongside it, and a terminal execution report during the burst.
- [x] 4.2 Assert that the execution is applied within a stated bound, and state that bound from a measured run rather than from an estimate.
- [x] 4.3 Assert that the book delivered during the burst is the newest one, and that what was superseded is counted.
- [x] 4.4 Run it under the existing Vitest surface, with no browser or Electron automation runner.
- [x] 4.5 Make it callable on its own, and add it to the aggregate verification only if it is fast enough to belong there.

`src/App.futures-burst.test.jsx` drives the real renderer outbox, production
protocol parser/reducer, execution hook and order-book view under Vitest/JSDOM.
Six 41,795-byte books — all 64 rows per side and every bounded row value at its
64-character legal maximum — are offered on absolute 100 ms deadlines, with a
contract-candle frame beside each one. A terminal report is offered on cycle
three while the socket is stalled. On drain the test requires the working order
to leave the rendered ticket, the last book's exact first bid to reach the
rendered book, and exact counts of four superseded books and five superseded
candle frames.

The 600 ms execution-application bound is measured, not estimated. Isolated
final-harness calibration (n=20) was min 329.271 ms, p50 334.338 ms, p90 338.717
ms, p99 345.136 ms, max 345.878 ms, range 16.607 ms and sample standard
deviation 3.680 ms. Aggregate calibration (n=6) was min 373.844 ms, p50 423.635
ms, p90 486.699 ms, p99 487.390 ms, max 487.467 ms, range 113.623 ms and sample
standard deviation 49.193 ms. The bound is the aggregate maximum plus one full
100 ms scheduler interval, rounded up to a cadence boundary: (487.467 + 100) ms
→ 600 ms. `npm run test:futures-burst` calls it alone; one bound-enforcing run
takes about 1.1 seconds, and twenty consecutive isolated plus six aggregate
measurement runs passed, so the ordinary `npm test` Vitest glob includes it.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`, and the new burst case.
- [x] 5.2 Record one measured run of the burst case ~~on master before any other change in this batch lands~~ at the revision it is actually run against, naming that revision, as the baseline later runs are measured against. See §0: the pre-batch run is no longer obtainable, and the batch it was meant to precede has landed.
- [ ] 5.2a Optionally, and labelled as the different thing it is: drive the same harness against `git archive 799931d` — the commit before the batch — and record it as "this change's harness against the old modules", never as a baseline run of the old desk.
- [ ] 5.3 Operator confirms that the record names the stage a late frame waited in, on a contract that actually produced the complaint.

### §4 baseline at `73fa5217da7350b60de83b360022fc95fb2ee37e`

The baseline is twenty consecutive focused runs from an exact `git archive` of
that revision with the repository's `node_modules` symlinked in. Execution
application — from offering the terminal report to observing the completed
order on screen — was min 330.104 ms, p50 335.060 ms, p90 347.276 ms, p99
388.517 ms, max 390.134 ms, range 60.030 ms, mean 340.526 ms and sample standard
deviation 15.806 ms (n=20). Whole-burst time was min 530.943 ms, p50 535.790 ms,
p90 547.877 ms, p99 589.293 ms, max 590.837 ms, range 59.894 ms, mean 540.938
ms and sample standard deviation 15.954 ms. Across all runs the offered cadence
was 98.359–101.580 ms, every depth frame was 41,795 bytes, and the observed
counts were exactly four superseded depth frames and five superseded candle
frames.

The asserted 600 ms execution bound remains deliberately based on the noisier
aggregate calibration, not this faster focused baseline: its 487.467 ms maximum
plus one complete 100 ms burst interval is 587.467 ms, rounded upward to the
next cadence boundary. That leaves one scheduler beat of measured headroom
without turning a renderer that waits through an additional beat green.

5.2a was not run. Revision `799931d` has neither
`electron/services/renderer-outbox.js` nor the burst test, so the same harness
cannot load against its modules. Making it run would require a compatibility
implementation and would no longer be the production-code-free comparison the
optional task permits.

## 6. Do The Tests Bite?

Run against the tree before this change (`git archive HEAD`, symlinked
`node_modules`). Seven tests fail there: two new and five that had to be widened.

- outbox: states a rising queue while the socket is stalled, and nothing once it drains — new
- outbox: states an account backlog, which loses nothing and so said nothing — new
- outbox: delivers the newest book of a burst / drops a replaceable frame / second backlog inside the cooldown — the three existing backlog assertions, each now naming the depth as well as the loss
- record: keeps what a backlog superseded, what it dropped, and how deep it got — including that a line without the depth is refused, and that a `bytes` of `'0.5'` refuses the whole line
- reader: states how far behind the renderer fell, not only what it lost

None of the seven are guards; all seven describe behaviour that did not exist.

### §1 and §3, run against `18013e2` — the commit before this session's first

Four bite, one is a guard and says so in its own title, and ten cannot be asked
the question at all. All three groups are listed, because "eleven new tests" and
"four that would have caught the bug" are very different claims.

**Bite** — they fail against the tree before the change and pass after it:

- record: keeps a frame timing as delays, and refuses an amount beside them
- record: states an unmeasurable upstream leg as null and still marks the rest
- service: hands over where a delivered frame came from and when it arrived
- reader: names the step a late frame waited in

**A guard, and named one in its own title** — `guards: refuses a delay that is
not a whole count of milliseconds`. It passes against the old tree for the wrong
reason: before the `frame` kind existed every frame event was refused whatever it
carried, so a test of *how* it refuses proves nothing about this change. It is
kept because it bites on a future change that widens one of those fields off
`count` — which is the change worth stopping, since `count` is the only reason a
delay may sit in a file that keeps amounts out.

**Cannot be asked** — the ten in `frameMarks.test.js`. The module does not exist
at `18013e2`, so they fail there on an import error, which is not the same thing
as biting and should not be counted as it. What they are is a description of
behaviour that did not exist. Two of them are worth naming anyway because they
assert a failure this repository has already paid for once: `rides the envelope
without the protocol ever seeing it` asserts that a frame still carrying its
stamp **is refused** by the exact-key rules — the `splitMarketGenerationStamp`
defect, asserted rather than assumed — and `never raises, and never alters the
frame it declines to stamp` is §1.4 held to twelve malformed mark sets and six
non-frames.

### §4, run against deliberately broken copies of `73fa5217da7350b60de83b360022fc95fb2ee37e`

Both negative controls used an exact archived copy with symlinked
`node_modules`; neither mutation touched the working tree.

- Keeping the older queued market frame while accepting its replacement makes
  the focused case fail at the rendered newest-book assertion: expected first
  bid `900015…`, received `900007…`.
- Replacing the queued frame but omitting only the `superseded` tally makes the
  focused case fail at the backlog assertion: expected four superseded depth
  frames, received zero.

The timing assertion bites independently too: an aggregate run at the first
400 ms candidate bound failed at 425.135 ms. That failure is what triggered the
aggregate calibration and the measured 600 ms bound above; the threshold was
not loosened speculatively.
