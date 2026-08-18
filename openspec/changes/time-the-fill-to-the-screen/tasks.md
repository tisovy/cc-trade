## 0. What Is Already Known, So It Is Not Re-derived

Read 2026-08-18 from the code on disk and the operator's own record, before any
of the work below.

- **Both paths from the report to the screen exist.** Direct:
  `futures_execution_update` → `mergeOrderUpdate`
  (`src/hooks/useFuturesTrading.js:550-583`), where `OPEN_ORDER_STATUSES` holds
  `PARTIALLY_FILLED` (`:48`) so a partly filled order stays listed with the
  filled quantity the report carried, and `normalizeOrderSource` (`:148`) spreads
  the row rather than rebuilding it, so `z` survives. Folded:
  `foldFuturesWorkingOrder` (`electron/services/futures-account-state.js:471`)
  replaces the held row and `broadcastFuturesAccountState` sends it, and
  `preferNewerOrder` (`useFuturesTrading.js:265`) keeps a lagging REST snapshot
  from undoing it. Nothing below is a repair of these; there is no measurement
  saying they are broken.
- **The account lane carries no marks.** `markOutboundFrame`
  (`binance-connection.js:782`) is reached only from the workstation sender;
  `broadcastToRenderers` (`:1135`) sends on `ACCOUNT_FRAME` and stamps nothing.
  `readDeskFrame` (`src/utils/deskFrameRouter.js`) takes `receivedAt` for every
  frame but returns it only on the workstation kind.
- **Measured in the record:** 2026-08-18 holds 20 067 `frame` lines across its
  two segments, resources `depth`, `candles` and `header` only. Across
  2026-08-15..18 the account lane has none.
- **Rate this lane will write at, from the same record:** the busiest day,
  2026-08-16, has 75 commands and 93 `unstated` reads. Ordinary days are 5–29
  commands. Even counting several reports per fill, this is tens to low hundreds
  of lines a day at ~200 bytes — against a 32 MB record bound and its measured
  pathological ceiling of ~600 lines a minute. This is what §1.4 rests on.

## 1. The Account Lane Carries The Marks

- [x] 1.1 Take the two upstream marks where the private stream's frame is read: the exchange's own event time from the frame (`E`, and the order's `T` where the frame states one), and the local time the main process received it. State beside them that the first crosses two clocks, as the market lane already does.
- [x] 1.2 Carry those marks to both frames one report produces — the execution report sent to the renderer and the account envelope folded from it — and stamp them where the frame is handed to the transport, so the queue mark means the same thing it means on the market lane.
- [x] 1.3 Leave every path that sends an account frame for another reason unmarked. A read's envelope has no exchange time and no arrival, and a mark invented for it would be a measurement of nothing.
- [x] 1.4 Do not sample this lane, and state why where the market lane's sampler is stated: the market samples because it runs at the exchange's cadence, this runs at the account's, and the frame a sample would drop is the fill the record is being asked about. §0's rate is the ceiling this rests on.
- [x] 1.5 Prove by test that an execution report arriving on the private stream reaches the renderer carrying marks whose exchange time is the frame's own, that the account envelope folded from it carries the same, and that an envelope broadcast by a read carries none.
      One test in `binance-connection.test.js`, all three halves in it. Red
      against the tree before this change.

## 2. The Renderer Closes The Marks With The Commit

- [x] 2.1 Answer account frames with their marks and their arrival time from the frame router, on the same terms as the workstation kind, and take the marks off the payload before any subscriber sees it — the protocol never learns this file exists.
      **With one difference from the workstation lane, found by a test rather
      than by reading.** `marks` is a word no workstation event uses, and it is
      a word this lane already uses: `futures_position_marks` carries the live
      mark price of every open position under exactly that name. Taking the
      stamp off by name emptied that frame — positions kept their snapshot price
      and stopped ticking, and the suite's own `re-values open positions from the
      mark feed` case is what said so. So the value is read before it is taken:
      what is not a stamp is left where it is. The sender refuses the same
      collision from the other end — a frame that already names `marks` goes out
      unmeasured rather than carrying the key twice, which parses as the
      payload's and would lose the measurement silently.
- [x] 2.2 Report the commit from an effect that runs after React has committed the tree the frame produced, not from inside the reducer: "the state was set" is not "the operator saw it", and the difference is the stage the complaint is about.
- [x] 2.3 Report which order the frame was about and what the exchange said about it, and whether the working orders the desk holds actually changed when it was applied.
- [x] 2.4 Never let the measurement cost the frame: a report that cannot be built or sent is dropped, and nothing about producing it may change what is drawn or when.
- [x] 2.5 Prove by test that a marked report is reported after the commit with its identity, its state and the four legs; that a report which changes no order is reported as unchanged rather than not at all; and that an unmarked frame reports nothing.

## 3. The Record Names The Order

- [x] 3.1 Extend the `frame` kind with the order's identity and the state the exchange gave it, under the field rules that kind already enforces — the identity in the same shape the `command` and `answer` lines use, so a day can be read as one story.
- [x] 3.2 Keep the money rule intact: no size, no price, and not the filled fraction either. `PARTIALLY_FILLED` is what a partial fill needs to be legible in the record.
- [x] 3.3 Accept the report at the same place the market lane's is accepted — before the credential gate, answering nothing, refusing nothing — so an unconfigured or refused desk still records where its frames went.
- [x] 3.4 Prove by test that the new fields are written when they are well-formed, that a malformed one costs what the kind's rules say it costs and never half a line, and that a frame carrying a value it must not is refused.

## 4. A Day Can Be Read Without Grep

- [x] 4.1 Print the day's order frames in the record's own summary — time, contract, identity, state, whether the screen changed, and the legs — listed rather than aggregated, because there are tens of them and the operator reports a moment.
- [x] 4.2 Leave the market lane's aggregate exactly as it is; the two are read for different questions.
- [x] 4.3 Prove by test that a day holding both lanes prints both, and that a day holding neither prints neither.

## 5. Verification

- [x] 5.1 `OPENSPEC_TELEMETRY=0 openspec validate time-the-fill-to-the-screen --strict`. Valid.
- [x] 5.2 `npm run lint`, `npm test`, `npm run check:futures-production`, and the circular/command-path/runtime-mock checks that guard `binance-connection.js`.
      2026-08-18: lint clean; **2096 tests in 114 files, all passing**; boundary
      check passed (23 isolated files, exact public-read routes only); 266 source
      files with no cycle; production graph MOCK-free; one command builder.
      Two existing cases moved with the contract rather than being worked
      around: the market frame's record line now states `identity: null,
      status: null`, and a desk frame now always carries its arrival.
- [x] 5.3 Mutation-test the cases that matter, in a copy of the tree rather than in the one the operator's desk runs from: the marks not stamped on the account lane, the commit measured in the reducer instead of after it, the unchanged case reported as nothing, and the identity dropped. Each must kill its own test and no other.
      Five, each killing exactly what it should and nothing else. **M1** the
      account lane never stamped: the connection test alone. **M2** the commit
      read before the screen mark is updated — the ordering the whole
      measurement rests on: both hook tests that assert a frame *changed* the
      screen, and neither of the others. **M3** a frame that changed nothing not
      reported: the unchanged test alone. **M4** the order not named: the two
      tests that name it. **M5** the stamp taken by name alone: the position-mark
      collision above, killing its own new test and the pre-existing mark-feed
      case — which is the pair that proves the guard is about the desk and not
      about the test.

      Twelve cases were run against the tree before the change and twelve are
      red there. The thirteenth, `reports nothing for the frames that carry no
      marks`, passes there and is a **guard**, not a measurement: before this
      change nothing was ever reported, so it can only catch a later change that
      starts reporting frames it should not.
- [ ] 5.4 Measure one live fill end to end from the record after this lands, and write the numbers here — the legs, and whether the screen changed. This is the first answer the desk will have given to a question it has been asked twice.
      **Partial live evidence, still open after the 2026-08-18 re-audit.** Four
      identified private order reports and their paired account frames landed
      at 18:02:30–18:02:32 UTC. All four reports say `CANCELED` and `UNCHANGED`:
      exchange→desk 185–202 ms, desk→queue 0 ms, queue→renderer 0–1 ms and
      renderer→screen 9–11 ms (195–213 ms total). They prove on live Production
      traffic that the private stream reaches the renderer, is committed and is
      recorded with identity/status. They do not supply the `FILLED` or
      `PARTIALLY_FILLED` observation this task requires. The successful live
      place/cancel commands just before them and the focused 329-test pass are
      corroboration, not substitutes for a fill. Desk revision was not written
      into the diagnostic record and remains `NOT RECORDED`.
- [ ] 5.5 Operator check: none of its own. The whole point of this change is that the next report needs no operator to be asked what and where. Runbook step 41 and step 30's open follow-up are settled from the record once §5.4 has a fill in it.
      **Still open because 5.4 has no qualifying fill.** The live cancellation
      frames settle the private-stream/renderer seam but do not exercise the
      remaining-size/Total behaviour. Runbook step 41 and step 30's partial-fill
      Total follow-up therefore remain open.
