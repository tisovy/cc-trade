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

- [x] 1.1 Open the futures user-data stream on the path the exchange serves, and state the migration and its date where the URL is built, as the mark-price feed already does for its own.
      Done 2026-08-13 by the session that closed
      `recover-the-market-feed-after-an-outage`, on the §1 hand-off. The URL is
      no longer written at the socket: `futuresUserDataStreamUrl` and
      `FUTURES_USER_DATA_ROUTED_PREFIX` sit in `futures-trading-adapter.js`
      beside `FUTURES_STREAM_ORIGIN`, where the note about the 2026-04-23
      decommissioning now is too — including why omitting `events` is what asks
      for everything, so the next reader is not left to infer that from an
      absence. `binance-connection.js` calls the builder.
- [x] 1.2 **Decided: `wss://fstream.binance.com/private/ws?listenKey=<listenKey>`, with no `events` parameter.** Fallback if it does not carry: `wss://fstream.binance.com/private/ws/<listenKey>`. Reasoning and the assumption each one rests on are below.
Worked out 2026-08-13 with the session running
`recover-the-market-feed-after-an-outage`, over two passes. The first ranked the
path form first on the grounds that the query form implies a filter. That was a
false choice, and the fact that dissolves it is that **`events` is optional**: a
query form with the parameter simply omitted is unfiltered too, so the filter
argument does not separate the candidates at all. What separates them is
attestation.

Not filtering is still the requirement, and it is not a preference. The desk
folds exactly three event types — `ORDER_TRADE_UPDATE`, `ACCOUNT_UPDATE` and
`listenKeyExpired` (`futures-trading-adapter.js:453/:461/:468`); everything else
`normalizeFuturesUserDataStreamEvent` answers `null` for. An `events` list is a
claim about the future as much as the present: `ACCOUNT_CONFIG_UPDATE` is not
folded today but `compute-the-unstated-values-beside-the-read` wants leverage
changes, and a list written now would exclude them silently. `listenKeyExpired`
is a further reason to write no list — it is a control message rather than an
account event, and whether it is even nameable in that parameter is unknown here.
The notice writes its example values slash-separated
(`events=ORDER_TRADE_UPDATE/ACCOUNT_UPDATE`), which is unusual enough on its own
that hand-writing the list invites a quiet mistake.

**Attestation is what decides it, and it favours the query form.** The migration
notice (`.../websocket-market-streams/Important-WebSocket-Change-Notice`) — the
one document whose whole job is to say what to migrate *to* — shows
`/private/ws?listenKey=…` and `/private/stream?listenKey=…`, and does not show
the path form at all. Its absence there is evidence rather than an oversight. The
path form is attested on the User Data Streams *Connect* page, which every direct
fetch from here answered with the documentation homepage, so what supports it is
search summaries quoting that page — two of them, including a concrete example
URL — and that page documents connecting in general rather than this migration,
so it could as easily be describing the pre-migration shape.

Each candidate rests on exactly one unproven assumption, and neither should be
built as though it did not:

- **Query form without `events`:** that omitting an optional filter yields *all*
  events rather than none. Near-certain — it is the only sensible default, and it
  is what the legacy socket did — but if it defaults to none, the failure is the
  same silence again, and indistinguishable from it.
- **Path form:** that it is still valid after the migration.

Which is why 1.5 branches three ways rather than two.

- [ ] 1.3 Register the user-data endpoint in the ADR's WebSocket registry, which has no row for it — that absence is why a decommissioning notice about "market paths" read as not applying.
- [x] 1.4 Prove by test that the desk builds the routed URL, and that the bare legacy path cannot be built by accident.
      Four tests. In `futures-trading-adapter.test.js`: the built URL is
      `.../private/ws?listenKey=abc123`, asserted through `new URL` as
      `pathname === '/private/ws'` with `listenKey` its only parameter — the
      legacy form parses to `/ws/abc123`, so it cannot pass; the key survives
      an `&` or `#` in it, which the plain template did not guarantee; and the
      redaction leaves the route and removes the key in both URL shapes. In
      `binance-connection.test.js`, `opens the Futures user-data stream on the
      routed private path` asserts the socket the live session actually
      constructs, then asserts **every** futures socket that session opens is
      on `/private/ws`, `/market/stream` or `/public/stream`. The last one is
      the guard against a recurrence rather than against this bug: a
      decommissioned path answers the handshake and then delivers nothing, so
      no test that watches behaviour can catch it — only the path can.

      Mutation-tested, all three red only where they should be. **M1**, the
      legacy `/ws/<key>` restored: all four red. **M2**, `/private/ws` kept but
      an `events` filter added: three red — the key-escaping test is rightly
      indifferent. **M3**, the connect line logging the raw URL: one red, the
      log test alone.
- [x] 1.4a Log the URL the socket actually opened on, at connect. Today the only record of an opening is a `read` line with reason `stream`, which says where nothing — and that is exactly how one prefix hid for four months. A gate on 1.1, not a preference.
      Done before 1.1, so the operator's run produces a before-and-after in the
      record rather than an after alone.
      `[futures-stream] connecting wss://fstream.binance.com/private/ws?listenKey=<redacted>`
      at `logger.info` (the default level), written where the socket is
      constructed rather than in `open`, so an attempt that never completes the
      handshake is recorded too.

      The key is redacted and that is not tidiness: a listen key is a bearer
      credential for the account's own event stream, and this line is meant to
      be read and forwarded. `redactFuturesListenKey` covers the path form as
      well, so 1.5's fallback cannot start leaking it. The test asserts both
      halves — the exact redacted line is present, and no log line anywhere
      contains the key.
- [ ] 1.5 Operator confirms on live data that the stream now delivers. **One** `unstated` read is the whole proof: `resources: 1, weight: 5` against 489 consecutive four-resource passes is unmissable and nothing else in the desk can produce it. One order placed and cancelled is enough per attempt, and the same oracle separates all three outcomes without anyone having to be right in advance:
  1. query form without `events` → an `unstated` read appears: done;
  2. → none: build the path form and repeat. The `events` default was the wrong assumption;
  3. → still none: the prefix was not the whole story, and the next suspect is the listen key or the proxy rather than the form.

      **Outcome 1 on the first attempt, 2026-08-13 16:06 UTC.** Left unchecked
      on purpose — operator verification lives in
      `verify-the-desk-in-one-sitting`'s runbook, and the step goes there once
      that file's consolidation lands.

      Session started 16:06:19.457, private socket opened 16:06:24.110. The
      operator placed, moved and cancelled one TUTUSDT limit order — four
      commands, since the desk carried out the move as a cancel and a fresh
      placement — and each one was followed by exactly one read at
      `resources: 1, weight: 5`: 16:06:34.677, :37.183, :38.433, :41.183.
      **Four commands, four folds, none missed.** Before this the file held 489
      reads without a single one; the day's totals are now 610 reads, 4 of them
      `unstated`, and all four are inside these eight seconds.

      The frame arrives with the answer, not after it.
      `FUTURES_UNSTATED_READ_DELAY_MS` is 400 ms, and the gaps from each
      command's answer to its read were 390, 407, 364 and 343 ms — so the timer
      that only an execution report can start was already running 10, −7, 36 and
      57 ms around each REST reply. The exchange is pushing the event as fast as
      it answers the request, which is what the 30-second reconciliation beat
      had been standing in for.

      Both assumptions 1.2 weighed came out right: the query form is served, and
      omitting the optional `events` filter yields every event rather than none.
      The path form was not needed and is not built.

      What this does **not** prove: no order was filled during the run, so
      `ACCOUNT_UPDATE` on a fill — the event the operator's original complaint
      was about, an order line the price crossed taking 8–12 s to leave the
      chart — has still only been shown to arrive on a socket that is now
      demonstrably delivering. It rides the same socket as the reports above,
      so it is close to settled, but it was not observed. The runbook's own
      real-order steps are where it gets observed.

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
