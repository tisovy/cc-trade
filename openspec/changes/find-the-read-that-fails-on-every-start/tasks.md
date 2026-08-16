## 1. Make The Record Answer It

- [ ] 1.1 Give the `exchange-info` failure a reason. The `timing` kind carries a phase and an outcome and no code, so either the failure is also written as a `fault` — which already carries one — or the phase itself names the rejection (`exchange-info:aborted` and the like, which the phase pattern already permits).
- [ ] 1.2 Cover every fast-rejection path in `loadExchangeInfo`, not the one that looks likeliest: the backend-proxy error code, the aborted signal, and a refusal from the admission ladder before the request is issued. Guessing between them and fixing the guess moves a symptom instead of ending it.
- [ ] 1.3 Do not change what the desk does while finding out. This change is a question first.

## 2. Read It Back

- [ ] 2.1 Restart the desk a few times and read which reason it is. One start is enough if it is the once-per-start shape; 2026-08-15 had nearly three per start, so read a day rather than a start before concluding.
- [ ] 2.2 Write the answer into this proposal before building anything on it.

## 3. Then Fix What It Is

- [ ] 3.1 If it is a real fault: fix it, and prove by test that the path which was rejecting no longer does.
- [ ] 3.2 If it is a first attempt expected to lose a race and be retried: stop recording it as an error, say what it is where the reader is, and prove by test that the retry is what succeeds. An error line that is normal is worse than no line, because it teaches everyone to ignore error lines.
- [ ] 3.3 Either way, state in the proposal which of the two it was — the value of this change is mostly in the answer.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Operator confirms across a few starts that the line is either gone or now says what it is.

### The evidence this starts from

Counted 2026-08-16 across all six days the record keeps: roughly one
`exchange-info` failure per desk start, `durationMs` of three to six, `cache`
always `miss`. In the same second, five `futures-rest-unpooled` calls take
745–889 ms and all succeed — so the exchange is reachable and the credentials are
good, and three milliseconds is not a network round trip that failed. It is
something refusing before the request goes out.
