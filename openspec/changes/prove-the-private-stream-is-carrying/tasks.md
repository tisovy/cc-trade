## 0. Measure First

Written 2026-08-13 by the session that closed `name-the-algo-order-that-fired`,
from the record the desk had already written. What is below is measured, not
assumed; §1's bound is not, and must be before it is chosen.

- **The private stream did not open in 2 of 5 futures sessions on 2026-08-13.**
  `reason: 'stream'` is written only by the user-data socket's `open` handler
  (`binance-connection.js:1656`), so it counts openings. Bucketed by session
  start in `~/.config/cc-trade/diagnostics/desk-2026-08-13-000.jsonl`:
  10:39:59 → 36 reads / 3 openings, 10:54:00 → 22 / **0**, 11:04:36 → 80 / 2,
  11:42:06 → 221 / **0**, 13:32:57 → 19 / 1. The 11:42 session ran 110 minutes
  and reconciled 220 times without one opening.
- **Zero reads with reason `unstated` across all three journal days** (2026-08-11
  through 2026-08-13, 2354 lines). An execution report schedules one
  (`binance-connection.js:1685`), so this is the same absence seen from the
  order side rather than a second observation.
- **The 10:39 session opened three times in thirteen minutes**, which is not one
  healthy connection. Whatever closed it twice is not recorded anywhere.
- **Startup is a failing case, not only an unreliable one.** In the 13:32:57
  session — reported by the session working on `recover-the-market-feed-after-an-outage`,
  which read the same journal independently — the bootstrap answered at 13:32:59
  and thirteen weight-90 reconciliation beats then ran before the private socket
  opened at 13:38:10. It opened only because the operator cycled the proxy, which
  forced a reconnect. So the one opening in that row of the table above is not
  evidence that startup works; it is evidence that something outside the desk had
  to happen for it to.

- [ ] 0.1 Measure how often the exchange sends an unprompted frame on an idle private socket — the interval that will set §1's bound. Take it from the desk's own endpoint, socket options and proxy, over at least an hour on an account doing nothing, and record the distribution rather than a single reading.
- [ ] 0.2 Measure what the desk does today when the private socket opens and then delivers nothing: how long the stream stays `ready`, how many command-time reads are skipped in that window. This is the cost the change removes and the number 4.2 is compared against.
- [ ] 0.3 Write both numbers into this file before building. A bound taken from the exchange's documentation rather than from a measured run is an estimate, and §1 SHALL NOT state it as anything else.

## 1. The Stream States Whether It Is Carrying

- [ ] 1.1 Judge liveness on traffic the exchange sends regardless of account activity, so a quiet account is not read as a dead route.
- [ ] 1.2 State the silence bound where it is enforced, with the measurement from 0.1 beside it.
- [ ] 1.3 On silence past the bound, present the stream as not carrying and restore it, with the spacing the mark-price feed already uses so a dead route does not become a reconnect loop.
- [ ] 1.4 Make "carrying" rather than "open" the thing `futuresStreamCarriesOrders()` answers, so the reads skipped on the stream's behalf are taken again while it is not carrying.
- [ ] 1.5 Prove by test that an opened socket which then delivers nothing stops being counted as carrying, that a quiet account on a live route does not, and that a command issued while it is not carrying reads the account.

## 2. No Attempt Ends In Silence

- [ ] 2.1 Distinguish a listen key that was not obtained from a request that was deliberately never made, at the one place both arrive as `undefined` today (`binance-connection.js:1616-1626`).
- [ ] 2.2 Mark the resource failed with a stated cause on the first, and idle on the second; neither may leave it loading.
- [ ] 2.3 Schedule another attempt after a failure, under the retry bound that already exists, and record giving up when that bound is reached.
- [ ] 2.4 Leave the permission refusal (`-2015`) terminal as it is today, but stated in the record rather than only in a log the operator will not have.
- [ ] 2.5 Prove by test that each of the four endings — no key, abandoned, refused, exhausted — leaves a state that names itself, and that none leaves the resource loading.

## 3. The Record Answers Why

- [ ] 3.1 Record each user-data stream transition with its cause, using the record's existing kinds. Do not add an event kind; `fault` carries a phase and a code, and `read` already carries the opening.
- [ ] 3.2 Keep the codes inside the record's existing shape rule, so nothing here can widen what the record accepts.
- [ ] 3.3 Prove by test that a session which never opened the stream leaves a record that names what ended each attempt.

## 4. Verification

- [ ] 4.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 4.2 Re-measure 0.2 against the change: the window in which the desk believes a dead stream should be bounded by §1's bound, not open-ended.
- [ ] 4.3 Operator confirms from the record of one ordinary session that the private stream opened and stayed carrying, and — with the proxy stopped — that it says so when it does not. Hand this to `verify-the-desk-in-one-sitting`'s runbook as a step rather than leaving it here.

## Notes

`binance-connection.js` is shared and hot. The stream-recovery work another
session expected to land there is the same region as §2; check before opening
it. §1 touches `futuresStreamCarriesOrders` at `:1495`, which
`stop-reading-what-the-desk-can-count` and `let-the-stream-state-the-account`
both read.
