## 0. Measure First

Every bound in this change is a claim about how often the exchange speaks. None
of them is guessed: each is measured on the operator's own proxy, on the streams
the desk already subscribes to, before the code that enforces it is written.

Measured 2026-08-13, seven minutes on four sockets through the operator's proxy,
on the desk's own stream paths. The thin contract was chosen as the lowest
24-hour quote volume on USDⓈ-M: **BITOUSDT**, 1 583 trades in 24 hours against
BTCUSDT's 2 061 964 — which is thinner than anything the rail carries, so the
false-positive margins below are the worst case rather than a typical one.

- [x] 0.1 **The mark stream is the one thing that does not care whether anything trades.** `@markPrice@1s`: BTCUSDT p50 1000ms, p99 1022ms, max 1496ms (n=417); BITOUSDT p50 1000ms, p99 1480ms, max 1511ms (n=418). Seven minutes on a contract that printed **one** aggregate trade in the whole run, and the mark still arrived 418 times. Nothing else comes close: `@aggTrade` on BITOUSDT had a single frame in 420s, and `@depth@100ms` on it ran p50 1010ms, p99 4999ms, **max 12822ms**.
- [x] 0.2 **Ping is exactly three minutes, and the two routes do not differ.** Intervals between consecutive server pings: `/market` 180002ms and 179965ms, `/public` 180264ms and 180003ms. Jitter is a quarter of a second on three minutes.
- [x] 0.3 **The book is never silent through its own prints for as long as a quarter of a second on a thin contract.** Longest depth silence containing at least one aggregate trade: BITOUSDT **177ms** (1 print in it), BTCUSDT **1224ms** (42 prints in it). Read the BITOUSDT figure as an existence proof, not as a distribution — one print in seven minutes is one sample. The BTCUSDT figure is the one with a tail behind it, and it is 1.2s.
- [x] 0.4 **The bounds, each from the measurement above:**
    - **Unconditional cadence — 15s on the market socket.** Ten times the worst mark gap observed (1.5s), and the same number the account-side mark feed already uses for the same stream. The measurement would permit tighter; the margin is kept because a false positive costs a resynchronization of the whole workspace.
    - **Connection traffic — 400s on every socket.** Two missed pings (360s) plus forty seconds, against a measured jitter of 264ms. The desk acts on its own account well before the exchange's own ten-minute pong deadline would.
    - **Book against tape — 30s.** Twenty-five times the worst silence-through-prints observed on the liquid contract, and 170 times the thin one. §2 is safe to build.
    - **No unconditional bound on depth or klines.** A 12.8s book silence on a live thin contract is legitimate, so any frame bound tight enough to be useful there would fire on a market that is merely quiet.

## 1. A Stream That Says Nothing Is Not A Live Stream

- [x] 1.1 Give the transport's socket a silence bound and a timer that enforces it, so a connection that stops delivering reports the same disconnection a closed one does and enters the reconnect ladder already built for it.
- [x] 1.2 Judge a stream that carries an unconditional cadence by its frames, and set that bound from 0.1 — `@markPrice@1s` on the market socket is the desk's one guaranteed heartbeat, and the account-side mark feed already treats fifteen seconds of it as a dead feed.
- [x] 1.3 Judge a stream whose silence can be legitimate by the connection's own traffic instead — frames or the exchange's protocol ping, whichever came last — at a bound of no fewer than two missed pings, so a thin contract that genuinely has nothing to say is never mistaken for a dead route.
- [x] 1.4 Name each bound in the disconnection reason, so the workspace's reason line distinguishes a route that went quiet from one that closed, as `futures-workstation-presentation` already requires of a resynchronization. `handleDisconnect` carries the reason to the status line unchanged, and the operator has already sat in front of a flat code once: `STREAM_SILENT_15S` and `STREAM_INACTIVE_400S` say which bound was crossed, `SOCKET_CLOSED` does not.
- [x] 1.5 Keep the judgement in the transport, per socket, so it does not depend on which contract is displayed and does not touch the session bookkeeping `keep-the-contracts-warm` is rewriting.
- [x] 1.6 Clear the timers on close, on the 24-hour rotation and on teardown, so a released generation's watchdog cannot report a disconnection against a session that no longer exists.
- [x] 1.7 Proved by test, and run against the pre-change transport (`52ae266`) first:
    - **Bites.** `treats a market stream that stops delivering as a disconnection` — pre-change `[]` against `['STREAM_SILENT_15S']`.
    - **Bites.** `keeps a quiet stream alive on the exchange ping and ends one that stops pinging` — pre-change `[]` against `['STREAM_INACTIVE_400S']` on the depth socket and the same on the candle socket's own path.
    - **Guard.** `leaves a market stream that keeps delivering alone` passes pre-change; it asserts an absence, and is kept so a bound set too tight cannot land unnoticed.
    - **Guard.** `reports nothing from the watchdogs of a released connection` passes pre-change.
    - `freezes the measured silence bounds` fails pre-change only because the export does not exist there. It is a registry test, not a finding.
    - Two existing tests had to change: both advanced twenty-four hours in one step with nothing delivered, which is now a dead feed and ends at fifteen seconds. They advance with traffic instead, which is what a connection that lives twenty-four hours actually does.

## 2. A Book That Says Nothing While The Tape Prints Is A Dead Book

- [x] 2.1 0.3 left room for it — 30s against a worst observed 1.2s. Judge the depth socket's silence against the market socket's, since a trade printing against the book is a change to the book, and depth cannot be silent through one.
- [x] 2.2 Hold the rule to the same contract and the same session, and make it judge nothing when both streams are quiet — that is a quiet market, and the bound in 1.3 already covers it.
- [x] 2.3 Report it under its own reason — `BOOK_SILENT_THROUGH_TRADES_30S` — distinct from the cadence bound, because it says something different: not that a connection died, but that one of two independently served routes did.
- [x] 2.4 Proved by test against `52ae266` first. **Bites:** `ends a book that says nothing while its own tape prints` — pre-change `[]` against `['BOOK_SILENT_THROUGH_TRADES_30S']`. **Guard:** `says nothing about a book whose tape is not printing either` passes pre-change. The margin from 0.3 is intact: the rule fires at 30s against a worst measured 1.2s.

## 3. The Events The Desk Drops

- [x] 3.1 **Read, and it changed the answer.** Binance's rendered USDⓈ-M user-data page (`/en/docs/products/derivatives-trading-usds-futures/user-data-streams`, read through the desk's own proxy because every plain fetch of that site returns the documentation shell) lists ten events, not the six this change was proposed against. What the field tables settled:
    - `MARGIN_CALL` — `cw` cross wallet, `p[]` of `s`/`ps`/`pa`/`mt`/`iw`/`mp`/`up`/`mm`. Binance's own words: risk guidance only, and the position may already have been liquidated by the time it arrives.
    - `ACCOUNT_CONFIG_UPDATE` — `ac.s`/`ac.l` for a pair's leverage, `ai.j` for the account's Multi-Assets mode. **No per-contract margin mode.** The proposal's first draft claimed it and was wrong; margin mode arrives only as `mt` on an `ACCOUNT_UPDATE` position, so a mode changed on a flat contract is not announced at all.
    - `ALGO_UPDATE` — `o.aid`, `o.X` status, `o.tp` trigger price, `o.rm` failure reason, `o.ia` activation, and `o.ai`, the id of the regular order the algo spawned.
    - `CONDITIONAL_ORDER_TRIGGER_REJECT` — `or.s`/`or.i`/`or.r`, the last being the refusal in the exchange's own words.
    - `STRATEGY_UPDATE`, `GRID_UPDATE` (deprecated), `TRADE_LITE` — for strategies this desk does not run, and a thinner copy of a frame it already folds.
- [ ] 3.2 Normalize `MARGIN_CALL` into the positions it names and what the exchange says stands behind them, and carry that the exchange said it — not that the desk computed it.
- [ ] 3.3 Normalize `ACCOUNT_CONFIG_UPDATE` and apply the leverage it carries to the held contract configuration, so a change made on the phone reaches the desk on the frame that announced it rather than on the next read. Write beside it that margin mode is not in this frame and where it does come from.
- [ ] 3.4 Normalize `ALGO_UPDATE` and fold it into the listed algorithmic orders, leaving the thirty-second beat and the post-command read exactly as they are.
- [ ] 3.5 Normalize `CONDITIONAL_ORDER_TRIGGER_REJECT` and put the exchange's reason in front of the operator, on the path `name-the-refusal-the-exchange-gave` already built for a refusal that has words of its own.
- [ ] 3.6 Answer `TRADE_LITE`, `STRATEGY_UPDATE` and `GRID_UPDATE` under their own names with a written reason for ignoring each, so the next reader is not left to infer a decision from an absence.
- [ ] 3.7 Keep the fold's shape: an event the desk cannot use still answers `null`, and no event added here reads the account back over REST to learn what it was just handed.
- [ ] 3.8 Prove by test that each of the seven is answered as intended and that an unknown event still answers `null`. State plainly in this file that these are guards on handling and prove nothing about delivery — a synthetic frame fed to the normalizer says only that the desk would cope if the frame arrived.

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
