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
  missed a settlement. A reading that is not yet complete is never deferred,
  whatever asked for it.

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
- [ ] 7.3 The same two numbers from the operator's own journal after a restart.
  The `settled` line now carries `reads` and `types` beside `pages`, so weight is
  `reads × 30` and the claim above is checkable without instrumenting anything
  further.

## 8. Operator gate

- [ ] 8.1 The settled column and the closed rounds show the same figures after
  the change as before it. This change is about what the desk spends, not about
  what it says, and any difference in a number is a defect in it.
