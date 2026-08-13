## 0. Measure First

Written 2026-08-13 by the session that closed `name-the-algo-order-that-fired`,
from the record the desk had already written. What is below is measured, not
assumed; §2's bound is not, and must be before it is chosen.

- **The private stream did not open in 2 of 5 futures sessions on 2026-08-13.**
  `reason: 'stream'` is written only by the user-data socket's `open` handler
  (`binance-connection.js:1656`), so it counts openings. Bucketed by session
  start in `~/.config/cc-trade/diagnostics/desk-2026-08-13-000.jsonl`:
  10:39:59 → 36 reads / 3 openings, 10:54:00 → 22 / **0**, 11:04:36 → 80 / 2,
  11:42:06 → 221 / **0**, 13:32:57 → 19 / 1. The 11:42 session ran 110 minutes
  and reconciled 220 times without one opening.
- **Zero reads with reason `unstated`, and no one-resource read at all, on
  2026-08-13.** 489 reads in the file, every one `resources: 4, weight: 90`:
  `refresh` 461, `bootstrap` 17, `stream` 11, `unstated` 0. Against 31
  `trade.placeOrder`, 18 `trade.cancelOrder` and one `trade.setMarginType`
  recorded the same day — each of which the exchange answers with an execution
  report, and each report schedules a one-resource `unstated` read
  (`binance-connection.js:1685`, unconditional on that path). Coalescing does not
  explain it: a queued read merges only while a pass is in flight, which is about
  two seconds in every thirty. **The socket opened eleven times and folded
  nothing.**

  Correction to this file's first version, which claimed the absence across all
  three journal days: `desk-2026-08-11-000.jsonl` and `-12-` contain no `read`
  records whatsoever — read recording began on the 13th — so their silence says
  nothing about the stream. Raised by the session running
  `recover-the-market-feed-after-an-outage`.
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

- [ ] 0.1 Measure how often the exchange sends an unprompted frame on an idle private socket — the interval that will set §2's bound. Take it from the desk's own endpoint, socket options and proxy, over at least an hour on an account doing nothing, and record the distribution rather than a single reading.
- [ ] 0.2 Measure what the desk does today when the private socket opens and then delivers nothing: how long the stream stays `ready`, how many command-time reads are skipped in that window. This is the cost the change removes and the number 5.2 is compared against.
- [ ] 0.3 Write both numbers into this file before building. A bound taken from the exchange's documentation rather than from a measured run is an estimate, and §2 SHALL NOT state it as anything else.

## 1. The Path The Exchange Actually Serves

Found 2026-08-13 by reading the current official documentation, at the operator's
prompting, after the evidence above ruled out everything cheaper.

Binance retired `wss://fstream.binance.com/ws` and `/stream` on **2026-04-23**
and split the service into `/public`, `/market` and `/private`. The notice states
the consequence outright: "any connections not migrated will ONLY be able to
receive data from `wss://fstream.binance.com/public`. Channels under `/market` and
`/private` will stop pushing data." The user-data stream lives at
`wss://fstream.binance.com/private/ws/<listenKey>`; a combined form
`/private/ws?listenKey=<key>&events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE` exists
beside it.

This desk still opens `wss://fstream.binance.com/ws/<listenKey>`
(`binance-connection.js:1644`) — the only `/ws/` left in it. The market feeds were
migrated; the private one was missed, and the repository's own note about the
decommissioning scopes it to market paths only
(`futures-mark-price-feed.js:33-39`), while the ADR's WebSocket registry
(`docs/futures_phase8_workstation_adr.md:90-101`) has no user-data row at all. So
nothing here recorded where the private stream is supposed to live.

Two hypotheses were checked and are dead, so nobody repeats them: `POST
/fapi/v1/listenKey` still answers `{"listenKey": "..."}`, so `data?.listenKey`
(`futures-trading-adapter.js:905`) reads the right field; and the event names the
adapter keys on (`ORDER_TRADE_UPDATE`, `ACCOUNT_UPDATE`, at `:453/:461`) are
current.

The ADR is worth reading before 1.1 rather than after. Its registry states
"Legacy unrouted production market paths were permanently decommissioned on
2026-04-23" and that Phase 8 "rejects `/ws`, `/stream`, an alternate routed
prefix or any caller suffix" — then lists five rows, every one a public read.
The rule was written and the private stream was simply not in the table it
governs. 1.3 is what stops that recurring.

It also already records the liveness contract §2 needs: "The server sends a ping
every 3 minutes and requires a pong within 10 minutes", with a 24-hour connection
lifetime. Stated there for the market sockets, so 0.1 is confirming it holds on
the private one rather than discovering it — but it is still a measurement,
because a bound taken from a document about a different socket is an estimate.

- [ ] 1.1 Open the futures user-data stream on the path the exchange serves, and state the migration and its date where the URL is built, as the mark-price feed already does for its own.
- [x] 1.2 **Decided: the path form, `wss://fstream.binance.com/private/ws/<listenKey>`, unfiltered.** Reasoning below; it is the minimum diff and the only candidate that cannot fail by omission.
Why that form, decided 2026-08-13 with the session running
`recover-the-market-feed-after-an-outage`, whose reading of it this follows.

The desk folds exactly three event types — `ORDER_TRADE_UPDATE`, `ACCOUNT_UPDATE`
and `listenKeyExpired` (`futures-trading-adapter.js:453/:461/:468`); everything
else `normalizeFuturesUserDataStreamEvent` answers `null` for. The path form
takes no filter, so the delivered set is unchanged by construction and nothing
the desk folds can go missing. The query form
`/private/ws?listenKey=<key>&events=…` adds a filter, and a filter is a claim
about the future as much as the present: `ACCOUNT_CONFIG_UPDATE` is not folded
today but `compute-the-unstated-values-beside-the-read` wants leverage changes,
and an events list written now would quietly exclude them later. The two
candidates do not carry the same risk of being wrong, and only one of them can
fail in the way that cost four months here.

`events` is documented as optional and `listenKey` as required, so the query form
with no filter would be equivalent — but it is a larger diff for nothing.

**Where the evidence is uneven, and it matters.** The migration notice
(`.../websocket-market-streams/Important-WebSocket-Change-Notice`) shows *only*
the query forms under `/private` and does not show the path form at all; the path
form is attested on the User Data Streams *Connect* page, which every direct
fetch from here answered with the documentation homepage instead, so it is
attested through search summaries rather than a quotation taken by hand. The
notice is documenting the new capability — several listen keys on one socket,
with per-key filtering — rather than enumerating every valid form, which is the
reading that makes the two pages agree. It is not proof. 1.5 is therefore not a
formality: if the prefix alone does not make the leg carry, the connect form is
the next thing to change, not the last.

- [ ] 1.3 Register the user-data endpoint in the ADR's WebSocket registry, which has no row for it — that absence is why a decommissioning notice about "market paths" read as not applying.
- [ ] 1.4 Prove by test that the desk builds the routed URL, and that the bare legacy path cannot be built by accident.
- [ ] 1.5 Operator confirms on live data that the stream now delivers. **One** `unstated` read is the whole proof: `resources: 1, weight: 5` against 489 consecutive four-resource passes is unmissable and nothing else in the desk can produce it. One order placed and cancelled is enough. If none appears, the prefix was not the whole story and 1.2's connect form is the next suspect.

## 2. The Stream States Whether It Is Carrying

- [ ] 2.1 Judge liveness on traffic the exchange sends regardless of account activity, so a quiet account is not read as a dead route.
- [ ] 2.2 State the silence bound where it is enforced, with the measurement from 0.1 beside it.
- [ ] 2.3 On silence past the bound, present the stream as not carrying and restore it, with the spacing the mark-price feed already uses so a dead route does not become a reconnect loop.
- [ ] 2.4 Make "carrying" rather than "open" the thing `futuresStreamCarriesOrders()` answers, so the reads skipped on the stream's behalf are taken again while it is not carrying.
- [ ] 2.5 Prove by test that an opened socket which then delivers nothing stops being counted as carrying, that a quiet account on a live route does not, and that a command issued while it is not carrying reads the account.

## 3. No Attempt Ends In Silence

- [ ] 3.1 Distinguish a listen key that was not obtained from a request that was deliberately never made, at the one place both arrive as `undefined` today (`binance-connection.js:1616-1626`).
- [ ] 3.2 Mark the resource failed with a stated cause on the first, and idle on the second; neither may leave it loading.
- [ ] 3.3 Schedule another attempt after a failure, under the retry bound that already exists, and record giving up when that bound is reached.
- [ ] 3.4 Leave the permission refusal (`-2015`) terminal as it is today, but stated in the record rather than only in a log the operator will not have.
- [ ] 3.5 Prove by test that each of the four endings — no key, abandoned, refused, exhausted — leaves a state that names itself, and that none leaves the resource loading.

## 4. The Record Answers Why

- [ ] 4.1 Record each user-data stream transition with its cause, using the record's existing kinds. Do not add an event kind; `fault` carries a phase and a code, and `read` already carries the opening.
- [ ] 4.2 Keep the codes inside the record's existing shape rule, so nothing here can widen what the record accepts.
- [ ] 4.3 Prove by test that a session which never opened the stream leaves a record that names what ended each attempt.

## 5. Verification

- [ ] 5.1 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.2 Re-measure 0.2 against the change: the window in which the desk believes a dead stream should be bounded by §2's bound, not open-ended.
- [ ] 5.3 Operator confirms from the record of one ordinary session that the private stream opened and stayed carrying, and — with the proxy stopped — that it says so when it does not. Hand this to `verify-the-desk-in-one-sitting`'s runbook as a step rather than leaving it here.

## Notes

`binance-connection.js` is shared and hot. The stream-recovery work another
session expected to land there is the same region as §3; check before opening
it. §2 touches `futuresStreamCarriesOrders` at `:1495`, which
`stop-reading-what-the-desk-can-count` and `let-the-stream-state-the-account`
both read.
