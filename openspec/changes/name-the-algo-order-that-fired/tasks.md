## 0. Measured First

The beat this change replaces, and the path it replaces it with, measured before
anything was built.

- **The beat is real, and it is 30.0s.** Gaps between consecutive account reads
  in the desk's own diagnostics journal (`~/.config/cc-trade/diagnostics/desk-2026-08-13-000.jsonl`,
  n=127): median 30.0s, and 108 of them fall in 20–45s with median 30.0s. A stop
  that fires is stated at the next one, so the delay is uniform over that gap:
  mean 15.0s, worst 30.0s. The operator's reported "ten to fifteen seconds" sits
  where the mean predicts.
- **The stream leg is 0.35s.** Exchange event time → desk receive, measured over
  the desk's own proxy and socket transport (`wss://fstream.binance.com/market/stream`,
  BTCUSDT aggTrade, n=200, clock skew corrected against `/fapi/v1/time`):
  p50 345ms, p90 347ms, p99 351ms, max 362ms. Skew estimate carries roughly
  ±50ms, so read this as "a third of a second", not as three significant digits.
- **So the replacement is worth building**: ~15s mean → ~0.35s, a factor of ~43;
  ~30s worst → ~0.35s, a factor of ~85.
- The one leg no offline measurement covers is exchange-side: how long Binance
  takes between firing an algo and emitting the spawned order's report. That is
  what 4.3 puts in front of the operator.

## 1. The Parent Names The Order It Spawned

- [x] 1.1 Carry `actualOrderId` and `actualPrice` through `normalizeFuturesAlgoOrder` onto the normalized algorithmic order.
- [x] 1.2 Treat the exchange's documented empty string as "has not fired" rather than coercing it to a null or a zero, matching how the repository's reference states the contract.
- [x] 1.3 Keep the existing overrides intact — `algoId`, `clientAlgoId`, `triggerPrice`, `closePosition`, `workingType`, `priceProtect`, `algoType` — and keep the two identity namespaces distinct.
- [x] 1.4 Prove by test that an algo that has fired carries the spawned order's identity, and that one that has not carries the exchange's empty value unchanged.

## 2. A Fired Order Does Not Read As Resting

- [x] 2.1 Derive a triggered state for an algorithmic order that names a spawned order, and present it as triggered and awaiting confirmation wherever a working order is drawn — the chart marker, the working-orders list, and the portfolio dock.
- [x] 2.2 Withhold the controls that only apply to a working order from a triggered parent, so the operator cannot move or reprice something the exchange has already acted on.
- [x] 2.3 Keep cancel available where the exchange still accepts it, and state plainly when it does not.
- [x] 2.4 Prove by test that a triggered parent is not drawn as a working marker at its trigger price, and that the controls it offers match what the exchange will accept.

`describeFuturesAlgoTrigger` (`src/utils/futuresOrderPresentation.js`) is the one
place that answers "has this fired, and into what", and all four surfaces read it:
the chart marker, the dock row, the rail's working-orders row, and the projection
that places the marker on the chart.

2.3 turned out to be a statement, not a control: the desk never offered cancel on
an algorithmic order at all — it lists and cancels them on Binance — so there was
nothing to keep available. What the surfaces now do is say which of the two
absences it is, "on Binance" for one still resting and "fired" for one that has
gone, with the reason in the title rather than left as an unexplained gap.

A fired parent is also **priced where it fired** rather than at its trigger, on
all four surfaces, with the trigger it was placed against kept on hover. The
marker's position moves with it, so no two surfaces price one order differently.

The pre-commit audit found a fifth surface the proposal did not name: the order
book marks the levels the operator's own working orders rest at
(`ownBookLevels`, `FuturesWorkstationView.jsx`). A fired parent is not resting at
any level — the exchange replaced it with the order it spawned — so it no longer
marks one. An algorithmic order that has not fired still does, exactly as before.

Left alone, deliberately, and why: the rail's "On order" total, the working-order
counts, and `holdsWorkingOrder` in `futuresContractDefaults.js` all still count a
fired parent. The row is still listed until the exchange drops it, so a total
that disagreed with the list above it would be its own defect; and the margin
mode is refused by Binance while the parent is listed, so counting it there is
the answer that matches the exchange.

## 3. An Execution Resolves The Parent That Spawned It

- [x] 3.1 Match an incoming execution report against the spawned identities of the listed algorithmic orders.
- [x] 3.2 On a match, resolve that parent from the information the report carries rather than waiting for the beat, and read the algorithmic orders once for that match alone.
- [x] 3.3 Keep the prohibition otherwise: an execution report that matches no listed parent, and a position change, still read nothing.
- [x] 3.4 Keep the read deduplicated and inside the read budget, so a burst of fills against one parent is one read.
- [x] 3.5 Prove by test that a fill on a spawned order resolves its parent promptly, and that a fill unrelated to any listed algorithmic order issues no read.
- [x] 3.6 Prove by test that a parent whose spawned order is cancelled rather than filled is resolved the same way.

The match is keyed by contract as well as by id: Binance numbers orders per
symbol, so matching on the number alone would take a live stop off the screen
because something unrelated filled on another contract. The parent is resolved by
the same settled-order memory every other order uses, so the eventually-consistent
algo snapshot cannot put it back.

Read budget: one extra account read (weight 90) per algo trigger, against a
2400/minute IP allowance — 3.75% of one minute's budget for an event that happens
a handful of times a session. The journal for 2026-08-13 shows 127 reads over
about seven hours, so this is not the term that matters. The read goes out as the
renderer's `account.refresh`, which the diagnostic record already names `refresh`.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1786 passed, 109 files), `npm run check:futures-production`.
- [x] 4.2 Measured in §0: 30.0s beat (mean 15.0s of delay) replaced by a 345ms stream leg. Recorded before the code was written.
- [ ] 4.3 Operator confirms on live data that a stop which fires stops being drawn as a working order within the stream's own latency, and that the position it opened or closed is stated correctly.
  → handed to `verify-the-desk-in-one-sitting/runbook.md`, section
  "Дописано 2026-08-13: сработавший ALGO перестаёт быть рабочим ордером"
  (4 steps), and listed in that change's task 3.2.

## 5. Do The Tests Bite?

Every new test was run against the tree before this change (`git archive HEAD`,
symlinked `node_modules`). 17 tests added; 12 fail on the old code for the
behaviour they describe, 5 do not and are named for what they are.

Bites — fails on the old code because the old code has the defect:

- adapter: carries the spawned order's identity, and the empty value when it has not
- dock: states an algo order that has fired rather than listing it as working
- rail: states a fired algo in the working-orders list instead of listing it as working
- chart: draws an algo that has fired as triggered rather than as working at its trigger
- workstation: draws an algo that has fired at the price it fired at, not at its trigger
- book: marks no level for an algorithmic parent that has already fired
- hook: takes the parent off the desk on the fill, and reads once for the match
- hook: answers a burst of fills on one spawned order with one read
- hook: resolves a parent whose spawned order was cancelled the same way
- hook: does not resolve a parent from the same order id on another contract —
  bites against the first version of this change's own code, which keyed the
  match by order id alone. Found by the pre-commit audit, not by the tests.

Guards — pass on the old code, and are here to keep passing:

- dock: leaves an algo order that has not fired reading as working
- book: still marks the level of an algorithmic parent that has not fired
- hook: reads nothing for a fill that no listed parent spawned. This is the
  prohibition `carry-execution-ahead-of-market-data` and its neighbours were
  built to establish; the exception added here is the one thing that may pierce
  it, so the guard is the point rather than a finding.

Contract tests, not regression catchers — the four `describeFuturesAlgoTrigger`
unit tests fail on the old tree only because the function does not exist there
(`TypeError: ... is not a function`). They pin the empty-string contract, the
absent-field case, the `'0'`-versus-empty distinction and the two namespaces, so
they are worth keeping; they are not evidence of a defect found.
