## 1. Two Lanes Out Of The Main Process

- [x] 1.1 Classify every outbound renderer frame as account traffic or market data at the point it is sent, rather than at the point it is read.
- [x] 1.2 Deliver account traffic — account state, execution reports, symbol configs, command outcomes — without loss and ahead of queued market data.
- [x] 1.3 Make market data latest-wins per resource and per contract: a depth frame waiting behind an unaccepted send is replaced by the newer one rather than both being queued.
- [x] 1.4 Account for what the socket has not accepted, and supersede rather than stack when the queue is behind.
- [x] 1.5 Count superseded and dropped market-data frames per resource, and expose the counts to the diagnostic record rather than dropping silently.
- [x] 1.6 Prove by test that an execution report queued behind a backlog of depth frames is delivered ahead of them.
- [x] 1.7 Prove by test that a burst of depth frames on a stalled socket delivers the newest book and counts the rest as superseded, and that no account frame is ever superseded.
- [x] 1.8 State which resources may be superseded and which may not, rather than superseding all market data. *(Discovered: "latest-wins per resource" is only true of a resource that repeats everything the last frame said. A book, a header, a tape window and a candle series do. A catalog arrives in pages the renderer assembles by offset — drop one and it discards the whole catalog; a history page is the answer to one request; and a status line names a cause the next line does not repeat. Those three are market data that queues, and is never replaced.)*
- [x] 1.9 Supersede the two candle series of a contract independently. *(Discovered: the contract's series and the index series are one resource on one contract, so keying by resource and contract alone made the index series stand in for the chart's own candles. The key carries the series; the record does not, because two series are worth one line between them.)*
- [x] 1.10 Close a renderer that stops draining its account traffic rather than dropping a frame of it. *(Discovered: "without loss" needs a stated end. A renderer that has taken none of thousands of queued account frames is not reading, and the only alternatives are an unbounded queue or a silent hole in its account state. It is closed, and reads the account again on reconnect.)*
- [x] 1.11 Write the record's line when the backlog clears, one per resource, not one per superseded frame. *(Discovered: the case worth recording is a socket blocked for a minute at ten books a second, which is exactly the case where a line per frame would make the record the problem — the record's own byte bound already names this shape as the pathological one.)*

## 2. An Event Is Serialized Once

- [x] 2.1 Serialize a workstation event once, measure that string against the byte ceiling, and send the string that was measured.
- [x] 2.2 Keep the refusal behaviour for an event over the ceiling exactly as it is today.
- [x] 2.3 Prove by test that delivering an event performs one serialization, and that an oversized event is still refused.

## 3. An Event Is Parsed Once, At The Boundary

- [ ] 3.1 Parse and classify each incoming frame once, at the local socket boundary, and hand subscribers the parsed, typed event instead of the raw frame.
- [ ] 3.2 Remove the second parse in `GatewayContext.handleSocketUpdate`; route on the already-parsed value.
- [ ] 3.3 Deliver to each subscriber only the event kinds it handles, so the trading hook never receives a depth frame and never parses one.
- [ ] 3.4 Keep every subscriber's ownership guards — request id, symbol, generation, revision — working on the typed event exactly as they work today.
- [ ] 3.5 Prove by test that a depth frame reaches the workstation subscriber and reaches no account subscriber.
- [ ] 3.6 Prove by test that one delivered frame is parsed once, whatever the number of subscribers.

## 4. The Parse Runs At The Platform's Speed

- [ ] 4.1 Replace `parseBoundedFuturesWorkstationJson` with the platform parser at both call sites — the renderer's workstation events and the main process's upstream stream frames.
- [ ] 4.2 Keep the byte ceiling enforced before parsing, so an unbounded frame is still refused without being read.
- [ ] 4.3 Keep every structural validator unchanged — exact keys, canonical decimals, identities, timestamps, level counts — since that is what rejects a malformed or hostile payload.
- [ ] 4.4 Keep lone-surrogate rejection wherever a value survives validation as free text; state where that is, rather than assuming the decimal and identity patterns cover it.
- [ ] 4.5 Retire the node budget as a derived bound, or state what it still protects against once the byte ceiling and the validators are both in place.
- [ ] 4.6 Run `/security-review` on this section specifically, and record the outcome in this change before it lands.
- [ ] 4.7 Prove by test that every payload the bounded parser refused is still refused, using the existing parser rejection cases.

## 5. Verification

- [ ] 5.1 Re-measure the renderer's per-frame parse-and-validate cost and the main process's per-frame outbound cost, and record before and after.
- [ ] 5.2 Measure the delay from an execution report arriving at the main process to the trading hook applying it, with a depth backlog present and without one.
- [ ] 5.3 `npm run lint`, `npm test`, `npm run check:futures-production`.
- [ ] 5.4 Operator confirms on live data that a fill on a liquid contract leaves the working-orders list and the chart promptly during a fast move, not after it.
