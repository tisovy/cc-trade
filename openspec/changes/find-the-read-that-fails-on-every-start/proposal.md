## Why

The desk fails one `exchange-info` read on nearly every start, has done for as
long as the record keeps, and nobody has looked at it.

Found while auditing something else on 2026-08-16 — it is not a symptom anyone
reported, because the desk recovers and the operator never sees it.

Counted across every day the record holds:

| day | desk starts | `exchange-info` error | ok |
|---|---|---|---|
| 2026-08-11 | 9 | 7 | 12 |
| 2026-08-12 | 20 | 16 | 15 |
| 2026-08-13 | 57 | 44 | 86 |
| 2026-08-14 | 11 | 8 | 9 |
| 2026-08-15 | 27 | **72** | 149 |
| 2026-08-16 | 28 | 25 | 5 |

Roughly one failure per start on five of the six days. 2026-08-15 is the one that
breaks the pattern with nearly three per start, so "once at startup" is the
shape, not the rule.

What the failing call looks like, every time:

```
{"phase":"exchange-info","durationMs":4,"outcome":"error","cache":"miss"}
```

**Three to six milliseconds is the finding.** A REST call to Binance through the
operator's proxy costs 325–630 ms — measured, repeatedly, in
`pay-the-handshake-once`. Four milliseconds is not a network round trip that
failed; it is something refusing before the request goes out. In the same
sequence, immediately after, five `futures-rest-unpooled` calls take 745–889 ms
and all succeed, so the exchange is reachable and the credentials are good.

## What is not known

The cause. `loadExchangeInfo` in
`electron/services/futures-production-workstation-transport.js` has several ways
to reject quickly — a backend-proxy error code, an aborted signal, a refusal from
the admission ladder before the request is issued — and the record cannot tell
them apart, because the timing line carries a phase and an outcome and no reason.
Guessing between them and "fixing" the guess is how a symptom moves rather than
goes away.

## What Changes

- Find out which of the fast-rejection paths this is, by making the record say
  so: the failure carries a code, the way a `fault` line does, so the next start
  answers the question instead of another reading session.
- Then fix what it turns out to be — or, if it turns out to be a first attempt
  that is *expected* to lose a race and be retried, say so where the reader is
  and stop recording it as an error, because an error line that is normal
  teaches everyone to ignore error lines.

## Why it is worth the trouble at all

Nothing is visibly broken: the desk gets its contracts. The reason to chase it is
that the record is the desk's own account of itself, and a line that says "error"
on every start for six days is either a real fault nobody has priced or a lie the
record tells routinely. Both are worth ending, and neither can be settled by
reading the code, because the code has three ways to produce this line and the
line does not say which.

## Impact

- `electron/services/futures-production-workstation-transport.js` — the failure
  states its reason.
- Adds a requirement to `futures-workstation-presentation`.
