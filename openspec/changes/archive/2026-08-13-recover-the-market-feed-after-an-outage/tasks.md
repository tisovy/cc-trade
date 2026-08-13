## 0. What Was Measured

Written 2026-08-13 from the operator's live run of
`verify-the-desk-in-one-sitting`, by stopping the SOCKS proxy on 127.0.0.1:1080.
Both experiments are the operator's own words, recorded during the run.

- **Outage of 1–2 minutes:** the account leg recovered in about 8 seconds and
  the chart, book and tape in about 40. The desk recovered by itself.
- **Outage longer than that:** the account leg recovered the same way; the
  chart, book and tape did not return at all. `Ctrl+R` restored everything at
  once.
- **The Retry button was never pressed** — the operator did not treat it as the
  way back, and it is in the contract sidebar, not beside what stopped.
- **The ladder is 91.5 s of waiting**: 0.5 + 1 + 2 + 4 + 8 + 16 + 30 + 30, from
  `min(30_000, 500 × 2^attempt)` over `RECONNECT_ATTEMPTS: 8`, plus each failed
  attempt's own time before it fails.

- [x] 0.1 Confirmed by reading: `haltSession` set `this.current = null`, and every
      timer callback in the service guards on `isCurrent(session)`, which requires
      `this.current === session` (`:536-540`). Nothing — freshness monitor,
      interval ladder, book recovery, transport — could revive it. Only a fresh
      subscribe from the renderer could, which is what `Ctrl+R` did.
- [x] 0.2 The ~40 s recovery in the short outage was the ladder's own tail, not a
      transport reconnect. The last rungs wait 16 s and 30 s, so a route that
      returns mid-ladder is picked up up to 30 s later, plus the bootstrap. No
      second mechanism is needed to explain it, and the long outage — where the
      ladder had run out — is the same mechanism reaching its end.

## 1. The Ladder Ends The Hurry, Not The Recovery

- [x] 1.1 No new constant. The slow interval is the ladder's own last rung:
      `min(RECONNECT_MAX_MS, RECONNECT_BASE_MS × 2^attempt)` already caps at
      `RECONNECT_MAX_MS` (30 s), so holding the attempt at the ceiling repeats it
      forever. One number fewer to justify, and the pacing is the one the desk
      already spent 60 of its 91.5 seconds at.
- [x] 1.2 `scheduleResync` no longer halts on exhaustion. It emits `UNAVAILABLE`
      with `RECONNECT_EXHAUSTED` as before, then falls through to the same
      teardown and the same rescheduling as an ordinary resync.
- [x] 1.3 The fast ladder resets on a successful rebuild — `reconnectAttempt = 0`
      at `:894`, unchanged, now reachable again after an exhausted session
      recovers.
- [x] 1.4 The slow beat reuses `session.reconnectTimer`, so it is already
      `unref`'d, already cleared by `stopCurrent`, and already unable to work for
      a session that is not current.
- [x] 1.5 No taxonomy of terminal reason codes invented — see the proposal's
      non-goal. The session stops when the contract is no longer wanted, and for
      no other reason.
- [x] 1.6 The interval (candle) ladder is untouched; it already declined to halt
      the session.
- [x] 1.7 Attempt count held at the ceiling rather than counted upwards, so a
      session that spends an afternoon without a route does not grow an unbounded
      number. `haltSession` removed — after 1.2 it had no caller, and
      `stopCurrent` already did the same release.

## 2. Saying It Where It Was Lost

- [x] 2.1 The chart, book and tape already state their own loss through the
      reading age introduced by `say-which-readings-are-stale`, which the operator
      confirmed live in step 7 of the run ("замерзший mark не выдаётся за рынок").
      Nothing added here would have said more; what was missing was the session's
      own statement, which is 2.2.
- [x] 2.2 A notice on the chart states that the market feed stopped and that the
      desk is still retrying. The reason code stays on the identity line where it
      already was.
- [x] 2.3 Retry offered beside that notice, wired to the `retry` the hook already
      exposes — the same one the sidebar button uses.
- [x] 2.4 The message no longer calls a lost market feed a lost contract list.
      `contractsUnavailable` renamed to `feedUnavailable` for the same reason.
- [x] 2.5 Measured in `/usr/bin/chromium --headless --dump-dom`, with the real
      `base.css` + `app-layout.css` + `FuturesWorkstation.css` inside the real
      `#root > .futures-mode-view > .futures-production-workstation` shell, at
      1280×720, 1440×900, 1600×900, 1920×1080 and 2560×1440. At every size the
      notice's rect is inside the chart frame's rect and
      `documentElement.scrollWidth <= clientWidth` — no panel scrolls and the
      page does not overflow. It wraps to two lines below 1600 and stays
      centred. The containment is not luck: `.futures-workstation-chart-frame`
      is `position: relative` (`FuturesWorkstation.css:746-750`), which is what
      an absolutely positioned child needs to stay in the panel it belongs to.
- [x] 2.5a **The first measurement was not enough, and the second found a real
      defect.** Containment and page overflow were measured; overlap with what
      the chart already draws was not. The reading notice is top-anchored at the
      left edge (`:955-958`), and at 1280, 1366 and 1440 the centred feed notice
      overlapped it by up to 63px — at exactly the moment both appear, since a
      stopped feed is what makes the reading stale. Moved to `top: 34px` so the
      two stack; re-measured at all six widths with no overlap of either the
      reading notice or the history notice. Guarded by asserting the
      relationship between the two rules' `top` values rather than the pixel,
      since jsdom has no geometry; the guard was run against `top: 8px` and
      failed. Raised by the session auditing `name-the-algo-order-that-fired`.

- [x] 2.6 **Found by auditing this change after it shipped, 2026-08-13.** The
      notice was withdrawn on every attempt and restored when the attempt
      failed. `startGeneration` opens each generation with `LOADING`
      (`:694`), the notice is drawn from `unavailable`
      (`FuturesWorkstationView.jsx:259`), and past the ceiling a generation is
      started every 30 s — so the operator lost the message and the retry
      button for the length of each attempt, forever. How bad depends on how
      the route fails, and the worse case is the quieter one: a refused
      connection answers in about 60 ms and reads as a blink, while a route
      that hangs holds `LOADING` until the handshake times out, which is up to
      ten seconds in every forty.
      This was not a pre-existing fault. Before 1.2 the session halted at the
      ceiling and there were no further attempts to withdraw it.
      A generation started at the ceiling now restates `UNAVAILABLE` with
      `RECONNECT_EXHAUSTED` instead of claiming to load. Restating rather than
      staying silent, because a generation is a new session object with its own
      revision counter, and the renderer must not be left inferring the status
      of a generation it was never given one for. The repeat costs one journal
      line per attempt — two a minute against the ~39 a minute the record
      already budgets for a desk that cannot reach the exchange
      (`desk-diagnostic-record.js:17-25`), and it is the only trace that the
      desk spent the night trying.

## 3. Proving It

- [x] 3.1 `keeps trying after the production session exhausts its reconnect
      attempts` — the session survives exhaustion and has another attempt armed.
- [x] 3.2 The same test runs that attempt and asserts the session returns to
      `live` with `reconnectAttempt` back at 0, so the fast ladder is available
      again.
- [x] 3.3 `stops the production attempts when the contract is released` — the
      guarantee the old halt provided: no timer, no interval, no current session.
- [x] 3.4 `states the stopped feed on the chart and retries from there` — the
      notice is inside the chart frame and its button calls `onRetry`.
- [x] 3.5 Mutation-tested. **M1**, restoring the halt (`stopCurrent(); return`):
      all three service tests red. **M2**, removing only the attempt clamp:
      `expected 14 to be 8`, the ceiling test alone red. The chart-notice test
      needs no mutation run — the class it queries did not exist before this
      change.
- [x] 3.6 `does not call a production attempt past the ceiling a loading one` —
      after exhaustion, no status the session emits on a further attempt is
      `loading`, and the first one it emits is `unavailable`. Asserted over
      every status frame emitted after exhaustion rather than over the one the
      test came for, since the defect was an extra frame rather than a missing
      one. Mutation **M4**, restoring the unconditional `LOADING`: red, and
      only this test.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1803 passed, 109 files),
      `npm run check:futures-production`, `npm run check:circular`,
      `npm run check:runtime-mock`, `npm run check:command-path` — all green.
- [ ] 4.2 Operator steps handed to `verify-the-desk-in-one-sitting`'s runbook
      under "Дописано 2026-08-13: рынок возвращается сам". Not checked off here;
      the runbook is where operator verification lives.

      Confirmed live on 2026-08-13 at the third attempt, and the two failed
      attempts are worth keeping because both failed the same way — the check was
      spoiled by touching the desk during the outage. First: the operator
      switched to Spot and back, which rebuilds the session and resets the
      ladder, so the successful attempt was the eighth of a fresh ladder and the
      old code would have reached it too. Second: the operator pressed Retry 5.3
      seconds before the desk's own next attempt was due, which proved the button
      and pre-empted the thing being measured. Third, untouched: outage 15:25:32,
      ceiling at 15:27:03.62 after 91.4 s against the 91.5 predicted, and
      **attempt nine at 15:27:33.62 — exactly 30.1 s later, on the desk's own
      timer**. Live at 15:27:35.36.

      The proof is the existence of attempt nine, not the recovery time. Past the
      ceiling the old code had destroyed the session and every timer with it, so
      there was nothing left to fire.

- [x] 4.3 Re-verified after 2.6: `npm run lint`, the four `check:` scripts and
      the suite, run three times from `git archive $(git write-tree)` rather
      than from the shared tree.

      **One failure, not this change's and not deterministic.**
      `renders the newest book and stays interactive at 2 MiB per 100 ms cycle`
      (`src/App.futures-stress.test.jsx`) failed on one run of three and passed
      on the others, on identical bytes. It has no threshold assertion — it
      leans on `waitFor` deadlines — so on a machine where three sessions run
      the suite at once it fails for want of CPU rather than for want of
      correctness. Left alone here: it belongs to the book work, and a guard
      that fails under load is a change of its own to make. Recorded so the
      next session that meets it does not go looking for a regression that is
      not there.

## Notes

`futures-production-workstation-service.js` is shared and hot.
`bootstrap-the-book-on-a-quiet-market` is open on `scheduleResync`'s callers and
removes one cause of reaching the ladder at all; `send-only-the-book-on-screen`
and `prove-the-book-covers-both-sides` are open on the book. Re-read before
staging, and stage by hunk.

This change deliberately does not touch `binance-connection.js`.
`prove-the-private-stream-is-carrying` owns that file's stream lifecycle, and the
account leg's unbounded reconnect is quoted here only as the contrast that made
the fault visible.
