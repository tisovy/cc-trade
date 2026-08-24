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

- [ ] 2.1 Delta under `trading-command-integrity`: a displayed position closes
      on the first command; a reduction refusal names its cause.

## 3. Code

- [ ] 3.1 Confirm the reduction against the newest successful positions
      reading even during a re-stamp (in-flight refresh, bumped activation
      generation). No successful reading at all → hold the command (bounded)
      for the in-flight pass; refuse only on disagreement or on the bound.
- [ ] 3.2 The rejection detail and the journal `outcome` line carry the failed
      condition: `NO_READING` / `STALE_READING` / `QUANTITY_EXCEEDS_LEG` /
      `LEG_MISMATCH` / `SIDE_MISMATCH`.

## 4. Proof

- [ ] 4.1 Tests that bite against the current guard: a reduce-only close
      arriving between an activation-generation bump and the positions
      re-stamp is sent, not refused (fails today); a refusal carries its named
      cause (fails today); a genuinely wrong reduction (leg/side/quantity) is
      still refused; the hedge-mode exposure-cap exemption still requires a
      proved leg.
- [ ] 4.2 Full suite, lint, and the repository guards.

## 5. Operator gate

- [ ] 5.1 Operator closes a position by market on the first click during
      ordinary trading. If a refusal ever appears again, its popup and journal
      line now name the failed condition — record the episode in
      `openspec/live-verification-ledger.md`.
