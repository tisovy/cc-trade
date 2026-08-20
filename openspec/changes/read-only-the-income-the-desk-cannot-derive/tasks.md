## 1. Measure before changing anything

- [ ] 1.1 Run the probe once and read three counts off it: how many rows the week
  holds by `incomeType`, how many of them are `FUNDING_FEE`, and how many are
  `COMMISSION_REBATE`, `REFERRAL_KICKBACK`, `API_REBATE` or `FEE_RETURN`. The
  last count decides §3.2 and nothing else does.
- [ ] 1.2 Confirm on the wire that `incomeType=FUNDING_FEE` returns the same
  forty-five rows the unfiltered read finds, in one page, at the same weight.
  A filter that changes the answer is not a saving.
- [ ] 1.3 Record whether this account's positions are crossed or isolated. A
  crossed funding `ACCOUNT_UPDATE` carries no position message, so it can say
  when a settlement happened and never which contract — the schedule is free, the
  attribution is not.

## 2. Spec

- [ ] 2.1 Strict validation of this change.

## 3. Code — stop asking for what is already held

- [ ] 3.1 The settled read asks `incomeType=FUNDING_FEE`. `INSURANCE_CLEAR` is
  read separately and only when the desk has seen something that could produce
  one.
- [ ] 3.2 An open position's realized PnL and commission come from the open round
  the fills fold already produces — unless 1.1 finds rebate rows, in which case
  the rebate types keep their own read and the gross still comes from the fills.
- [ ] 3.3 The walk's constants are resized for the shape it now reads. A week of
  forty-five rows is not a walk at all; most of `SLICE_*` and `MAX_ROWS` stop
  meaning anything and should go rather than sit there describing a read that no
  longer happens.

## 4. Code — stop asking on a clock

- [ ] 4.1 `markPriceUpdate` carries `T` through to the desk, so the next
  settlement's time is known without a request.
- [ ] 4.2 The settled read is scheduled by the funding `ACCOUNT_UPDATE` and by
  the settlement time passing, not by the thirty-second account tick.
- [ ] 4.3 A slow reconciliation remains, sized to the cost of being wrong. With
  the read narrowed it is one request, so it can be frequent without being dear.

## 5. Code — keep what was read

- [ ] 5.1 The held ledger persists under `app.getPath('userData')`, beside the
  diagnostic journal, carrying its rows, the span it covers, the identity scheme
  it was written under, and a fingerprint of the credential it was read with.
- [ ] 5.2 Loading refuses on any mismatch — different account, missing span,
  older identity scheme — and re-reads instead. Refusing is cheap now; that is
  what makes it the right default.
- [ ] 5.3 A periodic whole-window re-read compares against the kept reading. The
  exchange wins every disagreement and the disagreement is recorded.

## 6. Proof

- [ ] 6.1 The narrowed read is proved by what it asks for, not only by what it
  returns: assert the `incomeType` on the wire. A test that only checks the rows
  passes against a read that still asks for everything.
- [ ] 6.2 A test that a kept reading from another account is refused, and one
  that a kept reading without its span is refused.
- [ ] 6.3 A test that the exchange's answer overrides the kept one, and that the
  override is recorded.
- [ ] 6.4 Every new test run against the current implementation first, in a copy
  of the tree.

## 7. Cost, measured after

- [ ] 7.1 From the operator's journal after a restart: pages to `complete`,
  weight spent, and seconds. The claim to beat is 67 pages / 2010 weight / 3.5
  minutes, and the target is one request.
- [ ] 7.2 Weight per minute in the steady state over an hour, against today's 60.

## 8. Operator gate

- [ ] 8.1 The settled column and the closed rounds show the same figures after
  the change as before it. This change is about what the desk spends, not about
  what it says, and any difference in a number is a defect in it.
