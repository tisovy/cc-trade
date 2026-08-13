## 0. Measure First

Every bound in this change is a claim about how often the exchange speaks. None
of them is guessed: each is measured on the operator's own proxy, on the streams
the desk already subscribes to, before the code that enforces it is written.

- [ ] 0.1 Measure the gap between consecutive frames on `@markPrice@1s`, `@depth@100ms` and `@aggTrade`, on a liquid contract and on the thinnest one the operator's rail carries, over `127.0.0.1:1080`, for long enough that the tail is real and not a sample of one.
- [ ] 0.2 Measure how often the exchange sends a protocol ping on `/public/stream` and on `/market/stream`, and whether the two routes differ.
- [ ] 0.3 Record the longest silence observed on the thin contract's book while its own tape was printing — this is the false-positive margin for §2, and it is the only number in this change that decides whether §2 is safe to build at all.
- [ ] 0.4 Write the numbers here, and set each bound from them rather than from the docs. Where a bound and a measurement disagree, the measurement wins and the disagreement is written down.

## 1. A Stream That Says Nothing Is Not A Live Stream

- [ ] 1.1 Give the transport's socket a silence bound and a timer that enforces it, so a connection that stops delivering reports the same disconnection a closed one does and enters the reconnect ladder already built for it.
- [ ] 1.2 Judge a stream that carries an unconditional cadence by its frames, and set that bound from 0.1 — `@markPrice@1s` on the market socket is the desk's one guaranteed heartbeat, and the account-side mark feed already treats fifteen seconds of it as a dead feed.
- [ ] 1.3 Judge a stream whose silence can be legitimate by the connection's own traffic instead — frames or the exchange's protocol ping, whichever came last — at a bound of no fewer than two missed pings, so a thin contract that genuinely has nothing to say is never mistaken for a dead route.
- [ ] 1.4 Name each bound in the disconnection reason, so the workspace's reason line distinguishes a route that went quiet from one that closed, as `futures-workstation-presentation` already requires of a resynchronization.
- [ ] 1.5 Keep the judgement in the transport, per socket, so it does not depend on which contract is displayed and does not touch the session bookkeeping `keep-the-contracts-warm` is rewriting.
- [ ] 1.6 Clear the timers on close, on the 24-hour rotation and on teardown, so a released generation's watchdog cannot report a disconnection against a session that no longer exists.
- [ ] 1.7 Prove by test that a socket which opens and then delivers nothing past its bound reports a disconnection, that one which keeps receiving pings on a quiet contract does not, that the reason names the bound, and that a torn-down socket's watchdog stays silent. Run each against the pre-change transport first and record which of them fail there.

## 2. A Book That Says Nothing While The Tape Prints Is A Dead Book

- [ ] 2.1 Only if 0.3 leaves room for it: judge the depth socket's silence against the market socket's, since a trade printing against the book is a change to the book, and depth cannot be silent through one.
- [ ] 2.2 Hold the rule to the same contract and the same session, and make it judge nothing when both streams are quiet — that is a quiet market, and the bound in 1.3 already covers it.
- [ ] 2.3 Report it under its own reason, distinct from the cadence bound, because it says something different: not that a connection died, but that one of two routes did.
- [ ] 2.4 Prove by test that a book silent through printing trades is disconnected, that a book and tape silent together are not, and that the margin from 0.3 is left intact. If 0.3 shows the margin is not there, write that here and leave §2 unbuilt rather than shipping a rule that resynchronizes a live desk on a thin contract.

## 3. The Events The Desk Drops

- [ ] 3.1 Read each event's field table off Binance's own page before writing a normalizer for it, and cite the page in the code, so the next reader can check the letters rather than trust them.
- [ ] 3.2 Normalize `MARGIN_CALL` into the positions it names and what the exchange says stands behind them.
- [ ] 3.3 Normalize `ACCOUNT_CONFIG_UPDATE` and apply the leverage and margin mode it carries to the held contract configuration, so a change made on the phone reaches the desk on the frame that announced it rather than on the next read.
- [ ] 3.4 Normalize `ALGO_UPDATE` and fold it into the listed algorithmic orders, leaving the thirty-second beat and the post-command read exactly as they are.
- [ ] 3.5 Answer `TRADE_LITE` under its own name with a written reason for ignoring it, so the next reader is not left to infer a decision from an absence.
- [ ] 3.6 Keep the fold's shape: an event the desk cannot use still answers `null`, and no event added here reads the account back over REST to learn what it was just handed.
- [ ] 3.7 Prove by test that each of the four is answered as intended and that an unknown event still answers `null`. State plainly in this file that these are guards on handling and prove nothing about delivery — a synthetic frame fed to the normalizer says only that the desk would cope if the frame arrived.

## 4. What The Operator Is Told

- [ ] 4.1 State a margin call on the position rows it names, beside the liquidation price already drawn there.
- [ ] 4.2 Let the statement stand while it is true and withdraw it when the exchange's own account update says the position no longer warrants it, rather than on a timer.
- [ ] 4.3 Carry a leverage change from the stream to the surfaces that state leverage, without a read and without a flicker through an unknown value.
- [ ] 4.4 Redact nothing that matters and record nothing that must not be recorded: these frames carry position sizes and wallet balances, and `desk-diagnostic-record` already forbids money values in the journal.
- [ ] 4.5 Prove by test that a margin call appears on the named position and only on it, that it clears on the update that resolves it, and that a leverage change from the stream reaches the surfaces that state it.

## 5. Verification

- [ ] 5.1 `OPENSPEC_TELEMETRY=0 openspec validate hear-the-exchange-out --strict` before and after.
- [ ] 5.2 Full suite green, and every new test run against the pre-change tree first with the result recorded here — what passed there is a guard, not a finding, and is to be called one.
- [ ] 5.3 Add to `verify-the-desk-in-one-sitting` the checks only the operator can make: that an algorithmic order placed on the live account produces an `ALGO_UPDATE`, and that changing leverage from the phone moves the desk without a read.
- [ ] 5.4 Leave `streamCannotReport: ['algoOrders']` in place until 5.3 answers. If it answers that the event arrives, propose its removal as its own change rather than folding it into this one.

## Notes

`futures-production-workstation-transport.js` is mine for the duration of this
change; the neighbouring session holds
`futures-production-workstation-service.js`, `useFuturesProductionWorkstation.js`
and `futuresProductionWorkstationProtocol.js` for `keep-the-contracts-warm` §1
and has been told this change stays out of them. The seam between the two is
`onDisconnect`, which already exists and does not change shape here.

`binance-connection.js` is shared and hot. §3 touches the user-data fold, which
`prove-the-private-stream-is-carrying` §2–§4 and `let-the-stream-state-the-account`
also read. Nothing here changes what `ORDER_TRADE_UPDATE`, `ACCOUNT_UPDATE` or
`listenKeyExpired` do.

§3.4 contradicts a requirement that is currently in the spec and a change that is
all but finished. `name-the-algo-order-that-fired` infers a fired algo from the
execution report of the order it spawned, on the stated premise that the stream
does not report algos at all. That inference keeps its value whatever this change
finds — it resolves the parent from a frame the desk already has, with no
dependency on an event whose delivery is unverified. What changes if `ALGO_UPDATE`
does arrive is only which of the two is the backstop, and that is 5.3's to answer,
not this file's.
