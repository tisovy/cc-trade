## 0. The base has moved

- [x] 0.1 Base re-read after `775b8a3` ("read realized PnL as evidence in
  edge-round gates") landed. The new gates do not touch what this change needs:
  they decide where a round *starts and ends*, while this changes what a finished
  round *reports*. Re-ran the reproductions against the committed fold, not
  against the pre-edit one. The peer confirmed the file is handed over.

## 1. Establish the ground truth

- [~] 1.1 Re-ran the arithmetic against the committed fold with my own driver,
  printing the whole round object. A round that bought 10 at 100 and sold 10 at
  112, paying 2 USDT commission each side and 7.1 USDT funding while held,
  reported `realizedPnl: 120` in the column — the exchange's gross — where the
  wallet moved `+108.90`. **Not** yet compared against a real position on the
  operator's own Binance screen: that is 4.5, and it is what settles 1.4.
- [x] 1.2 Confirmed. The row rendered `round.realizedPnl` and its title read
  "N realized less M in fees is K net" — so the desk already computed the net and
  showed the gross.
- [x] 1.3 Reproduced, and it is worse than a rounding error. A round paying
  0.004 + 0.0045 **BNB** reported `fee: 0.0085` and `netPnl: 119.9915` — a BNB
  quantity subtracted from a USDT result, so the row claimed the round cost less
  than a cent when the fee was about five USDT. The title stated `0.0085 in fees`
  with no unit at all. `commissionAsset` was carried end to end and never read.
- [ ] 1.4 Still open, and deliberately not blocking: both defects fixed here are
  wrong against *every* reading of the app — a BNB fee summed as USDT, and a
  gross shown where a net was computed — so no answer makes them correct. What
  the answer changes is whether funding belongs in the headline or beside it.
  Ask the operator which screen they compared (Position History / Trade History /
  wallet record) when 4.5 is run.
- [x] 1.5 Confirmed from Binance's OpenAPI: a `userTrades` fill carries
  `realizedPnl` and `commission` and no funding of any kind, and `/fapi/v1/income`
  is where `FUNDING_FEE` lives. Recorded in full under
  `state-what-an-open-position-has-already-paid` tasks 1.2, which also settles the
  sign convention and the absent `positionSide` this change depends on.
- [x] 1.6 Blast radius by grep: `netPnl`, `round.fee` and `round.realizedPnl`
  have exactly one production consumer between them —
  `FuturesHistoryPanel.jsx:400-442`. `buildFuturesTradeRounds` has two:
  that panel and `useFuturesTrading.js` (open-round starts, added by
  `state-what-an-open-position-has-already-paid`). The second reads only
  `open`/`partial`/`openTime`/`symbol`, none of which this change touches.

## 2. Spec

- [x] 2.1 Wrote the MODIFIED "Executions are reported as the positions they
  formed" carrying across every scenario the live spec still has, and verify the
  requirement name by grep.
- [x] 2.2 `OPENSPEC_TELEMETRY=0 openspec validate close-a-round-at-what-reached-the-wallet --strict` — valid. The delta was re-checked against the built spec after the peer archived ten changes into it (`548f375`): the requirement name still matches and all six live scenarios are carried across.

## 3. Code

- [x] 3.1 Accumulated commission per asset in the fold; keep the split fill's
  share arithmetic exactly as it is.
- [x] 3.2 Attributed funding and insurance clearance to a round from the income
  rows, matched on contract and the span between open and close — not on leg,
  which an income row does not state (see `state-what-an-open-position-has-already-paid`
  tasks 1.2). Boundary rule stated and tested: a charge stamped exactly at the
  close belongs to the round.
- [x] 3.3 Reported the round's result as realized less the fill record's unsigned
  commission plus the income record's already-signed funding and insurance
  clearance, keeping the pre-fee realized PnL and each component available. Prove
  the sign convention with a test that would pass if a fee were counted twice in
  one direction and fail in the other.
- [x] 3.4 `fundingComplete` carries it, and the cell takes the same dotted
  underline an estimated uPnL wears. A round folded with no income record at all
  defaults to `false` — nothing read is not the same as nothing charged.
- [x] 3.5 The cell states `netPnl` and the tone follows it, so a round that
  realized a profit and gave it all back in funding no longer reads as a winner.
  `roundResultTitle` decomposes it, naming each component for the record it came
  from.

## 4. Proof

- [x] 4.1 Every new test bites. Copied into a clean tree at HEAD, 14 of them fail
  against the shipped fold and panel — the eight new `attachFuturesRoundIncome`
  tests, the three panel tests for funding / BNB / an uncovered window, and the
  three existing panel assertions that encoded the gross (`+234.00` → `+233.94`,
  `+190.00` → `+184.00`, `−96.74` → `−96.76`). Those three are the change stated
  as a diff: the column used to show what the exchange settled before its own
  fees, and now shows what reached the wallet.
- [x] 4.2 Fold tests: an already-negative income row added rather than
  subtracted, charges outside the round's span excluded, charges at exactly the
  open and exactly the close included, insurance clearance carried apart from
  funding, a read beginning after the round opened reported uncovered, a round
  folded with no income record reported uncovered, a BNB commission kept out of
  the USDT result, and a charge landing on the edge two rounds share stated as
  the contract's on both.
- [x] 4.3 Panel tests: the cell states the result, the title decomposes it into
  realized / commission / funding / insurance and names the wallet, the
  incomplete-funding qualification and its underline appear only when they apply,
  and a BNB fee is stated in BNB with "not included".
- [x] 4.4 `npx vitest run` — 2227/2227 across 116 files. `npx eslint` clean on the
  six touched files.
- [x] 4.5 Operator re-checks one closed position against the Binance app and
  confirms the figures now agree — **naming the screen**, which also settles 1.4.
  Record in `openspec/live-verification-ledger.md`. Confirmed 2026-08-25 with a
  finding: the app's headline is the NET (matches the desk's net on the
  element), so the desk's gross PnL column is a different quantity by design —
  ledger, The 2026-08-25 Operator Runbook Pass. Screen name still owed to 1.4.
- [x] 4.6 Operator confirms a round held across a funding boundary now shows the
  funding component. The `FUNDING_FEE` read path cannot be exercised from this
  tree. Confirmed 2026-08-30: funding crossed with positions open, the
  operator reported the funding present and everything displaying as needed;
  journal holds the `funding` → `confirm` pass pair at each of the day's
  three boundaries. Recorded in `openspec/live-verification-ledger.md`,
  The 2026-08-30 Operator Sitting.

## 5. Guards, not regressions

Named per `tests-must-bite`: passes against the pre-change fold and is kept as a
guard.

- `treats an unnamed commission asset as the settlement asset` — the old code
  summed every commission regardless of asset, so it got this case right by
  accident.

## 6. Corrected while implementing

- The spec's hedge-leg scenario described a situation this fold cannot produce.
  Exposure is folded **per contract**, not per leg, so a hedge account's two legs
  net into one exposure and a contract's rounds are consecutive rather than
  overlapping. Found by running the fold on a two-leg fixture and getting three
  sequential rounds instead of two concurrent ones. The rule that mattered — a
  charge is never divided per leg, because the record states no leg — is
  unchanged and still load-bearing; the scenario now describes the case that can
  actually arise, a charge stamped on the edge two consecutive rounds share.
- `attachFuturesRoundIncome` first returned a round untouched when it had no
  charge and full coverage, which left it carrying the "nothing read" default and
  reported a covered round as uncovered. Caught by its own test.

## 6b. Third instance of the same confusion, caught by review

- [x] 6b.1 The peer auditing the 2026-08-19 series asked me to *confirm* that a
  `partial` round reports `fundingComplete: false`. Ran it instead of answering,
  and it did not: coverage was `from <= round.openTime` alone, so a round whose
  first fill reduced a position older than the window reported itself covered
  whenever the income read began before that fill. Measured, one round, three
  windows:

  ```
  incomeFrom= 500 | partial=true openTime=1000 fundingComplete=true   <- wrong
  incomeFrom= 100 | partial=true openTime=1000 fundingComplete=true   <- wrong
  incomeFrom=3000 | partial=true openTime=1000 fundingComplete=false
  ```

  Same mistake as reading `entryImplied` for coverage in
  `readFuturesOpenPositionStarts`, made a second time in a second file: a
  `partial` round's `openTime` is the window's edge, not the position's entry, so
  comparing a read's reach against it answers a question about the window.
- [x] 6b.2 Fixed — `partial` disqualifies a round from coverage outright,
  whatever the window says. The charges *inside* the window are still counted:
  dropping them would understate the round as surely as claiming coverage
  overstates it. Test fails against the previous commit.
- **Worth carrying:** two of the three defects in this series were the same
  confusion between "what the window covers" and "what the position did", and
  neither was caught by a test I wrote for it — one by a peer's message, one by a
  peer's question. Any new flag on a round wants the question asked explicitly:
  is this about the data in hand, or about the position?

## 6c. Operator check 2026-08-20: the closed rows still disagreed

Reported figures, desk against the Binance app:

| Contract | Row | Desk | App | App − Desk |
|---|---|---:|---:|---:|
| BTWUSDT | 1st | 605.72 | 605.71 | −0.01 |
| BTWUSDT | 2nd | 1280.83 | 1337.39 | **+56.56** |
| CYSUSDT | 1st | 185.21 | 185.20 | −0.01 |
| CYSUSDT | 2nd | 1755.93 | 1757.57 | **+1.64** |

- [x] 6c.1 **These rows were computed with no funding at all**, for the same
  reason the `PnL` column was blank: the income rows never survived the wire (see
  `state-what-an-open-position-has-already-paid` 5d). So what the operator
  compared was `realized − commission` against the app's `realized − commission +
  funding`, and the gap on each row is that round's funding.
- [x] 6c.2 That makes a falsifiable prediction rather than an explanation after
  the fact. `funding = app − desk`, so after the fix each row's tooltip should
  state:

  | Contract | Row | Predicted funding |
  |---|---|---:|
  | BTWUSDT | 1st | −0.01 |
  | BTWUSDT | 2nd | **+56.56** (received, not paid) |
  | CYSUSDT | 1st | −0.01 |
  | CYSUSDT | 2nd | **+1.64** (received) |

  The signs are not a problem: funding is paid or received depending on the leg
  and the rate, and a short in a positive-funding market receives it. The two
  −0.01 rows may equally be rounding rather than a real charge; what matters is
  that the two large gaps are funding, and the tooltip now names the figure.
- [x] 6c.3 (confirmed 2026-08-25 — rows agree against the net; see 4.5) Operator re-checks the same four rows. **If the two large gaps close
  and the tooltip's funding matches the prediction, this is done.** If a gap
  remains, the tooltip decomposes the row into realized / commission / funding —
  report those three numbers for the disagreeing row and the remaining cause is
  arithmetic rather than guesswork. This also settles open task 1.4, since the
  screen being compared is the one whose numbers are in the table above.

## 7. Carried forward

- **`round.fee` narrowed, and an external checker will weaken silently rather
  than fail.** It used to be every commission summed regardless of currency; it
  is now only the commission charged in the settlement asset, with the full
  picture in `round.feesByAsset` (`[{asset, amount}]`). The session auditing the
  2026-08-19 series flagged that its round fuzzer
  (`scratchpad audit2/rounds/fuzz*.mjs`, not in the repo) checks fee conservation
  by summing `round.fee`. That check still passes on USDT-only fixtures and
  quietly stops covering anything the moment a fixture pays in BNB — it will not
  go red, it will go blind. Whoever picks that tool up should sum `feesByAsset`.
  Recorded here rather than sent, because that session had already closed by the
  time this was found.

- Funding is attributed on the contract and the span, which is all the income
  record supports. The `tradeId` → fill join that would attribute realized PnL
  and commission per leg is written into
  `state-what-an-open-position-has-already-paid`'s spec and is still not in the
  code; nothing on either surface needs it yet, because both key by contract.

## 7. Operator's screenshots 2026-08-20: the cause is proven, and one more defect

- [x] 7.1 The operator answered "if you don't believe me, look" with the desk's
  Closed Positions beside the Binance app's Position History. They did more than
  confirm the report — they closed the arithmetic. Gross from the app's own
  averages, times converted from MSK to UTC:

  | Round | Gross | Desk | App | App − desk | Funding boundary |
  |---|---:|---:|---:|---:|---|
  | BTWUSDT short, 14 min | 622.06 | 605.72 | 605.71 | −0.01 | none |
  | BTWUSDT short, 4 h 19 min | 1405.13 | 1280.83 | 1337.59 | **+56.76** | one, 08:00 UTC |
  | CYSUSDT long, 16 min | 187.67 | 185.21 | 185.20 | −0.01 | none |
  | CYSUSDT long | — | 1755.93 | 1757.57 | **+1.64** | open time off-screen |

  Every round that crossed a funding settlement is short by a funding-sized
  amount; every round that crossed none agrees to a cent. Row 2 closes exactly:
  `1405.13 − 124.30 + 56.76 = 1337.59`.
- [x] 7.2 **Task 1.4 is settled by this.** The desk's definition of a round's
  result and the app's "Реализ. PnL" agree — both are realized net of commission
  and funding — so there is no definitional gap. The desk is missing funding and
  nothing else, which is the same root as the empty column in
  `state-what-an-open-position-has-already-paid`: income rows are not reaching
  the renderer.
- [x] 7.3 The earlier prediction is corrected, not overturned: the second
  BTWUSDT row is **1 337,59** in the app, not the 1337.39 first reported, so its
  funding is **+56.76** received rather than +56.56. CYSUSDT's **+1.64** stands.
  The two one-cent differences are rounding between two independent computations,
  not a defect — those rounds have no funding to be missing.
- [x] 7.4 A defect the screenshots exposed on their own. All four rows qualified
  as "funding not covered" and all four were drawn as plain whole figures.
  `is-partial` is set on the round result cell, but the only rule in the
  stylesheet was `.futures-workstation-dock-settled.is-partial` — the settled
  column's — and this cell is `.futures-workstation-dock-pnl`. The class matched
  nothing, so a figure the desk knew was incomplete looked exactly like one that
  was whole, for the entire time the operator was reconciling against Binance.
  Given the rule it was always meant to have, marked like the estimated uPnL the
  operator already reads as qualified.
- [x] 7.5 Why the tests did not catch it, and what now does. Two tests assert
  `is-partial` is on the cell and pass — they assert the class, never that it
  renders as anything. The guard that requires every rendered class to have a
  rule reads static `className="..."` and templates without interpolation, so
  the conditional modifiers spliced in by `${cond ? ' is-x' : ''}` were never in
  its sample. Added a guard that pairs each conditional modifier with the class
  it is spliced onto and requires `.base.modifier` in the stylesheet; it fails
  against the previous commit.

## 8. The column the app was compared against

- [x] 8.1 With the income rows finally reaching the renderer (the collision fixed
  in `read-the-settled-money-from-the-newest-end` §11), the closed rows carry
  their funding. What was left of the third complaint is not a number at all:
  the column was headed **Realized PnL** and held `netPnl`. The Binance app
  prints a column of that name too, and prints the exchange's own figure under
  it — Binance staff state plainly that the `income` amount "has not deducted the
  fee yet". So the operator compared two columns with the same name holding two
  different measurements, and every row disagreed by exactly the commission and
  funding. Nothing on the row said the names meant different things.
- [x] 8.2 Two columns now, because there are two figures. **Realized** is the
  exchange's own: the sum of the realized PnL Binance reported on this round's
  fills, unadjusted, unqualified, and directly comparable against the app.
  **Net** is what the round left in the wallet — that figure less the commission,
  plus the funding — and keeps the full decomposition on the element. The net
  keeps the emphasis, because it is the one the operator asked for; the gross
  keeps its own tone, because a round that realized a profit and gave it all back
  in funding is a different row from one that realized nothing.
- [x] 8.3 The qualification stays on the result alone. A result missing funding
  the read did not reach is marked; the exchange's realized PnL is not, because
  no funding was ever part of it and marking it would qualify a figure that
  needs none.
- [x] 8.4 Measured rather than assumed to fit. Eight tracks against the seven
  before: 600px at their narrowest plus gaps is 656px, against the 796px the
  positions row above already asks for, so the rounds row is still the narrower
  of the two. Checked in Chromium over a fixture at 640, 720, 796, 880, 1040 and
  1280px: no cell clips its own content at any of them.
- [x] 8.5 The tests bite. Five existing assertions moved from cell 6 to cell 7
  and gained a cell-6 assertion for the exchange's own figure; against the
  previous commit all five fail, because there is no cell 7.

