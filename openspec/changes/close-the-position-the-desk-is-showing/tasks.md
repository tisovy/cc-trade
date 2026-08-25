# Tasks

## 1. Diagnosis

- [x] 1.1 Journal read, 2026-08-24. 18:09:37 book recovery on VELVETUSDT
      (`DEPTH_BAND_WALKED`, `loading` → `live` 18:09:38.897); 18:09:41.481
      account refresh pass starts (`read, reason: refresh, resources: 4,
      weight: 90`); 18:09:41.958 close click refused
      `FUTURES_REDUCTION_NOT_CONFIRMED` in 1 ms; 18:09:41.966 and 18:09:42.117
      the account answers land; 18:09:51.316 second click sent, `ok` in
      349 ms. The refusal fired inside the ~640 ms re-stamp window.
- [x] 1.2 Guard read (`binance-connection.js:5525`): one `false` for five
      distinct causes; the "current" predicate requires `status === 'ready'`,
      `lastSuccessfulAt`, and the positions activation generation to equal the
      live activation generation. Which of the three currency legs failed is
      not recorded by the refusal — that gap is task 3.2's instrument.

## 2. Spec

- [x] 2.1 Delta under `trading-command-integrity`: a displayed position closes
      on the first command; a reduction refusal names its cause. Self-audit
      added a `desk-diagnostic-record` delta: the outcome line may carry the
      desk-named condition (amount-proof shape), and the summary counts desk
      refusals by that condition instead of folding them into one uncoded
      bucket.

## 3. Code

- [x] 3.1 Confirm the reduction against the newest successful positions
      reading even during a re-stamp (in-flight refresh, bumped activation
      generation). No successful reading at all → hold the command (bounded)
      for the in-flight pass; refuse only on disagreement or on the bound.
      `assessFuturesReduction` proves against the newest successful reading
      (`lastSuccessfulAt`/`updatedAt`, status and activation generation no
      longer consulted); `holdFuturesReductionForProof` holds up to 900 ms,
      polling every 25 ms, and asks for the positions itself under the new
      urgent read reason `proof`. Evidence older than 15 minutes takes the
      same hold instead of confirming; the bound expiring unread refuses as
      `STALE_READING`.
- [x] 3.2 The rejection detail and the journal `outcome` line carry the failed
      condition: `NO_READING` / `STALE_READING` / `QUANTITY_EXCEEDS_LEG` /
      `LEG_MISMATCH` / `SIDE_MISMATCH`. `details.cause` on the rejection, a
      `cause` field (tolerated, code-shaped) on the record's `outcome` kind,
      a per-cause message, and the ticket shows the cause beside the code.
      Self-audit: `read-desk-record.mjs` refusal summary now keys a desk
      refusal by its named condition (`NO_READING[futures]`), not by the
      absent exchange code — the old fold was the same archaeology by
      another door.

## 4. Proof

- [x] 4.1 Tests that bite against the current guard: a reduce-only close
      arriving between an activation-generation bump and the positions
      re-stamp is sent, not refused (fails today); a refusal carries its named
      cause (fails today); a genuinely wrong reduction (leg/side/quantity) is
      still refused; the hedge-mode exposure-cap exemption still requires a
      proved leg. All seven new/updated assertions were run against the
      pre-change tree first: the re-stamp send, the hold-then-send at first
      proof, the named `NO_READING` bound, the named `STALE_READING` bound,
      the five-cause batch, the journal `outcome` cause, and the ticket's
      cause display each failed before the fix and pass after. The wrong-
      reduction batch and the cap-exemption proof (MARKET order through an
      active cap) stay green as sentinels — they refused before and refuse
      still, now by name. Self-audit added the literal episode variant —
      same activation, `account.refresh` re-stamping the reading, click
      inside the window — run against the pre-change guard first (refused)
      and against the fix (sent); the reader-summary cause test bit the same
      way. The pause flag is re-checked after the hold on the operator's
      order — the hold is the one await the proof added between the pause
      gate and the wire, and a close paused mid-hold now refuses
      `FUTURES_TRADING_PAUSED` and sends on resume + reclick (test bit:
      the unfixed gate sent it). The limiter-queue window after submission
      is inherent and remains.
- [x] 4.2 Full suite, lint, and the repository guards: `npx vitest run`
      2872/2872 green, `npx eslint` clean on every touched file,
      `check-circular-imports` / `check-runtime-mock-layer` /
      `check-futures-workstation-boundaries` / `check-trading-command-path`
      all pass.

## 5. Operator gate

- [x] 5.1 Operator closes a position by market on the first click during
      ordinary trading. If a refusal ever appears again, its popup and journal
      line now name the failed condition — record the episode in
      `openspec/live-verification-ledger.md`. Confirmed 2026-08-25 ("уходит с
      первого клика"); no refusal episode occurred — ledger, The 2026-08-25
      Operator Runbook Pass.
