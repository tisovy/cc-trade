## 1. Gathering The Evidence

*Read on 2026-08-14, the day the comparison landed (`3452f2d`, 12:24), from the
operator's own journal after the desk ran that evening. The window has **not
started**, and one of the two reasons is a defect rather than a wait:*

```
notional            passes 0/11   unavailable  0
initial-margin      passes 0/11   unavailable  0
maintenance-margin  passes 0/11   unavailable  0
liquidation-price   passes 0/11   unavailable  0
free-margin         passes 0/23   unavailable 23 passes / 23 rows (23 wholly)
```

*The four position values compared nothing because the account held no position
all session — the operator placed and cancelled orders without opening one. That
is a wait, not a fault.*

*Free margin is a fault, and reading the code says it is structural rather than
occasional. It needs no position, only the wallet, and it failed on **every one
of twenty-three passes**. The gate is `futures-account-margin.js:340` —
`!incomplete && crossWallet !== null && orderMargin !== null` — and the operator
held working orders throughout, so the suspect is `orderMargin`.*

*`restingOrderInitialMargin` is all-or-nothing across the **whole account**: one
resting order whose contract has no leverage bracket returns null for the sum,
and the sum is free margin. Brackets are loaded per symbol and only when that
symbol's config is read on demand — `binance-connection.js:1183`, inside the
read a contract gets when the operator opens the ticket on it. But the order list
is account-wide. That evening the operator had working orders on TUTUSDT,
BTWUSDT, ACEUSDT and AKEUSDT while looking at one contract at a time, so the set
of contracts with orders and the set with brackets loaded could not coincide —
and free margin is unavailable whenever they do not.*

*Which is why it is 23 of 23 rather than sometimes: an account that trades more
than one contract structurally cannot compute it. Not verified against a running
desk — the record states that a pass failed and not why, which is the second
finding below. Left to the session that owns that change; reported to it the same
day, and the report is held for that session's operator to approve.*

*Why it is worth writing here rather than only there: the bar below asks for
**zero passes the desk could not compute**. While free margin is never
computable the bar cannot be cleared however long the window runs — and the
window is ten trading days against a record that keeps fourteen. Without this
note the operator sits out two weeks and then finds an empty record, which is the
exact failure the bar was written early to prevent.*

*Fixed on 2026-08-15. `1c07bba` reads the contract configuration — and with it
the leverage bracket — for every contract the account has an order resting on,
not only for the ones it holds a position in; `bec36ca` then makes that read
happen once per account pass instead of once per list the pass reads. The
structural reason free margin could not be computed is gone.*

*So the window's clock starts here, and no earlier. Every record written before
2026-08-15 carries free margin unavailable by construction and cannot count
toward the ten days — including the evening of 2026-08-14 measured above. An
operator counting from the day the comparison landed would reach day ten with
nine days of nothing in them.*

*What is fixed is proven by test, not on live data: the desk now reads the
leverage of a contract it only has an order on. Whether free margin actually
computes is the first thing the record will say, and it is worth reading on the
window's **first** day rather than its last — the same argument as the note
above, one blocker later. If it is still unavailable on day one, the cause is a
different one and the window should stop until it is found.*

### Day one: still 0, and the cause is a third input

*Read 2026-08-15 from the operator's own journal, the desk having run from 11:54
on the fixed build:*

```
free-margin         passes 0/68   agreed 0   unavailable 68/68 (68 wholly)
notional            passes 41/58  agreed 40  worst 5 bps
initial-margin      passes 41/58  agreed 40  worst 5 bps
maintenance-margin  passes 41/58  agreed 40  worst 5 bps
liquidation-price   passes 41/58  agreed 41  worst 0 bps
```

*So the window has still not started, and the note above was wrong where it said
the structural reason was gone. It named one reason and fixed it. There were
three, and the fix covered two.*

*A resting order is priced from three held things: the contract's leverage, its
bracket table, and its **mark**. `1c07bba` widened the first two to contracts the
account only has an order on. The mark comes from somewhere else entirely — the
mark-price feed, tracked by `readFuturesPositionSymbols`, which skips any row
whose quantity is zero. A contract with an order and no position has no mark, and
`restingOrderInitialMargin` refuses without one; the sum is all-or-nothing, so one
such order is the whole account's free margin.*

*And an entry order **is** an order on a contract with no position. That is not
an edge of the account shape, it is the ordinary one.*

*Measured against the module at `102afe3`, one position and one resting order on
another contract, changing one held input at a time:*

| what is held for the order's contract | free margin |
|---------------------------------------|-------------|
| mark, leverage and bracket             | 270         |
| leverage and bracket, **no mark**      | null        |
| mark and bracket, no leverage          | null        |
| mark and leverage, no bracket          | null        |

*The middle row is today. The two below it are what `1c07bba` closed.*

*Note also that the mark is refused for a **limit** order, which carries its own
price and needs no mark to be valued — `restingOrderInitialMargin` requires one
unconditionally and only falls back to it when the order states no price. So
there are two independent repairs here, in two different files, and either alone
leaves a real case open:*

- *the gate: require a mark only when the order has no price of its own —
  `futures-account-margin.js`, owned by the session working
  `compute-the-unstated-values-beside-the-read`;*
- *the feed: track marks for contracts with working orders, not only for
  contracts with positions — `binance-connection.js` and
  `futures-mark-price-feed.js`. Without it a stop-market or trailing order on an
  order-only contract still takes the whole sum away, because it has no price of
  its own to fall back from. It is not a one-liner: the feed reconnects every
  stream when its symbol set changes, so tracking orders makes placing one
  re-open the marks — and an empty mark map is this same failure while it
  reconnects.*

*Until both land, the window cannot start and 1.3 will read 0 compared however
long it runs. Do not count days against this change before free margin is
observed computing on live data at least once.*

### Day one, later: the fix was committed and never ran

*The operator opened a position on APRUSDT and worked it through the afternoon —
twenty-one commands, the last at 16:40Z. Read from the same journal at the end of
that day, the desk having been restarted eleven times after the gate fix landed
at 12:43Z:*

```
free-margin         passes   0/174  agreed   0  unavailable 174/174 (174 wholly)
notional            passes 108/162  agreed 104  worst 20 bps on APRUSDT
initial-margin      passes 108/162  agreed 104  worst 20 bps on APRUSDT
maintenance-margin  passes 108/162  agreed 104  worst 20 bps on APRUSDT
liquidation-price   passes 108/162  agreed  63  worst 37 bps on APRUSDT
```

*Not a fourth input. `npm run e` is a vite dev server over the working tree, so
the desk runs the files on disk and not the committed ones. The gate fix was
taken into the repository through the index while another session held its own
uncommitted copy of `futures-account-margin.js` in the tree — a copy based on the
commit before it. `git diff` therefore showed the fix as a deletion, and the
running desk kept the old gate on line 269. The fix existed for four hours
without once executing.*

*Reproduced before acting: a slice of the committed tree with that session's four
working files laid over it fails the external guard with `unavailable: 1`;
restoring the single gate line turns it green and moves nothing else. The line
was then restored in the working tree itself, as a hunk and without a commit, so
the desk reads it on the next start.*

*What this says about the tree, and it is worth keeping: **a commit is not a
deployment here.** Any fix meant to be observed on live data has to be checked on
disk, not in the log, for as long as a second session holds the same file. The
check is `grep -c "required exactly where it is used"` against the working copy,
not against `HEAD:`.*

*The liquidation price is the one number this record shows genuinely disagreeing
— agreed on 63 of 108 passes, against 104 of 108 for the other three. That is not
this change's blocker and is not diagnosed here; it is written down so the window
does not later mistake it for something it introduced.*

- [ ] 1.1 Do not start this change until `compute-the-unstated-values-beside-the-read` has been running for the window in the proposal. There is nothing to decide before then.
- [ ] 1.2 Operator copies the day's record files aside if the window is to run longer than the fourteen days the record keeps.
- [ ] 1.3 Operator reads `node scripts/read-desk-record.mjs` over the window and states, per value, the passes compared, the worst disagreement and where, and the passes that could not be computed.
- [ ] 1.4 Check the coverage the bar asks for — both margin modes, a position past the first bracket, a funding payment, a partial fill, a leverage change, a margin adjustment — and say plainly which of them the window does not contain.

## 2. The Decision

- [ ] 2.1 Hold the measurement against the bar in the proposal, value by value, and write the numbers into this file.
- [ ] 2.2 If any value misses the bar: withdraw this change, write the measured numbers and the likely cause into the proposal, and stop. The read stays.
- [ ] 2.3 If the coverage is short rather than the agreement: keep gathering, and do not soften the bar to fit the evidence.
- [ ] 2.4 Only with the bar cleared, continue.

## 3. Showing What The Desk Computes

- [ ] 3.1 Publish the computed liquidation price, notional, initial and maintenance margin and free margin as the values the desk shows, recomputed as the mark price moves.
- [ ] 3.2 Say on screen that the liquidation price between beats is the desk's own estimate, without making the panel shout it.
- [ ] 3.3 Show nothing rather than a stale value where the desk cannot compute — the same rule the comparison ran under.
- [ ] 3.4 Size an order against the computed free margin, and keep the exchange's refusal as the final word it already is.
- [ ] 3.5 Prove 3.1–3.4 by test.

## 4. Removing The Read The Evidence Retired

- [ ] 4.1 Remove the `unstated` read: a fold schedules nothing, and the coalescing window and its timer go with it.
- [ ] 4.2 Remove the balances read after an order is placed, amended or cancelled; the margin the order commits is computed from the order.
- [ ] 4.3 Remove `unstated` from the read reason vocabulary, so a site that tries to issue one loses its line rather than passing unnoticed.
- [ ] 4.4 Prove by test that a fold and an order command issue no read at all.

## 5. The Beat That Catches What The Stream Missed

- [ ] 5.1 Read the account on a slow beat while it holds a position or a working order — minutes, not seconds — under a reason of its own.
- [ ] 5.1a Leave the ALGO read added by `name-the-algo-order-that-fired` (f3e135e) alone: an execution report matching a listed ALGO parent's `actualOrderId` issues one deduplicated read of its own, and that change's spec carves it out of the beat deliberately. It is a second read site in `useFuturesTrading.js`; do not fold it into the beat's condition.
- [ ] 5.1b Reprice the ALGO rule before enforcing it. This change's prohibition on reading in response to a frame is argued against a weight-90 account pass, and that is the wrong price for algos: `GET /fapi/v1/openAlgoOrders` is **weight 1** with a symbol, and 40 only without one (`docs/futures_hardening_roadmap.md:475`, verified against the adapter's symbol-required transport). A symbol-scoped algo read on an execution report the desk cannot match would cut algo trigger-to-screen from up to thirty seconds to one round trip, for every algo kind rather than only the ones `actualOrderId` resolves — at a hundredth of the weight the rule was written to avoid. Decide it on that number, not on this change's general rule; raised by the session that audited `name-the-algo-order-that-fired`, and not built by either of us.
- [ ] 5.2 Keep comparing on that beat and keep recording it, so the arithmetic stays on trial for as long as it is used.
- [ ] 5.3 State a beat that disagrees by more than the bar allows: the read takes the screen and the desk says which value moved and on what contract.
- [ ] 5.4 Prove 5.1–5.3 by test, including that a disagreeing beat replaces the computed value rather than being folded into it.

## 6. Verification

- [ ] 6.1 `npm run lint`, `npm test`, `npm run check:futures-production`, `npm run check:circular`, `npm run check:runtime-mock`, `npm run check:command-path`.
- [ ] 6.2 Operator confirms on live data that a fill moves the position row, its margins and the free margin at once, with no read behind them.
- [ ] 6.3 Operator confirms the liquidation line tracks the mark instead of stepping when a read answers, and that it agrees with Binance's own screen.
- [ ] 6.4 Operator confirms in the record that the reads left are the ones named in the proposal, and that `unstated` no longer appears.
- [ ] 6.5 Operator runs a week on the new arrangement and confirms no beat has had to correct the desk's arithmetic.
