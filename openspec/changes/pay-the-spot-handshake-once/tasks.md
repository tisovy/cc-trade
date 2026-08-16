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
- [ ] 5.2 Operator confirms on live data. The spot workspace has to be opened and used — the record shows **zero** spot commands across all six days it keeps, so nothing about this is observable until spot is actually traded.

  1. Restart the desk, open the spot workspace, let it settle.
  2. Place and cancel one limit order far from the market.
  3. Read what the commands cost:

     ```
     node scripts/read-desk-record.mjs | sed -n '/How long commands took/,/^$/p'
     ```

     Expect the spot rows to land near the futures ones — around 330–470 ms
     rather than the 630+ a per-request handshake costs. If they sit near 700,
     reuse is not happening and that is a finding; show the output.
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
