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

- [x] 3.1 Parse and classify each incoming frame once, at the local socket boundary, and hand subscribers the parsed, typed event instead of the raw frame.
- [x] 3.2 Remove the second parse in `GatewayContext.handleSocketUpdate`; route on the already-parsed value.
- [x] 3.3 Deliver to each subscriber only the event kinds it handles, so the trading hook never receives a depth frame and never parses one.
- [x] 3.4 Keep every subscriber's ownership guards — request id, symbol, generation, revision — working on the typed event exactly as they work today.
- [x] 3.5 Prove by test that a depth frame reaches the workstation subscriber and reaches no account subscriber.
- [x] 3.6 Prove by test that one delivered frame is parsed once, whatever the number of subscribers.
- [x] 3.7 Do not lose a frame that merely names the workstation channel. *(Discovered: the cheap text sniff that decides whether to read a frame under the workstation's rules matches any frame containing the channel's name — and a command rejection about the channel carries that name in its `request` field. Reading it strictly and dropping it on failure would have swallowed the one frame that says why the workstation would not open. It falls through and is read as what it is.)*
- [x] 3.8 Stop normalizing every frame for a reader that does not exist. *(Discovered: the socket hook ran `normalizeMessage` over every parsed frame and passed the result to the gateway, which passed it to its listeners, whose only listener ignores it. A pass over every frame, ten times a second, for a value nothing reads.)*
- [x] 3.9 State where a second reading of a frame remains. *(Discovered: the Spot context's legacy branch still calls `parseData(event.data, …)`, which takes the frame's text and answers a shape that context builds from. It is mounted in the Spot workspace only, so it is not on the futures desk's path at all; untangling it is Spot's own change and is named here rather than left for the next reader to find.)*

## 4. The Parse Runs At The Platform's Speed

- [ ] 4.1 Replace `parseBoundedFuturesWorkstationJson` with the platform parser at both call sites — the renderer's workstation events and the main process's upstream stream frames.
- [ ] 4.2 Keep the byte ceiling enforced before parsing, so an unbounded frame is still refused without being read.
- [ ] 4.3 Keep every structural validator unchanged — exact keys, canonical decimals, identities, timestamps, level counts — since that is what rejects a malformed or hostile payload.
- [ ] 4.4 Keep lone-surrogate rejection wherever a value survives validation as free text; state where that is, rather than assuming the decimal and identity patterns cover it.
- [ ] 4.5 Retire the node budget as a derived bound, or state what it still protects against once the byte ceiling and the validators are both in place.
- [ ] 4.6 Run `/security-review` on this section specifically, and record the outcome in this change before it lands.
- [ ] 4.7 Prove by test that every payload the bounded parser refused is still refused, using the existing parser rejection cases.

## 5. Verification

- [x] 5.1 Re-measure the renderer's per-frame parse-and-validate cost and the main process's per-frame outbound cost, and record before and after. Recorded below.
- [x] 5.2 Measure the delay from an execution report arriving at the main process to the trading hook applying it, with a depth backlog present and without one. Recorded below.
- [x] 5.3 `npm run lint`, `npm test` (1557 passed), `npm run check:futures-production`.
- [ ] 5.4 Operator confirms on live data that a fill on a liquid contract leaves the working-orders list and the chart promptly during a fast move, not after it. Written as a step in `verify-the-desk-in-one-sitting/runbook.md` rather than left here, so the operator runs one list.

### Measured

One delivered book at the exchange's own precision — a thousand levels a side,
88.3 KiB on the wire. The repository at 799931d, copied out with `git archive`,
against the working tree; each side driven through its own code, on the same
frame, with the same clock. Sections 1 to 3 only; section 4 is not in these
numbers.

| | before | after |
| --- | --- | --- |
| Renderer, reading one delivered frame | 2.930 ms | **1.920 ms** |
| Main process, putting one event on the wire | 0.279 ms | **0.144 ms** |

The renderer's before is four readings of the same bytes — the socket hook
parsing and normalizing, the gateway parsing, the trading hook parsing, the
workstation parsing and validating. The after is one. What is left is the
protocol's own reading: the bounded parser and the validators, which is what
section 4 is about.

And the delay the change is actually for — a fill issued into a one-second
backlog on a socket that has stopped accepting bytes, at the exchange's measured
ten books a second:

| | before | after |
| --- | --- | --- |
| Books written ahead of the fill | 10 | **0** |
| Bytes written ahead of the fill | 0.86 MiB | **0** |
| Renderer reading spent before the fill is read | 29.3 ms | **0 ms** |

Before, the fill left the desk behind every book produced during the burst and
the renderer read every one of them before reaching it. After, the fill is
written first and the ten books collapse to the one that is still true.
