## Why

Eight changes have shipped with their operator-confirmation item unchecked, and
they are unchecked for a good reason: nobody has sat down with the live desk and
gone through them. They are spread across eight `tasks.md` files, each phrased
for the change it belongs to, so performing them means reading eight documents
and reconstructing what to click from each.

The operator works several sessions at once and is interrupted constantly. A
verification pass that requires reassembling its own instructions will keep not
happening — which is how the repository arrived at archived changes whose
confirmation marks were checked without a live check behind them
(`state-only-verified-completion`).

What is missing is not willingness. It is one document that says, in order, what
to do, what should be seen, and what each observation settles.

## What Changes

- One runbook, `runbook.md` in this change, holding every outstanding operator
  confirmation as a numbered step: the action, the expected reading, and the task
  it closes.
- The steps are ordered so the pass runs once, front to back, in roughly forty
  minutes: everything read-only first, then the checks that need the exchange
  cut off, then the few that place a real order.
- Each step states plainly whether it can be staged by hand at all. Some
  guarantees can only be exercised by a failure the operator cannot cause safely;
  the runbook says so rather than inventing a procedure, and those items go to
  the ledger as covered by test only.
- The results are written into the live-verification ledger created by
  `state-only-verified-completion`, and the confirmation items in the eight
  changes are checked from that record — not from memory.

## Capabilities

No capability specification changes. This change performs verification that
existing requirements already state; it adds, modifies and removes nothing.

## Impact

- Requires the operator, the live Production Futures account, and one
  uninterrupted sitting.
- Two steps place real orders. They are sized at the exchange minimum on a
  liquid contract and are cancelled within the same step; the expected cost is
  fees on one small fill, and the runbook states the exposure at each such step
  before it is taken.
- Everything before those steps is read-only and can be stopped at any point
  without leaving anything on the exchange.
