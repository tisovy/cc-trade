# Tasks

## 1. Ground truth

- [x] 1.1 The cause is measured, not inferred. The `settled` record written on
  2026-08-20 reports `pages:4 rows:4000 kept:4000 contracts:5 outcome:partial`
  on every pass — the budget is exhausted, all four thousand rows are kept, and
  only five contracts appear. The read fires, the exchange answers, the frame
  reaches a renderer. What is wrong is *which* rows.
- [x] 1.2 Ordering confirmed from this codebase's own documented understanding of
  the same endpoint, in `collectFuturesHistorySymbols`: *"Walked from the oldest
  end of the range to the newest. Each full page means there is another numbered
  page behind it; the pages are then read back to front."* And the lesson, twenty
  lines further on: *"Today first, and the rest of the week only if there is still
  room. A page budget spent on the far end of the window is how a review of this
  session came back covering none of it."*
- [x] 1.3 Corroborated against the operator's own screens. Four closed rounds
  from 18–19.08 carry no funding at all, and the gap on each is exactly the
  funding of the settlements it crossed. Those rows are behind page four.
- [x] 1.4 Second defect found while reading the first: `from` is broadcast as the
  requested window, so `from <= openTime` reports a round the read never reached
  as fully covered. Every figure on screen was therefore presented as whole.

## 2. Spec

- [x] 2.1 One ADDED requirement covering read direction, full-page handling,
  stated coverage, and retention across passes.
- [x] 2.2 `openspec validate read-the-settled-money-from-the-newest-end --strict`.

## 3. Code — the read

- [x] 3.1 Accumulate income rows in the main process, keyed by `incomeType` +
  `tranId`, pruned to the window.
- [x] 3.2 Forward tail: read `[coveredTo, now]` first, continuing forward while
  pages come back full. Overlap at the boundary instant rather than advancing
  past it — a row sharing that millisecond is otherwise skipped — and let the
  dedup key absorb the repeat.
- [x] 3.3 Backward fill: walk from the oldest covered instant towards the window
  start in adaptive slices. A full page is kept and the rest of its slice read
  forward from it; the slice is claimed only once a page comes back short. See
  §7 — the first version discarded those pages and cost the operator six and a
  half minutes of wrong figures after every start.
- [x] 3.4 Broadcast the held rows with `from` = oldest covered instant and
  `complete` = whether that reaches the window start. Broadcast only when the
  rows or the coverage moved.
- [x] 3.5 Record the pass: requests spent, rows held, contracts, coverage.

## 4. Code — the fold

- [x] 4.1 `foldFuturesSettledMoney` takes the read's coverage and reports a
  contract complete only when the coverage reaches its position's start.
- [x] 4.2 The hook passes it.

## 5. Proof

- [x] 5.1 Tests that bite against the previous commit.
- [ ] 5.2 Operator sees the four rows agree with the Binance app.

## 6. What the work found on the way

- [x] 6.1 The walk was extracted to `electron/services/futures-settled-income-walk.js`.
  The defect was in the walk, and a walk inside a websocket service is not
  something a test can drive — which is why it shipped, and why two commits were
  spent on causes that were not it. It now takes a `readPage` and returns state.
- [x] 6.2 Its own test caught a defect in the fix. Six hours doubling to a
  ceiling of one day reaches 6.75 days in eight requests, so a *quiet* week stayed
  one pass short of complete forever — on an account that could have been covered
  in six requests. Ceiling raised to two days; a slice too wide for the account it
  meets comes back full and is narrowed, so it costs nothing where it does not fit.
- [x] 6.3 A probe of the fold found the sharper one. `toFiniteNumber(null)` is
  `0` because `Number(null)` is `0`, and a coverage of zero is the epoch — so a
  read that stated no coverage at all reported **every** position as fully
  covered. That is the same failure this change exists to remove, reintroduced
  through a default argument. The absence is now kept as an absence.
- [x] 6.4 Two existing fold tests asserted `complete: true` while passing no
  coverage. They passed before because of 6.3 and would have kept passing after
  it. Both now state the coverage they mean.

## 7. Second round — 2026-08-20, after the operator restarted

The fix above was right about direction and wrong about cost. On the operator's
own desk it read the window correctly and took **6 minutes 40 seconds** to
finish, and they were looking at the screen for the whole of it.

- [x] 7.1 Measured, not inferred. The `settled` line across one live start:
  `pages=8 rows=485 covered=1.19d` … `pages=8 rows=10391 covered=6.12d` …
  `pages=6 rows=13331 covered=7.00d complete`. Thirteen passes, about a hundred
  requests — for 13331 rows, which is **fourteen pages of rows**. Four requests
  in five bought nothing.
- [x] 7.2 Cause: a full page was treated as a refusal. The slice was quartered
  and re-asked, and the thousand rows just paid for were thrown away. Compounded
  by the slice width being re-derived from the six-hour constant on every pass,
  so each pass re-learned what the last one had already measured.
- [x] 7.3 A full page is not a refusal — it is the oldest thousand rows of the
  chunk, so it covers that chunk's start up to its own newest row. The rest is
  read forward from there. Nothing is discarded, no range is asked twice, and the
  chunk is claimed only when a page comes back short.
- [x] 7.4 The measured width of one page is carried between passes, and a chunk
  far too wide to finish is abandoned after **one** page rather than five.
- [x] 7.5 Measured against the previous implementation on four densities. The
  operator's shape (16.8k rows, bursty): **8 passes / 59 requests → 4 passes / 31
  requests**. A week at a row a minute, single pass, budget 20: the old walk
  spends 24 requests and is still incomplete holding 8641 of 10080 rows; the new
  one completes in **14**. Quiet account unchanged at 4 requests.
- [x] 7.6 Tests bite against the previous implementation: the dense-week request
  count and the carried width both fail on it. The contiguity test passes on both
  and is named as a guard, not a catch.

## 8. The figure beside the open position

- [x] 8.1 The operator read `-34.7` against an open position and called it a lie.
  Driven through the fold rather than read: with **no** known start for the
  position, every amount the contract settled anywhere in the read's window was
  summed — a round closed three days earlier for +900 and one closed two days
  earlier for -900 both land in the figure beside a position opened that morning.
  The probe prints `-74.7` where the position's own money is `-34.7`.
- [x] 8.2 That is not a partial answer to the question the column asks; it is a
  whole answer to a different one, and `complete: false` does not make it true.
  The fold now attributes nothing to a contract whose position start is unknown.
- [x] 8.3 The dock states the absence and its reason — the fills read does not
  reach back to when the position was opened — apart from "this position has
  settled nothing", which is the same dash for a different fact.
- [x] 8.4 Root cause of the absence is upstream and **not fixed here**: the desk
  reads the most recent 1000 fills per contract, and on a contract traded harder
  than that within the window an open position's opening is behind them. A
  backward fills walk is the fix, and it is the same shape as the income walk in
  §7. Until then the column refuses rather than guesses.

## 10. Third round — what the wire said

- [x] 10.1 The one assumption the whole backward walk rests on — that
  `/fapi/v1/income` answers oldest-first, so a full page is the *oldest* thousand
  rows of the range — is **stated nowhere in Binance's documentation**. Read the
  endpoint reference in full: weight 30, `page`, `limit` max 1000 default 100,
  single-enum `incomeType`, `tranId` unique within one type, three months of
  reach. Ordering: absent.
- [x] 10.2 So it is measured instead of assumed. The `settled` record now carries
  `order`, read off the first page of each pass that carries two rows. On the
  operator's own account, live: **`order":"ascending"`**. The walk's direction is
  correct, and it is no longer a belief.
- [x] 10.3 A defect the live journal showed and no simulation could: two passes
  ran **concurrently**. The debounce coalesces scheduling, not running; a pass
  takes seconds through the rate limiter, and the stream and the refresh land
  within a few seconds of each other all day. Both walked from the same held
  state and both wrote it back, so the second to finish overwrote the first with
  a reading built from the older state. Coverage measurably went backwards —
  `covered=136809478` at 15:32:56 to `covered=130692102` at 15:32:59 — while both
  passes spent a full eight-request budget.
- [x] 10.4 One pass at a time, and the ask that arrives during a pass runs after
  it. Live after the fix: coverage rose monotonically 468M → 508M → 511M → 532M →
  604800000 ms and reached `complete`, with no backward step.
- [x] 10.5 `scripts/probe-futures-settled.mjs` — a read-only probe that asks
  Binance directly what an open position and its contract have settled, run from
  the shell that holds the credentials. Added because the desk's own arithmetic
  can no longer be checked against the desk's own arithmetic.

## 11. The cause of every symptom in this change

Three commits were spent on the read's direction, its cost and its scoping, and
all three were real defects. None of them was the one the operator kept seeing.

- [x] 11.1 The operator's own probe against Binance, on the open position:
  `funding -237.0433 | commission -33.4508 | SETTLED TOTAL -270.4941`. The desk
  printed `-33.45`. Not approximately the commission — **exactly** it. The
  funding was not wrong, it was absent.
- [x] 11.2 The fold was cleared by running it: given those twenty funding
  charges and the commission, `foldFuturesSettledMoney` answers `-270.494`. So
  the arithmetic was never the defect and the rows never arrived.
- [x] 11.3 Instrumented rather than guessed: `settled` now carries
  `fundingRows`, the count of held rows that are funding charges. Live on the
  operator's desk: **`rows:2831, fundingRows:1`**. Out of a day and a half of an
  account holding an open position across four-hourly settlements, the desk held
  one funding charge.
- [x] 11.4 One survivor out of many is a key collision, and the key was
  `` `${incomeType}:${tranId}` ``. The surviving row's `incomeType` was correct,
  so the collision was on `tranId` — which the adapter refuses when it is not a
  safe integer, because a `tranId` past 2^53 has lost digits before `JSON.parse`
  returns it and paging from a rounded identity asks for a row that does not
  exist. Every funding row therefore keyed to `FUNDING_FEE:`, and a `Map` keeps
  one value per key.
- [x] 11.5 A row the exchange named is keyed by that name; a row it did not is
  keyed by what it is — contract, kind, instant, amount. Applied in both places
  that key income rows. `readFuturesSettledIncome` had the opposite half of the
  same bug: it skipped deduplication entirely for rows without an identity, so a
  page boundary inside one millisecond counted a charge twice.
- [x] 11.6 Live, after the fix: `fundingRows` 1 → 22 → 40 → 41 → **45**, and the
  pass that reached `complete` holds **13330** rows — exactly the count the
  operator's probe read from Binance for the same window.
- [x] 11.7 And this is why Closed Positions never moved either. Every round's
  funding comes from these same rows; with one funding row in the whole frame,
  no round could be attached anything. One cause under both symptoms.
- [x] 11.8 The test bites: keyed the old way, four distinct funding charges
  collapse to one.

## 12. The same collision on the rows there are thousands of

- [x] 12.1 The natural key written in §11 was contract, kind, instant and amount.
  That is enough for funding — a contract is charged once per settlement — and
  not enough for commission, which is charged on every fill. An account working
  one contract fills the same size at the same price more than once in a
  millisecond, and those two rows are identical in all four fields. The second
  charge then reads as the first handed back twice and is dropped.
- [x] 12.2 Scale, so it is not filed as a curiosity: the operator's account
  produced **13 330** income rows in seven days across nine contracts, of which
  **45** are funding. Everything else is per-fill, which is where this bites.
- [x] 12.3 The fill is now in the key: `tradeId`, which the exchange states on
  every row it charged against a fill, which is numbered per contract and so
  survives being parsed. Two charges on two fills are two rows; the same fill
  handed back twice is still one charge.
- [x] 12.4 Both key functions again — the walk's and the renderer's — because
  they are the same key in two places and only ever wrong together.
- [x] 12.5 The tests bite. Three commission rows in one millisecond, same amount,
  no usable `tranId`: with the previous key the reading holds **one** of them.
- [x] 12.6 Not yet measured on the wire. The probe now counts, inside single
  pages where every row is a distinct charge the exchange made, how many rows
  each of the three keys collapses. Pages overlap by design, so the count is
  taken within a page and never across one.

## 9. Still open

- [ ] 9.1 Operator sees the four closed rows agree with the Binance app.
- [x] 9.2 Settled, and not by a third crossing. The ledger's own table closes it:
  both one-cent rows are rounds that crossed **no** funding settlement, so there
  was no funding to be missing from either, and the two figures are two
  independent roundings of the same number. `close-a-round-at-what-reached-the-wallet`
  §7.3 records the same reading. Not a defect and nothing to chase.
- [ ] 9.3 §8.4: the backward fills walk. Deliberately not done, and here is the
  cost of doing it. The desk reads the most recent thousand fills per contract,
  so on a contract traded harder than that within the window an open position's
  opening is out of reach and the settled column states no figure rather than
  the contract's. That is the correct answer to give, and it is not the wrong
  number the operator reported — on their own account BEATUSDT's opening is 296
  fills back and well inside the read. A backward walk would cost another read
  per contract per pass at weight 5, against a settled read that already costs
  weight 30 a pass, and it would buy coverage only on contracts this account does
  not currently trade that hard. Worth doing when a position's column actually
  goes blank; not worth the weight before then.
- [x] 9.4 The row key's second collision is fixed but not yet measured on the
  wire. The probe counts, inside single pages, how many rows each candidate key
  collapses; one run says whether commission rows on this account were colliding
  at all. See §12. **Measured 2026-08-24**: the operator's probe run reports
  `identity conflicts: 0, invalid inputs: 0` over 77 canonical income rows and
  a 3539-row discovery read — no key on this account's window collapses two
  distinct charges. Recorded in `openspec/live-verification-ledger.md`.
