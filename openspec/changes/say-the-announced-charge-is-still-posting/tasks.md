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

- [x] 2.1 Delta under `futures-workstation-presentation`: an announced charge
      awaiting its income row is announced as posting, not as failure. The
      statement lives on the round's money element, in place of the generic
      not-ready qualification — the canonical requirement at
      `futures-workstation-presentation` keeps coverage qualifications on that
      element's title without an inline badge, and the operator ruled inline
      settled narration noise on 2026-08-23.

## 3. Code

- [x] 3.1 Separate the two `partial` states where the pass is recorded: the
      `settled` line carries `partialKind` (`debt-only` / `short`) and
      `awaitingLanes` (how many lanes owe a confirmation).
      `classifyFuturesSettledIncompleteness` in
      `src/utils/futuresSettledIncomeResource.js` is the one classifier, shared
      by the journal line and the renderer so neither invents its own rule.
      Both fields are **declared** in `desk-diagnostic-record.js`: a kind
      writes only the fields it declares, so the first cut passed them to
      `record()` and the file dropped them in silence — caught by reading the
      operator's journal, not by the suite. A count, not the lane names: no
      list may enter that file.
- [x] 3.2 The surface announces outstanding-debt-only as "A charge the
      exchange announced is still posting; confirming at …" on the round's
      money element, without "failed" and without ↻; "failed" and the
      kept-reading stamp remain for errored lanes, and a failure standing
      beside a debt still announces.

## 4. Proof

- [x] 4.1 Tests that bite, all four verified against `main`'s files swapped
      back in — including one at the record's own boundary
      (`describeDeskDiagnosticEvent`), which is where the dropped fields were
      caught and where the call-site assertion could not see them: the panel test reproduced the operator's exact popup text
      ("Wallet-adjustment refresh failed … Press ↻ to retry.") before the
      change and is silent after; the journal test failed on the missing
      `partialKind`; the classifier's five cases cover debt-only, nearest
      deadline, uncovered target, error-with-debt, and a debt lane whose own
      page walk is unfinished.
- [x] 4.2 Full suite 2922/2922 across 128 files, eslint clean on the eight
      touched files, and all four guards (circular, runtime-mock,
      futures-production, command-path) pass.

## 5. Operator gate

- [ ] 5.1 Operator closes a position or crosses a funding boundary: within the
      two minutes after it the surface says a charge is being confirmed — no
      failure popup — and the settled figures land on their own. A real route
      failure (proxy stopped) still announces once as failed. Record in
      `openspec/live-verification-ledger.md`.
