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
- [ ] 2.5 **Not measured in a browser.** The notice is `position: absolute` inside
      the chart frame with `max-width: calc(100% - 16px)`, so it is out of flow
      and cannot make a panel scroll or overflow. The repository has no Chromium
      layout fixture any more — `remove-playwright-e2e` was archived on
      2026-08-12 — so this is reasoned, not measured. Say so rather than checking
      it off.

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

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test` (1803 passed, 109 files),
      `npm run check:futures-production`, `npm run check:circular`,
      `npm run check:runtime-mock`, `npm run check:command-path` — all green.
- [ ] 4.2 Operator steps handed to `verify-the-desk-in-one-sitting`'s runbook
      under "Дописано 2026-08-13: рынок возвращается сам". Not checked off here;
      the runbook is where operator verification lives.

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
