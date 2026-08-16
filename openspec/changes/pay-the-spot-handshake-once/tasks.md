## 1. The Pool

- [x] 1.1 Give the spot REST leg a bounded pool of its own, and state what each number is sized from — including that it is headroom rather than measurement, because spot's traffic has never been recorded.
- [x] 1.2 Set the pooled agent where axios actually reads it (`restAPI.configuration.baseOptions.httpsAgent`), not only on the configuration object.
- [x] 1.3 Stop the `keepAlive` flag saying the opposite of what the agent does, and record why it decided nothing: the SDK builds its own agent only when it has not been given one.
- [x] 1.4 Leave the WebSocket callers on the agent that does not pool, and say why — a stream opens one connection and holds it.
- [x] 1.5 Keep three separate agents — spot REST, futures REST, streams — so none can exhaust another's sockets.
- [x] 1.6 Pool the no-proxy route too, on an explicit agent, rather than inheriting Node's global one. That default has changed between Node versions, and a trading desk should not pick it up silently.

## 2. Saying Whether It Worked

- [x] 2.1 Record a line when the spot leg opens a connection, and nothing when it reuses one. Before this change the record carried no spot timing at all, so "did it get faster" had nothing to be answered from.
- [x] 2.2 Keep the recorder incapable of costing a request: it is called inside its own guard and the connection is made whether or not it raises.
- [x] 2.3 Do not stack a second counter on an agent already wrapped.

## 3. The Failure Reuse Introduces

- [x] 3.1 State plainly that this change adds no retry, and why it needs none: `ECONNRESET` is already in `INDETERMINATE_TRANSPORT_CODES`, so the desk already reports the outcome as unknown and reconciles it with `findOrder` before any resubmission.
- [x] 3.2 State the cost honestly rather than claiming there is none: this path will fire occasionally where it did not before, and each time it costs the operator an unresolved banner and a lookup instead of futures' silent retry.

## 4. Proof

- [x] 4.1 Prove reuse against a real socket rather than a mocked agent — a server that counts its own inbound connections is the only thing that can answer "the second request did not open one". Five requests, one connection.
- [x] 4.2 Prove the same five requests open five connections without the pool, so the pair demonstrates the change rather than asserting it.
- [x] 4.3 Prove one line is recorded for the open and none for the reuses.
- [x] 4.4 Prove a request still goes out when the recorder throws.
- [x] 4.5 Prove the wiring: the spot client gets a pooling agent, the stream agent does not pool and is a different object, and the futures pool is a third.
- [x] 4.6 Both new wiring assertions bite against `git archive HEAD` in a copy.

## 5. Verification

- [x] 5.1 `npm run lint`, `npm test`.
- [x] 5.2 **Run by the operator on live data, 2026-08-16, 17:39–17:40Z: the pool works, and the range this task told them to expect was wrong.** Both halves matter and the second is mine.

  Six spot commands, three connections opened. **Reuse is happening** — that is what this change claims and it is proven.

  But the commands answered in **1696, 1882, 335, 3285, 1696 and 2169 ms**, not the 330–470 predicted below. The prediction was wrong because it assumed the `answer` line measures the same thing on both markets, and it does not. It measures the whole dispatch, and spot awaits a full account refresh inside it — `handleOrderPlacement` ends `await refreshAccountState(symbol)`, three serialized reads. Futures does not: it fires the same read with `void` and does not wait (`binance-connection.js:1889`). So the futures number is one round trip and the spot number is a round trip plus an account pass.

  The order's own round trip *is* now ~330 ms, and the record shows it plainly: the third command answered in **335 ms** — because `refreshAccountState` returns immediately when a refresh is already in flight, so that one command skipped the wait. It is the only one of the six that measured what this change actually changed, and it landed exactly where the change predicted.

  What the operator still feels on spot is therefore not the handshake. It is the account re-read, raised as `stop-waiting-on-the-spot-account-read`.

  ~~Expect the spot rows to land near the futures ones — around 330–470 ms.~~ Kept struck through rather than deleted: the wrong expectation is the reason the measurement looked like a failure, and a task list that quietly corrects its own bar teaches nothing.

  The steps as they were run:

  1. Restart the desk, open the spot workspace, let it settle.
  2. Place and cancel one limit order far from the market.
  3. Read what the commands cost:

     ```
     node scripts/read-desk-record.mjs | sed -n '/How long commands took/,/^$/p'
     ```

     This is the reading whose expectation was wrong; see above. What it can
     still be read for is the **fastest** spot command in a run: that one is a
     command that skipped the account wait, and it is the round trip. 335 ms.
  4. Count the connections the spot leg opened:

     ```
     grep -c '"phase":"spot-rest-connect"' ~/.config/cc-trade/diagnostics/desk-$(date +%F)-000.jsonl
     ```

     Expect a handful shortly after start — the pool has to be filled once — and
     then almost nothing while the desk runs. A steady stream of them means the
     connections are still one-shot.
  5. Watch for an unresolved banner. It should be rare; if one appears, the desk
     should resolve it against the exchange by itself and say so. That path is
     the cost this change accepts, and seeing it work once is worth more than
     never seeing it.
