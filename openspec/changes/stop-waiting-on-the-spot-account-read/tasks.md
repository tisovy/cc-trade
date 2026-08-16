## 1. Say Which Reads Are Waited For

- [ ] 1.1 List every `await refreshAccountState(...)` on a spot path and decide each one separately — placement, cancel, and the reconciliation inside `reportSpotCommandFailure`. A find-and-replace over the `await` would take the one that is load-bearing with it.
- [ ] 1.2 Draw the same distinction futures already draws: a read issued because something changed is not waited for; a read the screen is wrong without is. Futures names these `unstated` and `unresolved` and this should say the same thing in the same words rather than inventing a second vocabulary.
- [ ] 1.3 Keep the read itself in every case. What changes is only whether the command holds until it answers.

## 2. Build It

- [ ] 2.1 Stop awaiting the read on the accepted-order path, where the execution report has already been emitted a line earlier.
- [ ] 2.2 Keep awaiting it after a reconciled unknown outcome, and say why at the call site.
- [ ] 2.3 Make sure a read that is no longer awaited cannot lose its failure silently — an unawaited promise that rejects is an unhandled rejection, and futures' `void` form has the same hazard. Check what futures does about it and do the same, or better.

## 3. Proof

- [ ] 3.1 Prove by test that an accepted spot order's command completes without waiting for the account pass, and that the pass still runs.
- [ ] 3.2 Prove by test that the reconciliation path still waits.
- [ ] 3.3 Both against `git archive HEAD` in a copy first. Any that does not fail there is a guard and says so in its own title.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`.
- [ ] 4.2 Operator places and cancels a few spot orders and reads what they cost:

  ```
  node scripts/read-desk-record.mjs | sed -n '/How long commands took/,/^$/p'
  ```

  Expect **around 330 ms**, the exchange round trip and nothing else. The number
  to compare against is the measurement below, not a guess.

### The measurement this starts from

2026-08-16, six spot commands on live data: 1696, 1882, **335**, 3285, 1696 and
2169 ms. Three connections opened for the whole run, so connection reuse was
working — the time is not the handshake.

The 335 ms is the control. `refreshAccountState` returns immediately when a pass
is already in flight, so that one command skipped the wait and measured the round
trip alone. Every other one measured the round trip plus an account pass.
