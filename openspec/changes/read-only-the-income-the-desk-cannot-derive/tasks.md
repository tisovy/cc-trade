## 1. Measure before changing anything

- [x] 1.1 Count the week's income rows by kind. Done on the operator's account
  from the probe's run of 2026-08-20: **13 330** rows over seven days, of which
  **45** are `FUNDING_FEE`. The rest are per-fill `REALIZED_PNL` and
  `COMMISSION`, both of which the desk already holds from `/fapi/v1/userTrades`.
- [x] 1.2 The rebate count was to decide whether commission could move to the
  fills. **It no longer decides anything, and the read no longer waits on it.**
  The rebate kinds are read from the income record either way, and the arithmetic
  is then correct under both readings of what an income `COMMISSION` row means:
  if it is the same gross charge the fill states, gross-from-the-fills plus the
  credits is the net cost and nothing changed; if it is already net of them, the
  old reading added the credit twice and this one does not. A question whose
  answer changes no behaviour is not a gate.
- [ ] 1.3 **Whether a rebate row names a contract.** Found while auditing, and it
  is the one thing above that could still move a number. The desk keeps only
  income rows the exchange named a symbol on — a credit with nothing to attribute
  it to cannot go against a position — so if this account's rebate rows carry no
  symbol, they never reach the column, and the commission it states is the gross
  charge whether it is read from the fills or from the income record. That is not
  a defect either way; it decides whether those four kinds are worth 120 weight a
  pass. The probe now prints the count, the split, and the per-kind totals.
- [ ] 1.4 Whether this account's positions are crossed or isolated. Still worth
  recording — a crossed funding `ACCOUNT_UPDATE` carries no position message, so
  it says when a settlement happened and never which contract — but it gates
  nothing here: the income record is read for the attribution regardless, and the
  mark frame's countdown gives the timing on either margin mode.

## 2. Spec

- [x] 2.1 Strict validation of this change.

## 3. Code — stop asking for what is already held

- [x] 3.1 The settled read asks for one kind of flow at a time, and only for the
  kinds no other record states: `FUNDING_FEE`, `INSURANCE_CLEAR`, and the four
  rebate kinds. Six reads a page instead of one, and a page instead of nine
  passes.
  - Insurance clearance is read every pass rather than only after something
    liquidation-shaped, which is what this task first proposed. Detecting "the
    desk has seen something that could produce one" cannot cover the case that
    matters — a clearance that happened before the desk started — so it would
    have to read once per activation anyway, and then carry per-kind coverage to
    stay honest about what it had looked at. That is state that can be wrong, in
    the money path, to save 30 weight on a read that runs thirty times a day.
- [x] 3.2 An open position's realized PnL and commission come from the open
  round the fills fold already produces. The same fold the closed rounds have
  always used, so the two surfaces state one number instead of two that can
  disagree — and it arrives on the stream frame itself, with no request at all,
  rather than a debounce and a round trip after it.
- [x] 3.3 The walk's constants resized for the shape it now reads. A chunk starts
  at half the window instead of a day, its ceiling is the window instead of two
  days, and the request budget is four pages instead of eight because a page is
  now six reads. Half rather than the whole window on purpose: a full page is the
  *oldest* rows of the range asked for, so a chunk spanning the window hands back
  the far end of it first — the defect this walk exists to fix.

## 4. Code — stop asking on a clock

- [x] 4.1 `markPriceUpdate` carries `T` through to the desk.
- [x] 4.2 The read is scheduled by the settlement itself: the funding
  `ACCOUNT_UPDATE` on the private stream, and the mark frame's countdown stepping
  forward on the public one. Two independent witnesses, neither costing a
  request. The account tick, a fill and the operator's refresh no longer read a
  complete reading.
- [x] 4.3 A reconciliation remains at one hour, for the case where both sockets
  missed a settlement. A reading that is not yet complete is deferred by a
  minute rather than an hour — see 9.2, which is where the first version of this
  said "never deferred" and was wrong about the cost of saying so.

## 5. Code — keep what was read

- [ ] 5.1–5.3 **Deliberately not done, and this is the reason.** Persistence was
  proposed against a cold start of ~2 010 weight and three and a half minutes. It
  is now **360 weight, one pass**, and the reading is complete before the first
  frame the operator could read. A file on disk would save that — and would carry
  a stored total that is wrong forever if anything about it is wrong once, which
  is a failure mode the recomputed reading does not have. Persistence is worth
  its risk when the thing it saves is expensive; this one is not any more.
  - The requirement it was filed under says the desk **MAY** keep a reading, and
    lists five conditions for keeping one. Those conditions stand, unbuilt
    against, for whoever revisits this. The row-identity one is already met.

## 6. Proof

- [x] 6.1 `asks the income record only for the kinds of flow no other record
  states` asserts the `incomeType` on the wire. Against the reading before this
  change it fails with `expected [ null, null, null, null ] to not include null`
  — four pages of the whole record.
- [x] 6.2 The kept-reading tests are not written, because nothing is kept. See
  §5.
- [x] 6.3 Nothing overrides anything: the exchange is the only source, every
  pass. The property those tests were for is now structural.
- [x] 6.4 Every new test run against the current implementation first, in a copy
  of the tree at HEAD. Eleven of the fourteen fail there; the three that do not
  are named guards in their own comments, and each says what it is guarding.

## 7. Cost, measured

- [x] 7.1 Cold start, measured through the walk itself against a week shaped like
  the operator's account: **2 pages, 12 reads, 360 weight, complete on the first
  pass**. The claim to beat was 67 pages / 2 010 weight / 3.5 minutes / nine
  passes.
- [x] 7.2 Steady state, same measurement: **1 page, 6 reads, 180 weight** per
  pass. At six settlements a day plus an hourly reconciliation that is about
  **3.75 weight a minute**, against today's 60 — a sixteenfold cut, and the tick
  that produced most of the old number is gone rather than slowed.
- [x] 7.3 The same two numbers from the operator's own journal after a restart.
  The `settled` line now carries `reads` and `types` beside `pages`, so weight is
  `reads × 30` and the claim above is checkable without instrumenting anything
  further.

## 8. Operator gate

- [ ] 8.1 The settled column and the closed rounds show the same figures after
  the change as before it. This change is about what the desk spends, not about
  what it says, and any difference in a number is a defect in it.

## 9. Audit of this change

- [x] 9.1 **The six kinds were written out twice.** The read had its own literal
  list in `binance-connection.js` while the fold's table in
  `futuresSettledMoney.js` decides which kinds the fills can state — and the
  import right above it says "one list, one place". Two copies drift silently in
  both directions: a kind marked underivable in the table but missing from the
  read is money the column never sees, and a kind read but absent from the table
  is 30 weight a pass for rows the fold discards. Neither fails anything. The
  list is now derived from the table and exported as
  `FUTURES_UNDERIVABLE_INCOME_TYPES`; the wire test asserts against it rather
  than against a third copy.
- [x] 9.2 **The extending phase had no bound.** A reading short of its window's
  start was due for whatever reason asked, which was right when a pass was one
  request and is not now that a page is six: a pass that spends its budget is
  four pages by six kinds by weight 30 — **720 weight**, against a limiter of 800
  a minute — and a desk filling orders asks on every fill. That is the cost this
  change removes, reappearing in the one state where the desk can least afford
  it. A pass may now start once a minute while the reading is incomplete; the
  settlement itself still bypasses it. On this account's shape the bound is never
  reached, because the first pass covers the window.
  - It is also the arithmetic behind 3.3's page budget: at six reads a page,
    eight pages would no longer fit inside the minute.
- [x] 9.3 The walk's `complete` comment still said "spent all eight". Four.
- [x] 9.4 Checked and **not** changed: two comments reading "up to eight pages at
  weight 30" describe the contract-discovery walk, which is four pages called
  twice. They are correct; the resemblance to this change's numbers is a
  coincidence.
- [x] 9.5 The stale bundle recorded in the ledger has cleared —
  `dist-electron/main.js` rebuilt at 22:09 with no source newer than it, and it
  carries `INSURANCE_CLEAR`, `MAX_REQUESTS: 4` and the settlement wiring. The
  edits above rebuilt it again; the desk restarts itself on each, which is what
  the operator will have seen.

## 10. What the operator's journal said, 2026-08-20 evening

- [x] 10.1 **The cost, measured on their desk rather than through the walk.**
  Before: 295 passes in 248 minutes, 29 040 weight — **117.2 weight a minute**,
  and 125 of those 295 came back `partial`, never having reached the window's
  start at all. After: 15 passes in 93 minutes, 4 500 weight — **45.3 a minute**,
  every one `complete` with the full 604 800 000 ms covered. The residual is
  restarts, not polling: seven of the fifteen are `stream`, one per relaunch, and
  this session relaunched the desk a dozen times.
- [x] 10.2 **`refresh` is not only the operator.** The renderer's
  thirty-second reconcile sends the same command, and the journal shows it
  firing exactly on the thirty from 20:20:58 while an order rested. Making the
  refresh always-due therefore made the reconcile six requests every thirty
  seconds — 360 weight a minute, worse than the number this whole change set out
  to reduce. The command now says which it is, and the desk reads on a person
  and not on a timer. Found in the operator's journal forty minutes after the
  commit that caused it; no test could have found it, because no test knew the
  two asks shared a command.
- [x] 10.3 The spot round trip, from the same journal: four commands at 19:56
  UTC, **360–361 ms**, all `ok` — beside futures at 365–410 ms in the same
  session. The two markets now measure the same thing and answer alike, which
  is what `stop-waiting-on-the-spot-account-read` 4.2 asked for.

## 11. The claim, from the operator's desk, 2026-08-21

Task 7.3, closed. One ordinary session, `desk-2026-08-21-000.jsonl`, 04:24 to
08:59 UTC — 275 minutes, **8 passes, 1 800 weight, 6.54 weight a minute**, every
one `complete` with the full 604 800 000 ms covered.

The claim to beat was the same desk's own 117.2 a minute across 295 passes, 125
of which never reached the window's start at all. That is an **eighteenfold**
cut, measured on the same account across the same endpoint.

What the eight passes were: three `stream` (one per start), three `refresh` (a
person), one `settlement`, one `confirm`. **No `tick` at any point** — the
thirty-second reconcile ran all session and read nothing, which is 10.2's fix
holding.

And the settlement path, end to end, in two lines: `08:00:07 settlement rows:45`
then `08:02:11 confirm rows:46`. The charge announced, the record catching up two
minutes later, and the row landing — the defect of 2026-08-20 not reproducing.
