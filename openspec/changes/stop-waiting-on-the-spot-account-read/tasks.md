## 1. Say Which Reads Are Waited For

- [x] 1.1 List every `await refreshAccountState(...)` on a spot path and decide each one separately — placement, cancel, and the reconciliation inside `reportSpotCommandFailure`. A find-and-replace over the `await` would take the one that is load-bearing with it.

  Four, and they do not decide the same way:

  | `binance-connection.js` | site | decided |
  |---|---|---|
  | `handleOrderPlacement` | the exchange accepted the order | not waited for |
  | `handleCancelOrder` | the exchange accepted the cancellation | not waited for |
  | `reportSpotCommandFailure` | reconciliation found the order | **waited for** |
  | `dispatchTypedTradingCommand` | `account.refresh` | **waited for** |

  The fourth was not in the proposal. It waits for a different reason than the
  third: there the read *is* the command, and there is no outcome emitted in
  front of it to wait behind.

- [x] 1.2 Draw the same distinction futures already draws: a read issued because something changed is not waited for; a read the screen is wrong without is. Futures names these `unstated` and `unresolved` and this should say the same thing in the same words rather than inventing a second vocabulary.

  Both words are used, at the sites and in `refreshAccountStateUnstated`'s
  documentation. No `reason` argument was added to spot's `refreshAccountState`:
  futures' reason reaches the journal as `read` lines keyed by reason alone, so
  spot reads entering that bucket would silently be counted as futures reads —
  the same defect as the `answer` line measuring different things on the two
  markets.

- [x] 1.3 Keep the read itself in every case. What changes is only whether the command holds until it answers.

## 2. Build It

- [x] 2.1 Stop awaiting the read on the accepted-order path, where the execution report has already been emitted a line earlier. Cancellation reads the same way and changed with it.
- [x] 2.2 Keep awaiting it after a reconciled unknown outcome, and say why at the call site.
- [x] 2.3 Make sure a read that is no longer awaited cannot lose its failure silently — an unawaited promise that rejects is an unhandled rejection, and futures' `void` form has the same hazard. Check what futures does about it and do the same, or better.

  Futures does nothing locally: its three `void refreshFuturesAccountState(...)`
  calls carry no `.catch`, and the only net under them is the process-wide
  `unhandledRejection` handler in `electron/main.js:79`, which prints
  `[Electron] Unhandled rejection` without saying which read failed. Spot's
  unawaited form catches and names it instead. The futures sites were left
  alone — they are outside this change's stated impact.

## 3. Proof

- [x] 3.1 Prove by test that an accepted spot order's command completes without waiting for the account pass, and that the pass still runs.

  `answers an accepted placement without waiting for the account read it
  triggers` — holds the account read open, drives 10s of time, and asserts the
  command has answered, the read went out, and its answer has not arrived.

- [x] 3.2 Prove by test that the reconciliation path still waits.
- [x] 3.3 Both against `git archive HEAD` in a copy first. Any that does not fail there is a guard and says so in its own title.

  Run in a `git archive HEAD` copy with `node_modules` symlinked. 3.1 failed
  there (`expected false to be true` at `expect(answered).toBe(true)`) — it
  bites. 3.2 passed there, so it is a guard against the find-and-replace and its
  title says `guards the wait after a reconciled unknown outcome`.

  Both needed the startup account read to finish before the held read is
  installed. Holding the startup read leaves a pass in flight, which is the case
  where even the old code did not wait — the 335ms control from the measurement.
  A test written that way proves nothing, and would have passed on both trees.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`. Clean; 2072 tests in 114 files pass.
- [x] 4.2 Operator places and cancels a few spot orders and reads what they cost:

  ```
  node scripts/read-desk-record.mjs | sed -n '/How long commands took/,/^$/p'
  ```

  Expect **around 330 ms**, the exchange round trip and nothing else. The number
  to compare against is the measurement below, not a guess.

  Note for reading that section afterwards: the spot `answer` line now measures
  the round trip alone, the same thing the futures one measures. Before this
  change the two could not be compared.

### The measurement this starts from

2026-08-16, six spot commands on live data: 1696, 1882, **335**, 3285, 1696 and
2169 ms. Three connections opened for the whole run, so connection reuse was
working — the time is not the handshake.

The 335 ms is the control. `refreshAccountState` returns immediately when a pass
is already in flight, so that one command skipped the wait and measured the round
trip alone. Every other one measured the round trip plus an account pass.

**Answered from the operator's own journal, 2026-08-20.** They placed and
cancelled two spot orders at 19:56 UTC; the four `answer` lines read **361, 361,
360, 360 ms**, all `ok`. Futures commands in the same session read 365–410 ms.
The two markets now measure the same thing — the exchange round trip — and
answer alike, which is the whole claim. The expectation of "around 330 ms" was
the estimate; 360 is the measurement, and the desk's own share of it is gone.
