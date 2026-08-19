## 1. Make The Record Answer It

- [x] 1.1 Give the `exchange-info` failure a reason. The `timing` kind carries a phase and an outcome and no code, so either the failure is also written as a `fault` — which already carries one — or the phase itself names the rejection (`exchange-info:aborted` and the like, which the phase pattern already permits).

  The `timing` kind now carries `code`, the way `fault` does, and it is `null` on
  a phase that did not fail. Not the phase suffix: `PHASE` admits only a numeric
  suffix (`/^[a-z][a-z0-9-]{0,32}(?::\d{1,12})?$/`, which is what
  `oversized-frame:2048` uses), so naming the rejection there would have taken a
  widened pattern *and* left the reason encoded in a field that already means
  something else. `tolerated` rather than `optional`, so a reason in a shape the
  record will not repeat costs the reason and never the line.

- [x] 1.2 Cover every fast-rejection path in `loadExchangeInfo`, not the one that looks likeliest: the backend-proxy error code, the aborted signal, and a refusal from the admission ladder before the request is issued. Guessing between them and fixing the guess moves a symptom instead of ending it.

  All three, and by construction rather than by enumeration. The proxy refusal
  and the already-aborted caller are named at their sites; everything else
  reaches one rejection handler as an error that carries its own code, and the
  code is taken from the error. That covers the admission ladder
  (`READ_QUEUE_OVERFLOW`, `READ_WEIGHT_EXHAUSTED`, `READ_OPERATION_ABORTED`), the
  wire (`ECONNREFUSED`, `REQUEST_DEADLINE_EXCEEDED`), and the response checks
  (`HTTP_REJECTED`, `REDIRECT_REJECTED`, `RESPONSE_BODY_TOO_LARGE`) without this
  change having to list them.

  The proxy path used to record nothing at all — the read that never happened was
  also the read nothing recorded. It now leaves a line.

  The two other error timings in the transport, `oversized-frame:N` and
  `upstream-streams`, were given their reasons too. Otherwise `code: null` would
  mean both "this did not fail" and "this failed and was never instrumented".

- [x] 1.3 Do not change what the desk does while finding out. This change is a question first.

  Nothing but the record changed. No retry, no timing, no ordering.

## 2. Read It Back

- [ ] 2.1 Restart the desk a few times and read which reason it is. One start is enough if it is the once-per-start shape; 2026-08-15 had nearly three per start, so read a day rather than a start before concluding.

  Waiting on a desk start — the operator stopped the desk on 2026-08-16 at 20:56
  local. Read it with:

  ```
  grep '"phase":"exchange-info","durationMs":[0-9]\{1,3\},"outcome":"error"' \
    ~/.config/cc-trade/diagnostics/desk-$(date +%F)-000.jsonl
  ```

  **Written down before the answer, so the next start decides it rather than
  confirms me.** Reading the code and the six days of record says
  `REQUEST_ABORTED`: every one of these failures is bracketed by two
  `status <symbol> loading` lines three to five milliseconds apart — a session
  starting, being superseded, and a second one starting — and the service's
  bootstrap catch swallows the error without a `fault` line when
  `!this.isHeld(session)`, which is exactly why the failure has a `timing` line
  and no `fault` line beside it. If the record says anything else, that reading
  is wrong and this is not the once-per-start abort it looks like.

- [x] 2.2 Write the answer into this proposal before building anything on it.

  Read from the retained 2026-08-16–18 record after the reason field landed:
  all eleven 1–5 ms failures are `REQUEST_ABORTED`; the seven genuine
  exchange-info failures are separately named `REQUEST_DEADLINE_EXCEEDED` and
  take 10,001–10,007 ms. The proposal now records the answer before §3 changes.

## 3. Then Fix What It Is

- [ ] 3.1 If it is a real fault: fix it, and prove by test that the path which was rejecting no longer does. *(N/A: the fast rejection is the expected `REQUEST_ABORTED` loser of a superseded generation, not a real fault. Left unchecked because no defect fix was performed.)*
- [x] 3.2 If it is a first attempt expected to lose a race and be retried: stop recording it as an error, say what it is where the reader is, and prove by test that the retry is what succeeds. An error line that is normal is worse than no line, because it teaches everyone to ignore error lines.

  `REQUEST_ABORTED` now records `outcome: "aborted"`; genuine failures keep
  `outcome: "error"` and their reason. The transport test aborts the first
  caller while its shared read is in flight, has the replacement join that
  read, and proves the replacement receives the catalog with one fetch.

  Full-audit finding: the diagnostic record accepts only `cache: "hit"` and
  `cache: "miss"`, so it drops the successful replacement timing whose cache
  state is `shared` (and also drops valid bounded-stale timings). Correct the
  record vocabulary in production, then prove at the record boundary that the
  aborted `miss` and successful `shared` retry are both retained. This task is
  complete: the record now accepts `shared` and `stale`, and the regression test
  writes and reads back the aborted `miss`, successful `shared` retry, and
  bounded-stale timing. The diagnostic-record and transport suites pass 86/86;
  the transport assertion still proves the two callers used one fetch.
- [x] 3.3 Either way, state in the proposal which of the two it was — the value of this change is mostly in the answer.

  The proposal selects 3.2: a generation superseded while waiting on the shared
  exchange-info read. Task 3.1 is explicitly N/A there; it remains unchecked
  because no real-defect fix was performed or claimed.

## 4. Verification

- [x] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.

  All three clean after §3: lint passed; the full suite passed 2,100 tests in
  114 files; and the Futures workstation boundary check passed. The full suite
  was run with `LC_ALL=ru_RU.UTF-8`, matching the desk locale instead of the
  shell's overriding `C.UTF-8`, and outside the filesystem/network sandbox so
  its loopback integration tests could bind their local ports. Reopened after
  the full-audit correction to the diagnostic record and rerun against the
  final tree: lint passed; the full suite passed 2,101 tests in 114 files; and
  the Futures workstation boundary check passed. `git diff --check` is clean.
- [ ] 4.2 Operator confirms across a few starts that the line is either gone or now says what it is.

### The evidence this starts from

Counted 2026-08-16 across all six days the record keeps: roughly one
`exchange-info` failure per desk start, `durationMs` of three to six, `cache`
always `miss`. In the same second, five `futures-rest-unpooled` calls take
745–889 ms and all succeed — so the exchange is reachable and the credentials are
good, and three milliseconds is not a network round trip that failed. It is
something refusing before the request goes out.

## 5. Archive Note

- [ ] 5.1 **Before archiving, read this.** The delta in
  `specs/futures-workstation-presentation/spec.md` was synced into the
  canonical spec ahead of archive (commit `00b3a88`, while this change was
  still open) and sits there verbatim — `### Requirement: A failed read
  states why it failed`, canonical line ~2210. An archive sweep must not
  append a second copy, and a tool that answers "+0, already in sync" has
  previously said so while writing lines anyway. Verify by grep that the
  requirement title appears exactly once in the canonical spec after the
  sweep. *(Noted by the 2026-08-19 audit.)*
