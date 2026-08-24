# Tasks

## 1. Diagnosis

- [x] 1.1 Journal read, 2026-08-24. Close sent 18:09:51.316, `ok` 349 ms.
      Refresh pass 18:11:03.264: `pages: 6, reads: 6, lanes: 6`, all requests
      `ok, 200`, `rows: 77, kept: 77, missing: 0, differing: 0`,
      `outcome: "partial"` — and the popup fired at the same second. The
      credit-confirm at 18:11:54 is the debt-chasing pass doing its job.
- [x] 1.2 Mechanism read: `withFuturesSettledConfirmationDebt`
      (`binance-connection.js:2962`) pushes the lane `targetTo` to the event's
      durable bucket and marks it `stale`; `finalizeFuturesSettledIncomeResource`
      then reports the resource incomplete until the confirming pass at
      +2 minutes proves the row. Correct accounting, mislabeled surface.
- [x] 1.3 `verified: 0` on refresh-class passes is by construction
      (`binance-connection.js:3310` — only `verification` passes set it), not
      a broken verification leg. Recorded so the 2026-08-23 chronic-partial
      entry stops being read through that field.

## 2. Spec

- [ ] 2.1 Delta under `futures-workstation-presentation`: an announced charge
      awaiting its income row is announced as posting, not as failure.

## 3. Code

- [ ] 3.1 Separate the two `partial` states where the pass is recorded: the
      `settled` line carries whether the shortfall is outstanding-debt-only
      or a genuinely uncovered target.
- [ ] 3.2 The surface announces outstanding-debt-only as "confirming an
      announced charge, next pass at …" without "failed" and without ↻;
      "failed" and the kept-reading stamp remain for `failed` outcomes and
      unanswered requests.

## 4. Proof

- [ ] 4.1 Tests that bite: a pass that answers fully but holds a confirmation
      debt does not raise the failure popup (fails today); a pass with
      `outcome: "failed"` still does; the journal line states the partial's
      kind (fails today).
- [ ] 4.2 Full suite, lint, and the repository guards.

## 5. Operator gate

- [ ] 5.1 Operator closes a position or crosses a funding boundary: within the
      two minutes after it the surface says a charge is being confirmed — no
      failure popup — and the settled figures land on their own. A real route
      failure (proxy stopped) still announces once as failed. Record in
      `openspec/live-verification-ledger.md`.
